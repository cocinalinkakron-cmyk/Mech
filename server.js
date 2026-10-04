// Servidor local sin dependencias: API JSON + archivos estáticos + eventos en vivo (SSE).
const path = require('path');
const fs = require('fs');

// Lee .env si existe (Node 20.12+); las variables ya definidas tienen prioridad.
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE) && process.loadEnvFile) process.loadEnvFile(ENV_FILE);

const http = require('http');
const crypto = require('crypto');
const os = require('os');
const { createStore } = require('./storage');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');

const STAGES = [
  { id: 'recibido', label: 'Recibido', desc: 'Tu vehículo llegó al taller.' },
  { id: 'diagnostico', label: 'Diagnóstico', desc: 'Estamos revisando qué necesita.' },
  { id: 'presupuesto', label: 'Presupuesto', desc: 'Esperando tu aprobación del presupuesto.' },
  { id: 'piezas', label: 'Repuestos', desc: 'Conseguimos las piezas necesarias.' },
  { id: 'reparacion', label: 'En reparación', desc: 'Nuestros mecánicos están trabajando.' },
  { id: 'calidad', label: 'Control de calidad', desc: 'Prueba de ruta y revisión final.' },
  { id: 'listo', label: 'Listo', desc: '¡Tu vehículo está listo para recoger!' },
  { id: 'entregado', label: 'Entregado', desc: 'Gracias por confiar en nosotros.' },
];
const STAGE_IDS = STAGES.map((s) => s.id);

// ---------- Persistencia ----------
let db = { shop: { name: 'Taller Mech', phone: '', baseUrl: '' }, orders: [] };

const store = createStore({ dataDir: DATA_DIR, getDb: () => db });

async function loadDb() {
  const saved = await store.load();
  if (saved) {
    db = { shop: { ...db.shop, ...saved.shop }, orders: saved.orders || [] };
  } else {
    seed();
    await store.saveAll(db);
  }
}

function seed() {
  const hour = 3600 * 1000;
  const now = Date.now();
  const mk = (customer, vehicle, service, statuses, extra = {}) => {
    const history = statuses.map(([status, note], i) => ({
      id: crypto.randomUUID(),
      type: 'status',
      status,
      note,
      at: new Date(now - (statuses.length - i) * 5 * hour).toISOString(),
    }));
    return {
      id: crypto.randomUUID(),
      code: newCode(),
      customer,
      vehicle,
      service,
      status: statuses[statuses.length - 1][0],
      eta: new Date(now + 2 * 24 * hour).toISOString().slice(0, 10),
      budget: null,
      budgetApproved: null,
      history,
      createdAt: history[0].at,
      updatedAt: history[history.length - 1].at,
      ...extra,
    };
  };
  db.orders = [
    mk(
      { name: 'María González', phone: '5215512345678' },
      { make: 'Toyota', model: 'Corolla', year: '2019', plate: 'ABC-123', color: 'Blanco' },
      'Cambio de frenos delanteros y revisión de suspensión',
      [
        ['recibido', 'Recibimos el vehículo con 54,300 km.'],
        ['diagnostico', 'Pastillas al 10% y discos rayados.'],
        ['reparacion', 'Instalando pastillas y discos nuevos.'],
      ]
    ),
    mk(
      { name: 'Carlos Ruiz', phone: '' },
      { make: 'Mazda', model: 'CX-5', year: '2021', plate: 'XYZ-987', color: 'Rojo' },
      'Ruido en el motor al acelerar',
      [
        ['recibido', ''],
        ['diagnostico', 'Banda de accesorios desgastada y tensor flojo.'],
        ['presupuesto', 'Banda + tensor + mano de obra.'],
      ],
      { budget: 3450 }
    ),
  ];
}

function newCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (b) => alphabet[b % alphabet.length]).join('');
  } while (db.orders.some((o) => o.code === code));
  return code;
}

// ---------- Utilidades HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(Object.assign(new Error('JSON inválido'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function serveFile(res, file) {
  const resolved = path.resolve(PUBLIC_DIR, file);
  if (!resolved.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, { error: 'Prohibido' });
  fs.readFile(resolved, (err, content) => {
    if (err) return send(res, 404, { error: 'No encontrado' });
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(resolved)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(content);
  });
}

const str = (v, max = 300) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

// ---------- Autenticación (solo para el taller) ----------
const tokens = new Set();

function isAdmin(req, url) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token');
  return Boolean(token) && tokens.has(token);
}

