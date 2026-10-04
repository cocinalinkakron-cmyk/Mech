// Capa de almacenamiento: archivo JSON local (por defecto) o Supabase (si hay credenciales).
// El servidor mantiene los datos en memoria y aquí solo se cargan al inicio y se guardan los cambios.
const fs = require('fs');
const path = require('path');

// Las escrituras se encadenan para que se apliquen en el mismo orden en que ocurrieron.
function serial() {
  let tail = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn);
    tail = run.catch(() => {});
    return run;
  };
}

// ---------- Archivo JSON ----------
function fileStore(dir, getDb) {
  const file = path.join(dir, 'db.json');
  const queue = serial();
  const write = () =>
    queue(async () => {
      await fs.promises.mkdir(dir, { recursive: true });
      const tmp = file + '.tmp';
      await fs.promises.writeFile(tmp, JSON.stringify(getDb(), null, 2));
      await fs.promises.rename(tmp, file);
    });

  return {
    name: `archivo local (${path.relative(process.cwd(), file) || file})`,
    async load() {
      try {
        return JSON.parse(await fs.promises.readFile(file, 'utf8'));
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },
    saveOrder: write,
    deleteOrder: write,
    saveShop: write,
    saveAll: write,
  };
}

// ---------- Supabase (REST / PostgREST) ----------
// Usa la clave secreta (service_role o sb_secret_…) solo en el servidor: nunca llega al navegador.
function supabaseStore(url, key) {
  const base = `${url.replace(/\/+$/, '')}/rest/v1`;
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`; // claves JWT antiguas
  const queue = serial();

  async function req(method, route, body, prefer) {
    const res = await fetch(`${base}/${route}`, {
      method,
      headers: prefer ? { ...headers, Prefer: prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Supabase ${method} ${route}: ${res.status} ${text}`);
    }
    return res.status === 204 ? null : res.json().catch(() => null);
  }

  const toRow = (o) => ({
    id: o.id,
    code: o.code,
    customer: o.customer,
    vehicle: o.vehicle,
    service: o.service || '',
    status: o.status,
    eta: o.eta || null,
    budget: o.budget,
    budget_approved: o.budgetApproved,
    history: o.history,
    created_at: o.createdAt,
    updated_at: o.updatedAt,
  });
  const fromRow = (r) => ({
    id: r.id,
    code: r.code,
    customer: r.customer,
    vehicle: r.vehicle,
    service: r.service,
    status: r.status,
    eta: r.eta,
    budget: r.budget == null ? null : Number(r.budget),
    budgetApproved: r.budget_approved,
    history: r.history || [],
    // PostgREST devuelve "+00:00"; se normaliza a ISO para que las comparaciones de texto funcionen
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  });
  const upsert = (table, rows) => req('POST', `${table}?on_conflict=id`, rows, 'resolution=merge-duplicates,return=minimal');

  return {
    name: `Supabase (${new URL(url).host})`,
    async load() {
      const [shops, rows] = await Promise.all([req('GET', 'shop?select=*&id=eq.1'), req('GET', 'orders?select=*')]);
      if (!shops.length && !rows.length) return null; // primera vez: el servidor siembra ejemplos
      const s = shops[0] || {};
      return {
        shop: { name: s.name || 'Taller Mech', phone: s.phone || '', baseUrl: s.base_url || '' },
        orders: rows.map(fromRow),
      };
    },
    saveOrder: (o) => queue(() => upsert('orders', [toRow(o)])),
    deleteOrder: (o) => queue(() => req('DELETE', `orders?id=eq.${encodeURIComponent(o.id)}`, undefined, 'return=minimal')),
    saveShop: (s) => queue(() => upsert('shop', [{ id: 1, name: s.name, phone: s.phone, base_url: s.baseUrl }])),
    saveAll: (db) =>
      queue(async () => {
        await upsert('shop', [{ id: 1, name: db.shop.name, phone: db.shop.phone, base_url: db.shop.baseUrl }]);
        if (db.orders.length) await upsert('orders', db.orders.map(toRow));
      }),
  };
}

function createStore({ dataDir, getDb }) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) return supabaseStore(url, key);
  if (url || key) console.warn('⚠️  Falta SUPABASE_URL o SUPABASE_SECRET_KEY; se usará el archivo local.');
  return fileStore(dataDir, getDb);
}

module.exports = { createStore };
