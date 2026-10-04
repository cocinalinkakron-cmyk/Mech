(() => {
  const { esc, api, toast, icon, toneFor, relTime, etaDate, vehicleName, money, fullDateFmt } = Mech;
  const code = location.pathname.split('/').filter(Boolean)[1].toUpperCase();
  const app = document.getElementById('app');
  const live = document.getElementById('live');
  document.getElementById('logo').innerHTML = icon('wrench');

  let stages = [];
  let order = null;
  let lastProgress = 0;
  const seen = new Set();

  const stageOf = (id) => stages.find((s) => s.id === id) || { id, label: id, desc: '' };
  const indexOf = (id) => stages.findIndex((s) => s.id === id);

  const carSvg =
    '<svg viewBox="0 0 64 28" fill="currentColor"><path d="M8 18c0-2 1-3 3-4l7-6c2-1.5 4-2 6-2h14c3 0 5 1 7 3l5 5h4c3 0 5 2 5 5v2H8z"/><circle cx="18" cy="21" r="5"/><circle cx="48" cy="21" r="5"/><circle cx="18" cy="21" r="2" fill="var(--surface)"/><circle cx="48" cy="21" r="2" fill="var(--surface)"/></svg>';

  // Mantiene el carrito dentro de la barra en 0% y 100%
  const carLeft = (p) => `calc((100% - 38px) * ${p / 100})`;

  function render({ changed = false } = {}) {
    const o = order;
    const st = stageOf(o.status);
    const idx = indexOf(o.status);
    const progress = Math.round((idx / (stages.length - 1)) * 100);
    const tone = toneFor(o.status);
    const eta = etaDate(o.eta);
    document.title = `${st.label} · ${vehicleName(o.vehicle)}`;
    document.getElementById('shop-name').textContent = o.shop?.name || 'Mech';

    // Fecha en que se alcanzó cada etapa (la más reciente)
    const reachedAt = {};
    for (const h of o.history) if (h.type === 'status') reachedAt[h.status] = h.at;

    const feed = [...o.history].reverse();
    const firstRender = seen.size === 0;

    const budgetPending = o.status === 'presupuesto' && o.budget != null;

    app.innerHTML = `
      <section class="rise">
        <p class="hello">Hola, ${esc(o.customerName)} 👋</p>
        <h1 class="vehicle-title">${esc(vehicleName(o.vehicle))}</h1>
        ${o.vehicle.plate ? `<span class="plate">${esc(o.vehicle.plate)}</span>` : ''}
      </section>

      <section class="card status-card rise ${changed ? 'flash' : ''}" data-tone="${tone}" style="--i:1">
        <div class="status-head">
          <div class="status-icon">${icon(st.id)}</div>
          <div>
            <div class="status-label">Estado actual</div>
            <div class="status-name">${esc(st.label)}</div>
          </div>
        </div>
        <p class="status-desc">${esc(st.desc)}</p>
        <div class="progress">
          <div class="track">
            <div class="fill" style="width:${lastProgress}%"></div>
            <div class="mini-car" style="left:${carLeft(lastProgress)}">${carSvg}</div>
          </div>
          <div class="progress-meta"><span>Paso ${idx + 1} de ${stages.length}</span><strong>${progress}%</strong></div>
        </div>
      </section>

      <section class="meta-row rise" style="--i:2">
        <div class="card meta">
          <div class="k">${icon('calendar')} Entrega estimada</div>
          <div class="v">${eta ? esc(fullDateFmt.format(eta)) : 'Por definir'}</div>
        </div>
        <div class="card meta">
          <div class="k">${icon('bell')} Última actualización</div>
          <div class="v" data-rel="${esc(o.updatedAt)}">${esc(relTime(o.updatedAt))}</div>
        </div>
      </section>

      ${
        budgetPending
          ? `<section class="card budget rise" style="--i:3">
              <div class="status-label">Presupuesto</div>
              <div class="budget-amount">${esc(money(o.budget))}</div>
              ${
                o.budgetApproved === null
                  ? `<p class="muted" style="margin-bottom:14px;font-size:14.5px">Revisa el detalle y dinos si podemos continuar.</p>
                     <div class="budget-actions">
                       <button class="btn" data-approve="0">Rechazar</button>
                       <button class="btn btn-ok" data-approve="1">${icon('check')} Aprobar</button>
                     </div>`
                  : o.budgetApproved
                  ? `<span class="chip" data-tone="ok">Aprobado — gracias, seguimos con el trabajo</span>`
                  : `<span class="chip">Rechazado — el taller se comunicará contigo</span>`
              }
            </section>`
          : ''
      }

      ${notifyCard()}

      ${
        o.service
          ? `<section class="card service rise" style="--i:4"><div class="status-label">Servicio solicitado</div><p>${esc(o.service)}</p></section>`
          : ''
      }

      <h2 class="section-title rise" style="--i:5">Etapas</h2>
      <ol class="card steps rise" style="--i:5">
        ${stages
          .map((s, i) => {
            const state = i < idx || o.status === 'entregado' ? 'done' : i === idx ? 'current' : 'todo';
            const at = reachedAt[s.id];
            return `<li class="step ${state}" style="--i:${i}">
              <span class="dot">${state === 'done' ? icon('check') : ''}</span>
              <div class="step-body">
                <div class="step-name">${esc(s.label)}</div>
                ${at && state !== 'todo' ? `<div class="step-time">${esc(relTime(at))}</div>` : ''}
              </div>
            </li>`;
          })
          .join('')}
      </ol>

      <h2 class="section-title rise" style="--i:6">Actividad</h2>
      <section class="card feed rise" style="--i:6">
        ${feed
          .map((h) => {
            const isNew = !firstRender && !seen.has(h.id);
            const title = h.type === 'note' ? 'Nota del taller' : h.type === 'client' ? 'Tu respuesta' : stageOf(h.status).label;
            const ic = h.type === 'note' ? 'note' : h.type === 'client' ? 'client' : h.status;
            return `<div class="feed-item ${isNew ? 'new' : ''}">
              <div class="feed-ico">${icon(ic)}</div>
              <div>
                <div class="feed-title">${esc(title)}</div>
                ${h.note ? `<div class="feed-note">${esc(h.note)}</div>` : ''}
                <div class="feed-time" data-rel="${esc(h.at)}">${esc(relTime(h.at))}</div>
              </div>
            </div>`;
          })
          .join('')}
      </section>

      ${
        o.shop?.phone
          ? `<a class="btn cta-call rise" style="--i:7" href="tel:${esc(o.shop.phone)}">¿Dudas? Llama al taller</a>`
          : ''
      }
    `;

    o.history.forEach((h) => seen.add(h.id));
    // Tras la primera carga, las actualizaciones no repiten la animación de entrada
    if (!firstRender) app.classList.add('settled');

    // Anima la barra desde el valor anterior al nuevo
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const fill = app.querySelector('.fill');
        const car = app.querySelector('.mini-car');
        if (fill) fill.style.width = `${progress}%`;
        if (car) car.style.left = carLeft(progress);
        lastProgress = progress;
      })
    );
  }

  function notifyCard() {
    if (!('Notification' in window)) return '';
    const p = Notification.permission;
    if (p === 'granted') return '';
    return `<section class="card notify rise" style="--i:3">
      <div class="ico">${icon('bell')}</div>
      <div class="txt"><strong>Recibe avisos</strong><span class="muted">${
        p === 'denied' ? 'Los avisos están bloqueados en tu navegador.' : 'Te avisamos aquí mismo cuando cambie el estado.'
      }</span></div>
      ${p === 'denied' ? '' : `<button class="btn btn-sm btn-primary" id="enable-notify">Activar</button>`}
    </section>`;
  }

  function notify(title, body) {
    if (navigator.vibrate) navigator.vibrate([120, 60, 120]);
    beep();
    if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
      try {
        new Notification(title, { body, icon: '/favicon.svg', tag: `mech-${code}` });
      } catch {}
    }
  }

  let audioCtx;
  function beep() {
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const now = audioCtx.currentTime;
      [880, 1320].forEach((f, i) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.15, now + i * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.12 + 0.25);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(now + i * 0.12);
        osc.stop(now + i * 0.12 + 0.3);
      });
    } catch {}
  }

  function confetti() {
    const colors = ['#ff5a1f', '#16a34a', '#fbbf24', '#3b82f6', '#ec4899'];
    for (let i = 0; i < 90; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.setProperty('--x', `${(Math.random() - 0.5) * 200}px`);
      c.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
      c.style.setProperty('--d', `${2 + Math.random() * 1.8}s`);
      c.style.animationDelay = `${Math.random() * 0.4}s`;
      document.body.append(c);
      setTimeout(() => c.remove(), 4500);
    }
  }

  function onUpdate(next) {
    const prev = order;
    order = next;
    const statusChanged = prev && prev.status !== next.status;
    render({ changed: statusChanged });
    if (!prev) return;
    const newest = next.history[next.history.length - 1];
    if (statusChanged) {
      const st = stageOf(next.status);
      toast(`Nuevo estado: ${st.label}`);
      notify(`${vehicleName(next.vehicle)}: ${st.label}`, newest?.note || st.desc);
      if (next.status === 'listo') confetti();
    } else if (newest && prev.history.length < next.history.length && newest.type === 'note') {
      toast('El taller dejó una nota nueva');
      notify(`Nota del taller`, newest.note);
    }
  }

  function setLive(ok) {
    live.textContent = ok ? 'En vivo' : 'Reconectando…';
    live.dataset.tone = ok ? 'live' : '';
  }

  function connect() {
    const es = new EventSource(`/api/track/${code}/stream`);
    es.onopen = () => {
      setLive(true);
      // Resincroniza por si hubo cambios mientras estaba desconectado
      api(`/track/${code}`).then(onUpdate).catch(() => {});
    };
    es.onerror = () => setLive(false);
    es.addEventListener('update', (e) => onUpdate(JSON.parse(e.data)));
    es.addEventListener('deleted', () => {
      es.close();
      showEmpty('Esta orden ya no está disponible', 'El taller cerró o eliminó este seguimiento.');
    });
  }

  function showEmpty(title, text) {
    live.textContent = 'Sin conexión';
    app.innerHTML = `<div class="empty rise"><h2>${esc(title)}</h2><p class="muted">${esc(text)}</p><a class="btn btn-primary" href="/">Buscar otro código</a></div>`;
  }

  app.addEventListener('click', async (e) => {
    const approve = e.target.closest('[data-approve]');
    if (approve) {
      const ok = approve.dataset.approve === '1';
      if (!ok && !confirm('¿Seguro que quieres rechazar el presupuesto?')) return;
      app.querySelectorAll('[data-approve]').forEach((b) => (b.disabled = true));
      try {
        onUpdate(await api(`/track/${code}/approve`, { method: 'POST', body: { approved: ok } }));
        toast(ok ? '¡Gracias! Avisamos al taller.' : 'Listo, avisamos al taller.');
        if (ok) confetti();
      } catch (ex) {
        toast(ex.message);
        render();
      }
    }
    if (e.target.closest('#enable-notify')) {
      const res = await Notification.requestPermission();
      if (res === 'granted') {
        toast('Avisos activados 🔔');
        beep();
      }
      render();
    }
  });

  // Mantiene los "hace X min" frescos
  setInterval(() => {
    app.querySelectorAll('[data-rel]').forEach((el) => (el.textContent = relTime(el.dataset.rel)));
  }, 30000);

  (async () => {
    try {
      stages = await api('/stages');
      onUpdate(await api(`/track/${code}`));
      connect();
    } catch (ex) {
      showEmpty('No encontramos ese código', 'Revisa que esté bien escrito o pregunta en el taller.');
    }
  })();
})();