// ---------- Eventos en vivo ----------
const trackClients = new Map(); // code -> Set<res>
const adminClients = new Set();

function openStream(req, res, set) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('retry: 3000\n\n');
  set.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    set.delete(res);
  });
}

function emit(set, event, payload) {
  if (!set) return;
  const msg = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) res.write(msg);
}

function broadcast(order, event = 'update') {
  emit(trackClients.get(order.code), event, publicView(order));
  emit(adminClients, event, order);
}

// Lo que ve el cliente: sin teléfono ni datos internos.
function publicView(o) {
  return {
    code: o.code,
    customerName: o.customer.name.split(' ')[0],
    vehicle: o.vehicle,
    service: o.service,
    status: o.status,
    eta: o.eta,
    budget: o.budget,
    budgetApproved: o.budgetApproved,
    history: o.history,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    shop: { name: db.shop.name, phone: db.shop.phone },
  };
}

function addHistory(order, entry) {
  const item = { id: crypto.randomUUID(), at: new Date().toISOString(), note: '', ...entry };
  order.history.push(item);
  order.updatedAt = item.at;
  return item;
}

function applyOrderFields(order, body) {
  if (body.customer) {
    order.customer = {
      name: str(body.customer.name, 80) || order.customer?.name || '',
      phone: str(body.customer.phone, 30).replace(/[^\d+]/g, ''),
    };
  }
  if (body.vehicle) {
    order.vehicle = {
      make: str(body.vehicle.make, 40),
      model: str(body.vehicle.model, 40),
      year: str(body.vehicle.year, 4),
      plate: str(body.vehicle.plate, 15).toUpperCase(),
      color: str(body.vehicle.color, 30),
    };
  }
  if ('service' in body) order.service = str(body.service, 500);
  if ('eta' in body) order.eta = /^\d{4}-\d{2}-\d{2}$/.test(body.eta) ? body.eta : null;
  if ('budget' in body) {
    const n = Number(body.budget);
    const budget = body.budget === null || body.budget === '' || !Number.isFinite(n) || n < 0 ? null : n;
    if (budget !== order.budget) order.budgetApproved = null;
    order.budget = budget;
  }
}

