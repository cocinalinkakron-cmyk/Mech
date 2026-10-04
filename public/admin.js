(() => {
  const { esc, api, toast, icon, toneFor, relTime, etaDate, vehicleName, money, dateFmt } = Mech;
  const $ = (sel, root = document) => root.querySelector(sel);

  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} },
  };

  const state = {
    token: store.get('mech-token'),
    stages: [],
    orders: [],
    shop: { name: 'Taller', phone: '', baseUrl: '', lan: [] },
    filter: 'active',
    query: '',
    openId: null,
    selected: null,
    historyLen: {},
  };

  const QUICK_NOTES = {
    recibido: ['Recibimos tu vehículo, en breve lo revisamos.'],
    diagnostico: ['Comenzamos la revisión.', 'Encontramos la falla, te enviamos el presupuesto pronto.'],
    presupuesto: ['Te enviamos el presupuesto, apruébalo desde el enlace.'],
    piezas: ['Pedimos los repuestos, llegan mañana.', 'Ya tenemos los repuestos.'],
    reparacion: ['Empezamos la reparación.', 'Vamos a la mitad del trabajo.'],
    calidad: ['Haciendo prueba de ruta.', 'Revisión final en curso.'],
    listo: ['¡Listo! Puedes pasar a recogerlo en horario de taller.'],
    entregado: ['¡Gracias por tu confianza! Buen camino.'],
  };

  const authed = (path, opts = {}) =>
    api(path, { ...opts, token: state.token }).catch((err) => {
      if (err.status === 401) logout();
      throw err;
    });

  const stageOf = (id) => state.stages.find((s) => s.id === id) || { id, label: id };
  const progressOf = (id) => Math.round((state.stages.findIndex((s) => s.id === id) / (state.stages.length - 1)) * 100);

  // Pinta los iconos declarados con data-icon
  const paintIcons = (root = document) =>
    root.querySelectorAll('[data-icon]').forEach((el) => {
      el.innerHTML = icon(el.dataset.icon);
      el.removeAttribute('data-icon');
    });

  // ---------- Enlaces y WhatsApp ----------
  function baseUrl() {
    if (state.shop.baseUrl) return state.shop.baseUrl;
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    return local && state.shop.lan?.[0] ? state.shop.lan[0] : location.origin;
  }
  const trackUrl = (o) => `${baseUrl()}/t/${o.code}`;

  function waMessage(o) {
    const st = stageOf(o.status);
    const first = o.customer.name.split(' ')[0];
    const car = vehicleName(o.vehicle);
    const last = o.history[o.history.length - 1];
    const note = last?.note && last.type !== 'client' ? `\n📝 ${last.note}` : '';
    const lines = {
      recibido: `Hola ${first} 👋, te escribe ${state.shop.name}. Ya recibimos tu ${car}.`,
      presupuesto: `Hola ${first}, el presupuesto de tu ${car} está listo${o.budget != null ? `: *${money(o.budget)}*` : ''}. Puedes aprobarlo aquí mismo 👇`,
      listo: `¡Hola ${first}! 🎉 Tu ${car} está *listo para recoger*.`,
      entregado: `Gracias por confiar en ${state.shop.name}, ${first}. ¡Buen camino! 🚗`,
    };
    const head = lines[o.status] || `Hola ${first}, actualización de tu ${car}: ahora está en *${st.label}*.`;
    return `${head}${note}\n\nSigue el estado en vivo: ${trackUrl(o)}\nCódigo: ${o.code}`;
  }
  const waUrl = (o) => `https://wa.me/${(o.customer.phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(waMessage(o))}`;

  // ---------- Overlays ----------
  function openLayer(className, html, onClose) {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const el = document.createElement('div');
    el.className = className;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = html;
    paintIcons(el);
    document.body.append(overlay, el);
    document.body.style.overflow = 'hidden';
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      overlay.classList.add('closing');
      el.classList.add('closing');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => {
        overlay.remove();
        el.remove();
        if (!document.querySelector('.overlay')) document.body.style.overflow = '';
      }, 280);
      onClose?.();
    };
    const onKey = (e) => e.key === 'Escape' && [...document.querySelectorAll('.overlay')].pop() === overlay && close();
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close));
    return { el, close };
  }

  // ---------- Acceso ----------
  function showLogin() {
    $('#dash').classList.add('hidden');
    $('#login').classList.remove('hidden');
    paintIcons($('#login'));
    setTimeout(() => $('#pin').focus(), 100);
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      const { token } = await api('/login', { method: 'POST', body: { pin: $('#pin').value } });
      state.token = token;
      store.set('mech-token', token);
      $('#login-err').textContent = '';
      start();
    } catch (err) {
      $('#login-err').textContent = err.message;
      $('#pin').value = '';
      form.classList.remove('shake');
      void form.offsetWidth;
      form.classList.add('shake');
    }
  });

  let stream;
  function logout() {
    state.token = null;
    store.set('mech-token', null);
    stream?.close();
    showLogin();
  }
  $('#logout-btn').addEventListener('click', logout);

  // ---------- Panel ----------
  async function start() {
    try {
      const [stages, shop, orders] = await Promise.all([api('/stages'), authed('/shop'), authed('/orders')]);
      state.stages = stages;
      state.shop = shop;
      state.orders = orders;
      orders.forEach((o) => (state.historyLen[o.id] = o.history.length));
    } catch {
      return showLogin();
    }
    $('#login').classList.add('hidden');
    $('#dash').classList.remove('hidden');
    paintIcons($('#dash'));
    $('#shop-title').textContent = state.shop.name;
    $('#today').textContent = new Intl.DateTimeFormat('es', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    renderAll();
    moveInk();
    connect();
  }

  function connect() {
    stream?.close();
    stream = new EventSource(`/api/stream?token=${encodeURIComponent(state.token)}`);
    const live = $('#live');
    stream.onopen = () => {
      live.textContent = 'En vivo';
      live.dataset.tone = 'live';
    };
    stream.onerror = () => {
      live.textContent = 'Reconectando…';
      live.dataset.tone = '';
    };
    const upsert = (e) => {
      const o = JSON.parse(e.data);
      const prevLen = state.historyLen[o.id] ?? o.history.length;
      const fresh = o.history.slice(prevLen);
      upsertOrder(o);
      fresh
        .filter((h) => h.type === 'client')
        .forEach((h) => toast(`${o.customer.name.split(' ')[0]}: ${h.note}`, 5000));
    };
    stream.addEventListener('update', upsert);
    stream.addEventListener('create', upsert);
    stream.addEventListener('delete', (e) => {
      const { id } = JSON.parse(e.data);
      state.orders = state.orders.filter((o) => o.id !== id);
      renderAll();
    });
  }

  function upsertOrder(o, { bump = true } = {}) {
    const i = state.orders.findIndex((x) => x.id === o.id);
    const changed = i === -1 || state.orders[i].updatedAt !== o.updatedAt;
    if (i === -1) state.orders.unshift(o);
    else state.orders[i] = o;
    state.historyLen[o.id] = o.history.length;
    if (!changed) return;
    state.orders.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    renderAll(bump ? o.id : null);
    if (state.openId === o.id) refreshDrawer();
  }

  function renderAll(bumpId) {
    renderStats();
    renderOrders(bumpId);
  }

  function renderStats() {
    const os = state.orders;
    const count = (fn) => os.filter(fn).length;
    const stats = [
      { n: count((o) => o.status !== 'entregado'), l: 'En el taller', tone: '' },
      { n: count((o) => ['diagnostico', 'piezas', 'reparacion', 'calidad'].includes(o.status)), l: 'Trabajando', tone: 'accent' },
      { n: count((o) => o.status === 'presupuesto' && o.budgetApproved !== true), l: 'Por aprobar', tone: 'warn' },
      { n: count((o) => o.status === 'listo'), l: 'Listos para entregar', tone: 'ok' },
    ];
    const box = $('#stats');
    const first = !box.children.length;
    box.innerHTML = stats
      .map((s, i) => `<div class="card stat ${first ? 'rise' : ''}" style="--i:${i + 1}" data-tone="${s.tone}"><div class="n">${s.n}</div><div class="l">${s.l}</div></div>`)
      .join('');
  }

  function filtered() {
    const q = state.query.toLowerCase();
    return state.orders.filter((o) => {
      const f = state.filter;
      if (f === 'active' && ['listo', 'entregado'].includes(o.status)) return false;
      if (f === 'ready' && o.status !== 'listo') return false;
      if (f === 'done' && o.status !== 'entregado') return false;
      if (!q) return true;
      return [o.customer.name, o.customer.phone, o.vehicle.plate, o.vehicle.make, o.vehicle.model, o.code]
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }

  let animateList = true;
  function renderOrders(bumpId) {
    const list = filtered();
    const box = $('#orders');
    if (!list.length) {
      box.innerHTML = `<div class="empty-list rise">${
        state.orders.length ? 'No hay órdenes aquí.' : 'Aún no hay órdenes. Crea la primera con <b>Nueva orden</b>.'
      }</div>`;
      return;
    }
    box.innerHTML = list
      .map((o, i) => {
        const st = stageOf(o.status);
        const tone = toneFor(o.status);
        const waiting = o.status === 'presupuesto' && o.budget != null;
        const badge = waiting
          ? o.budgetApproved === true
            ? `<span class="chip" data-tone="ok">Aprobado</span>`
            : o.budgetApproved === false
            ? `<span class="chip">Rechazado</span>`
            : `<span class="chip" data-tone="warn">${esc(st.label)}</span>`
          : `<span class="chip" data-tone="${tone}">${esc(st.label)}</span>`;
        return `<article class="card order ${animateList ? 'rise' : ''} ${o.id === bumpId ? 'bump' : ''}" style="--i:${Math.min(i, 8)}" data-tone="${tone}" data-id="${esc(o.id)}" tabindex="0">
          <div class="order-top">
            <div>
              <div class="order-car">${esc(vehicleName(o.vehicle))}${o.vehicle.plate ? `<span class="plate-sm">${esc(o.vehicle.plate)}</span>` : ''}</div>
              <div class="order-client">${esc(o.customer.name)}</div>
            </div>
            ${badge}
          </div>
          <div class="order-bar"><i style="width:${progressOf(o.status)}%"></i></div>
          <div class="order-foot">
            <span class="mono">${esc(o.code)}</span>
            <span>${o.eta && !['entregado'].includes(o.status) ? `Entrega ${esc(dateFmt.format(etaDate(o.eta)))} · ` : ''}${esc(relTime(o.updatedAt))}</span>
          </div>
        </article>`;
      })
      .join('');
    animateList = false;
  }

  $('#orders').addEventListener('click', (e) => {
    const card = e.target.closest('.order');
    if (card) openDrawer(card.dataset.id);
  });
  $('#orders').addEventListener('keydown', (e) => {
    const card = e.target.closest('.order');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      openDrawer(card.dataset.id);
    }
  });

  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value.trim();
    renderOrders();
  });

  function moveInk() {
    const active = $('#tabs .tab.active');
    const ink = $('#tabs .tab-ink');
    ink.style.left = `${active.offsetLeft}px`;
    ink.style.width = `${active.offsetWidth}px`;
  }
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    document.querySelectorAll('#tabs .tab').forEach((t) => t.classList.toggle('active', t === tab));
    state.filter = tab.dataset.filter;
    moveInk();
    animateList = true;
    renderOrders();
  });
  window.addEventListener('resize', () => !$('#dash').classList.contains('hidden') && moveInk());

  // ---------- Nueva orden / editar ----------
  function orderFields(o = {}) {
    const c = o.customer || {};
    const v = o.vehicle || {};
    return `
      <div class="form-grid">
        <div class="form-sep">Cliente</div>
        <div class="grid-2">
          <label class="field"><span>Nombre *</span><input class="input" name="name" required value="${esc(c.name)}" placeholder="María González" /></label>
          <label class="field"><span>WhatsApp</span><input class="input" name="phone" inputmode="tel" value="${esc(c.phone)}" placeholder="Con código de país, ej. 5215512345678" /></label>
        </div>
        <div class="form-sep">Vehículo</div>
        <div class="grid-2">
          <label class="field"><span>Marca</span><input class="input" name="make" value="${esc(v.make)}" placeholder="Toyota" /></label>
          <label class="field"><span>Modelo</span><input class="input" name="model" value="${esc(v.model)}" placeholder="Corolla" /></label>
          <label class="field"><span>Año</span><input class="input" name="year" inputmode="numeric" maxlength="4" value="${esc(v.year)}" placeholder="2020" /></label>
          <label class="field"><span>Placa</span><input class="input" name="plate" value="${esc(v.plate)}" placeholder="ABC-123" style="text-transform:uppercase" /></label>
        </div>
        <div class="form-sep">Trabajo</div>
        <label class="field"><span>Servicio / falla reportada</span><textarea class="input" name="service" placeholder="Ruido al frenar, cambio de aceite…">${esc(o.service)}</textarea></label>
        <div class="grid-2">
          <label class="field"><span>Entrega estimada</span><input class="input" type="date" name="eta" value="${esc(o.eta || '')}" /></label>
          <label class="field"><span>Presupuesto ($)</span><input class="input" type="number" min="0" step="0.01" name="budget" value="${o.budget ?? ''}" placeholder="Opcional" /></label>
        </div>
      </div>`;
  }

  function readFields(form) {
    const f = Object.fromEntries(new FormData(form));
    return {
      customer: { name: f.name, phone: f.phone },
      vehicle: { make: f.make, model: f.model, year: f.year, plate: f.plate, color: '' },
      service: f.service,
      eta: f.eta,
      budget: f.budget === '' ? null : Number(f.budget),
    };
  }

  $('#new-btn').addEventListener('click', () => {
    const { el, close } = openLayer(
      'modal',
      `<form id="new-form">
        <div class="modal-head"><h2>Nueva orden</h2><button type="button" class="btn btn-ghost btn-icon btn-sm" data-close data-icon="x" aria-label="Cerrar"></button></div>
        ${orderFields()}
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn btn-accent" type="submit">Crear y compartir</button>
        </div>
      </form>`
    );
    setTimeout(() => $('[name=name]', el).focus(), 50);
    $('#new-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[type=submit]', el);
      btn.disabled = true;
      try {
        const o = await authed('/orders', { method: 'POST', body: readFields(e.target) });
        upsertOrder(o);
        close();
        setTimeout(() => openDrawer(o.id, { justCreated: true }), 200);
      } catch (err) {
        toast(err.message);
        btn.disabled = false;
      }
    });
  });

  // ---------- Detalle ----------
  let drawer = null;

  function openDrawer(id, { justCreated = false } = {}) {
    const o = state.orders.find((x) => x.id === id);
    if (!o) return;
    state.openId = id;
    state.selected = o.status;
    drawer = openLayer(
      'drawer',
      `<div class="d-head">
        <div><h2 id="d-title"></h2><div class="muted" id="d-sub" style="font-size:14px"></div></div>
        <button class="btn btn-ghost btn-icon btn-sm" data-close data-icon="x" aria-label="Cerrar"></button>
      </div>
      <div class="d-body">
        <div id="d-notice"></div>

        <section class="card d-section share">
          <h3 style="margin:0">Enlace del cliente</h3>
          <div class="share-code"><span class="mono" id="d-code"></span><a class="btn btn-sm" id="d-view" target="_blank" rel="noopener"><span data-icon="eye"></span>Ver como cliente</a></div>
          <div class="share-actions">
            <button class="btn btn-sm" id="d-copy"><span data-icon="link"></span>Copiar enlace</button>
            <a class="btn btn-sm btn-wa" id="d-wa" target="_blank" rel="noopener"><span data-icon="whatsapp"></span>Avisar por WhatsApp</a>
          </div>
          <p class="hint" id="d-hint"></p>
        </section>

        <section class="card d-section">
          <h3>Actualizar estado</h3>
          <div class="stage-picker" id="d-stages"></div>
          <div id="d-budget" style="margin-top:12px"></div>
          <div class="status-form">
            <div class="quick-notes" id="d-quick"></div>
            <textarea class="input" id="d-note" placeholder="Mensaje para el cliente (opcional)"></textarea>
            <button class="btn btn-primary" id="d-submit"></button>
          </div>
        </section>

        <section class="card d-section">
          <h3>Historial</h3>
          <div class="timeline" id="d-history"></div>
        </section>

        <section class="card d-section">
          <h3>Datos de la orden</h3>
          <form id="d-form">${orderFields(o)}<div class="modal-foot"><button class="btn" type="submit">Guardar cambios</button></div></form>
        </section>

        <button class="btn btn-ghost btn-danger" id="d-delete"><span data-icon="trash"></span>Eliminar orden</button>
      </div>`,
      () => {
        state.openId = null;
        drawer = null;
      }
    );
    const el = drawer.el;
    refreshDrawer();
    if (justCreated) {
      showNotice(`Orden creada. Comparte el enlace con ${o.customer.name.split(' ')[0]} 👇`);
    }

    $('#d-stages', el).addEventListener('click', (e) => {
      const opt = e.target.closest('.stage-opt');
      if (!opt) return;
      state.selected = opt.dataset.stage;
      renderStagePicker();
    });
    $('#d-quick', el).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const note = $('#d-note', el);
      note.value = b.textContent;
      note.focus();
      updateSubmit();
    });
    $('#d-note', el).addEventListener('input', updateSubmit);
    $('#d-submit', el).addEventListener('click', submitStatus);
    $('#d-copy', el).addEventListener('click', async () => {
      const cur = currentOrder();
      try {
        await navigator.clipboard.writeText(trackUrl(cur));
      } catch {
        prompt('Copia el enlace:', trackUrl(cur));
        return;
      }
      toast('Enlace copiado');
    });
    $('#d-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        upsertOrder(await authed(`/orders/${state.openId}`, { method: 'PATCH', body: readFields(e.target) }), { bump: false });
        toast('Cambios guardados');
      } catch (err) {
        toast(err.message);
      }
    });
    $('#d-delete', el).addEventListener('click', async () => {
      const cur = currentOrder();
      if (!confirm(`¿Eliminar la orden de ${cur.customer.name}? El enlace dejará de funcionar.`)) return;
      try {
        await authed(`/orders/${cur.id}`, { method: 'DELETE' });
        state.orders = state.orders.filter((x) => x.id !== cur.id);
        drawer.close();
        renderAll();
        toast('Orden eliminada');
      } catch (err) {
        toast(err.message);
      }
    });
  }

  const currentOrder = () => state.orders.find((x) => x.id === state.openId);

  function refreshDrawer() {
    const o = currentOrder();
    if (!drawer || !o) return;
    const el = drawer.el;
    $('#d-title', el).textContent = vehicleName(o.vehicle);
    $('#d-sub', el).textContent = [o.customer.name, o.vehicle.plate].filter(Boolean).join(' · ');
    $('#d-code', el).textContent = o.code;
    $('#d-view', el).href = `/t/${o.code}`;
    $('#d-wa', el).href = waUrl(o);
    const url = trackUrl(o);
    $('#d-hint', el).innerHTML = `${esc(url)}${
      /localhost|127\.0\.0\.1/.test(url)
        ? '<br>⚠️ Este enlace solo abre en esta computadora. Configura la URL en Ajustes para compartirlo con el celular del cliente.'
        : ''
    }${o.customer.phone ? '' : '<br>Sin número guardado: WhatsApp te pedirá elegir el contacto.'}`;
    renderStagePicker();
    renderBudget();
    renderHistory();
  }

  function renderStagePicker() {
    const o = currentOrder();
    const el = drawer.el;
    const cur = state.stages.findIndex((s) => s.id === o.status);
    $('#d-stages', el).innerHTML = state.stages
      .map((s, i) => {
        const cls = [i < cur ? 'past' : '', s.id === o.status ? 'current' : '', s.id === state.selected && s.id !== o.status ? 'selected' : '']
          .filter(Boolean)
          .join(' ');
        return `<button type="button" class="stage-opt ${cls}" data-stage="${s.id}">${icon(i < cur ? 'check' : s.id)}${esc(s.label)}</button>`;
      })
      .join('');
    $('#d-quick', el).innerHTML = (QUICK_NOTES[state.selected] || []).map((n) => `<button type="button">${esc(n)}</button>`).join('');
    updateSubmit();
  }

  function renderBudget() {
    const o = currentOrder();
    const box = $('#d-budget', drawer.el);
    if (o.status !== 'presupuesto' && state.selected !== 'presupuesto') return (box.innerHTML = '');
    if (o.budget == null) {
      box.innerHTML = `<div class="notice warn">Agrega el monto en “Datos de la orden” para que el cliente pueda aprobarlo.</div>`;
    } else if (o.status !== 'presupuesto') {
      box.innerHTML = `<div class="notice warn">El cliente podrá aprobar ${esc(money(o.budget))} desde su enlace.</div>`;
    } else if (o.budgetApproved === true) {
      box.innerHTML = `<div class="notice">✓ El cliente aprobó ${esc(money(o.budget))}</div>`;
    } else if (o.budgetApproved === false) {
      box.innerHTML = `<div class="notice warn">El cliente rechazó ${esc(money(o.budget))}</div>`;
    } else {
      box.innerHTML = `<div class="notice warn">Esperando aprobación de ${esc(money(o.budget))}…</div>`;
    }
  }

  function updateSubmit() {
    if (!drawer) return;
    const o = currentOrder();
    const el = drawer.el;
    const btn = $('#d-submit', el);
    const hasNote = $('#d-note', el).value.trim().length > 0;
    const changing = state.selected !== o.status;
    btn.textContent = changing ? `Cambiar a “${stageOf(state.selected).label}”` : 'Enviar nota al cliente';
    btn.disabled = !changing && !hasNote;
    renderBudget();
  }

  async function submitStatus() {
    const o = currentOrder();
    const el = drawer.el;
    const note = $('#d-note', el).value.trim();
    const changing = state.selected !== o.status;
    const btn = $('#d-submit', el);
    btn.disabled = true;
    try {
      const updated = changing
        ? await authed(`/orders/${o.id}/status`, { method: 'POST', body: { status: state.selected, note } })
        : await authed(`/orders/${o.id}/notes`, { method: 'POST', body: { note } });
      $('#d-note', el).value = '';
      upsertOrder(updated);
      state.selected = updated.status;
      refreshDrawer();
      showNotice(`${changing ? stageOf(updated.status).label : 'Nota enviada'} · ${updated.customer.name.split(' ')[0]} ya lo ve en vivo`, true);
    } catch (err) {
      toast(err.message);
      updateSubmit();
    }
  }

  function showNotice(text, withWa = false) {
    if (!drawer) return;
    const o = currentOrder();
    const box = $('#d-notice', drawer.el);
    box.innerHTML = `<div class="notice"><span>✓ ${esc(text)}</span>${
      withWa ? `<a class="btn btn-sm btn-wa" target="_blank" rel="noopener" href="${esc(waUrl(o))}">${icon('whatsapp')}WhatsApp</a>` : ''
    }</div>`;
    drawer.el.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHistory() {
    const o = currentOrder();
    $('#d-history', drawer.el).innerHTML = [...o.history]
      .reverse()
      .map((h) => {
        const title = h.type === 'note' ? 'Nota' : h.type === 'client' ? 'Cliente' : stageOf(h.status).label;
        return `<div class="tl-item ${h.type}">
          <span class="tl-dot"></span>
          <div>
            <div class="tl-title">${esc(title)}</div>
            ${h.note ? `<div class="tl-note">${esc(h.note)}</div>` : ''}
            <div class="tl-time">${esc(relTime(h.at))}</div>
          </div>
        </div>`;
      })
      .join('');
  }

  // ---------- Ajustes ----------
  $('#settings-btn').addEventListener('click', () => {
    const s = state.shop;
    const { el, close } = openLayer(
      'modal',
      `<form id="settings-form">
        <div class="modal-head"><h2>Ajustes del taller</h2><button type="button" class="btn btn-ghost btn-icon btn-sm" data-close data-icon="x" aria-label="Cerrar"></button></div>
        <div class="form-grid">
          <label class="field"><span>Nombre del taller</span><input class="input" name="name" value="${esc(s.name)}" /></label>
          <label class="field"><span>Teléfono (botón “Llamar” del cliente)</span><input class="input" name="phone" inputmode="tel" value="${esc(s.phone)}" /></label>
          <label class="field"><span>URL para los enlaces</span><input class="input" name="baseUrl" value="${esc(s.baseUrl)}" placeholder="${esc(baseUrl())}" /></label>
          <p class="hint">Para que el cliente abra el enlace desde su celular, ambos deben estar en la misma red Wi-Fi y usar la IP de esta computadora.${
            s.lan?.length ? ` Detectadas: ${s.lan.map((u) => `<code>${esc(u)}</code>`).join(', ')}` : ''
          } Déjalo vacío para detectarla automáticamente.</p>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn btn-primary" type="submit">Guardar</button>
        </div>
      </form>`
    );
    $('#settings-form', el).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        state.shop = await authed('/shop', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) });
        $('#shop-title').textContent = state.shop.name;
        close();
        toast('Ajustes guardados');
      } catch (err) {
        toast(err.message);
      }
    });
  });

  // Refresca los "hace X min"
  setInterval(() => !$('#dash').classList.contains('hidden') && renderOrders(), 60000);

  state.token ? start() : showLogin();
})();