// ---------- Rutas ----------
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // sin "api"
  const method = req.method;

  if (method === 'GET' && parts[0] === 'stages') return send(res, 200, STAGES);

  if (method === 'POST' && parts[0] === 'login') {
    const { pin } = await readBody(req);
    const a = Buffer.from(String(pin ?? ''));
    const b = Buffer.from(ADMIN_PIN);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return send(res, 401, { error: 'PIN incorrecto' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    tokens.add(token);
    return send(res, 200, { token });
  }

  // --- Público: seguimiento del cliente ---
  if (parts[0] === 'track' && parts[1]) {
    const order = db.orders.find((o) => o.code === parts[1].toUpperCase());
    if (!order) return send(res, 404, { error: 'No encontramos ese código' });

    if (method === 'GET' && !parts[2]) return send(res, 200, publicView(order));

    if (method === 'GET' && parts[2] === 'stream') {
      if (!trackClients.has(order.code)) trackClients.set(order.code, new Set());
      return openStream(req, res, trackClients.get(order.code));
    }

    if (method === 'POST' && parts[2] === 'approve') {
      const { approved } = await readBody(req);
      if (order.status !== 'presupuesto' || order.budget == null) {
        return send(res, 409, { error: 'No hay un presupuesto pendiente' });
      }
      order.budgetApproved = Boolean(approved);
      addHistory(order, {
        type: 'client',
        status: order.status,
        note: approved ? 'Presupuesto aprobado ✅' : 'Presupuesto rechazado',
      });
      await store.saveOrder(order);
      broadcast(order);
      return send(res, 200, publicView(order));
    }
  }

  // --- Taller (requiere sesión) ---
  if (parts[0] === 'shop' || parts[0] === 'orders' || parts[0] === 'stream') {
    if (!isAdmin(req, url)) return send(res, 401, { error: 'Sesión requerida' });
  }

  if (method === 'GET' && parts[0] === 'stream') return openStream(req, res, adminClients);

  if (parts[0] === 'shop') {
    if (method === 'GET') return send(res, 200, { ...db.shop, lan: lanUrls() });
    if (method === 'PUT') {
      const body = await readBody(req);
      const baseUrl = str(body.baseUrl, 200).replace(/\/+$/, '');
      db.shop = {
        name: str(body.name, 60) || 'Taller',
        phone: str(body.phone, 30),
        baseUrl: /^https?:\/\/[^\s]+$/.test(baseUrl) ? baseUrl : '',
      };
      await store.saveShop(db.shop);
      return send(res, 200, { ...db.shop, lan: lanUrls() });
    }
  }

  if (parts[0] === 'orders') {
    if (method === 'GET' && !parts[1]) {
      const orders = [...db.orders].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return send(res, 200, orders);
    }

    if (method === 'POST' && !parts[1]) {
      const body = await readBody(req);
      if (!str(body.customer?.name)) return send(res, 400, { error: 'Falta el nombre del cliente' });
      const order = {
        id: crypto.randomUUID(),
        code: newCode(),
        status: 'recibido',
        budget: null,
        budgetApproved: null,
        history: [],
        createdAt: new Date().toISOString(),
      };
      applyOrderFields(order, { vehicle: {}, service: '', eta: '', ...body });
      addHistory(order, { type: 'status', status: 'recibido', note: str(body.note, 500) });
      db.orders.push(order);
      await store.saveOrder(order);
      emit(adminClients, 'create', order);
      return send(res, 201, order);
    }

    const order = db.orders.find((o) => o.id === parts[1]);
    if (!order) return send(res, 404, { error: 'Orden no encontrada' });

    if (method === 'PATCH' && !parts[2]) {
      applyOrderFields(order, await readBody(req));
      order.updatedAt = new Date().toISOString();
      await store.saveOrder(order);
      broadcast(order);
      return send(res, 200, order);
    }

    if (method === 'DELETE' && !parts[2]) {
      db.orders = db.orders.filter((o) => o !== order);
      await store.deleteOrder(order);
      emit(trackClients.get(order.code), 'deleted', { code: order.code });
      emit(adminClients, 'delete', { id: order.id });
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && parts[2] === 'status') {
      const body = await readBody(req);
      if (!STAGE_IDS.includes(body.status)) return send(res, 400, { error: 'Estado inválido' });
      order.status = body.status;
      addHistory(order, { type: 'status', status: body.status, note: str(body.note, 500) });
      await store.saveOrder(order);
      broadcast(order);
      return send(res, 200, order);
    }

    if (method === 'POST' && parts[2] === 'notes') {
      const body = await readBody(req);
      const note = str(body.note, 500);
      if (!note) return send(res, 400, { error: 'La nota está vacía' });
      addHistory(order, { type: 'note', status: order.status, note });
      await store.saveOrder(order);
      broadcast(order);
      return send(res, 200, order);
    }
  }

  return send(res, 404, { error: 'Ruta no encontrada' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET') return send(res, 405, { error: 'Método no permitido' });

    if (url.pathname === '/') return serveFile(res, 'index.html');
    if (url.pathname === '/taller' || url.pathname === '/admin') return serveFile(res, 'admin.html');
    if (/^\/t\/[A-Za-z0-9]+\/?$/.test(url.pathname)) return serveFile(res, 'track.html');
    return serveFile(res, decodeURIComponent(url.pathname.slice(1)));
  } catch (err) {
    if (!res.headersSent) send(res, err.status || 500, { error: err.status ? err.message : 'Error interno' });
    if (!err.status) console.error(err);
  }
});

function lanUrls() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${PORT}`);
}

loadDb()
  .then(() => server.listen(PORT, '0.0.0.0', onListen))
  .catch((err) => {
    console.error(`\n  ❌  No se pudo cargar la base de datos (${store.name}):\n  ${err.message}\n`);
    if (/PGRST205|does not exist|schema cache/.test(err.message)) {
      console.error('  ¿Ya ejecutaste supabase/schema.sql en el SQL Editor de Supabase?\n');
    }
    process.exit(1);
  });

function onListen() {
  const lan = lanUrls();
  console.log('\n  🔧  Mech — seguimiento de reparaciones\n');
  console.log(`  Local:        http://localhost:${PORT}`);
  lan.forEach((u) => console.log(`  En tu red:    ${u}   (ábrelo desde el celular)`));
  console.log(`  Panel taller: http://localhost:${PORT}/taller   PIN: ${ADMIN_PIN === '1234' ? '1234 (cámbialo con ADMIN_PIN)' : '••••'}`);
  console.log(`  Datos en:     ${store.name}\n`);
}
