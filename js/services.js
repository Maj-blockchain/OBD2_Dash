/* Six service / reset functions: oil reset, throttle adaptation, EPB, battery registration, TPMS, DPF regeneration.
   Each one checks its preconditions against live data. The commands themselves are manufacturer-specific UDS
   routines; they run only where a routine profile exists for the vehicle (today: the simulator). For other
   vehicles the card gives the manual method and lets you log the job in the service history. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ctx = () => OBD.ctx;
  const L = () => ctx().latest;
  const run = () => ctx().running();
  const fuelDiesel = () => L().fuelType === 4 || L().fuelType === 19 || (ctx().diag.monitors && /diesel/i.test(ctx().diag.monitors.ignition));
  const codes = () => { const d = ctx().diag.dtcs; return [...d.stored, ...d.pending]; };
  const c = (ok, text, required = true) => ({ ok, text, required });

  const SERVICES = [
    { id: 'oil', name: 'Oil service reset', icon: '🛢',
      what: 'Resets the service / oil-life reminder after an oil and filter change.',
      pre: () => [c(ctx().connected, 'Ignition on, adapter connected'), c(!run(), 'Engine off', false)],
      manual: ['Many cars reset from the dashboard: ignition on, hold the trip / reset button (or use the cluster menu: Settings → Service).', 'Check the owner’s handbook for your model; some need the brake pedal pressed or the accelerator pressed several times.'],
      result: (pct, extra) => (pct >= 100 ? `Oil life now ${extra}%` : '') },
    { id: 'throttle', name: 'Throttle adaptation', icon: '◍',
      what: 'Re-learns the throttle body’s closed position after cleaning or replacing it, or after disconnecting the battery. Fixes high or hunting idle.',
      pre: () => [c(ctx().connected, 'Ignition on'), c(!run(), 'Engine off (ignition on)'), c(L().pedal == null || L().pedal < 20, 'Accelerator pedal released'),
        c(L().voltage == null || L().voltage >= 12.0, 'Battery above 12.0 V'), c(!codes().some((x) => /^P(012[0-4]|0220|022[1-4]|210[0-9]|2135|0638)$/.test(x)), 'No throttle / pedal sensor codes')],
      manual: ['Generic method used by many makes: ignition on for 10 s without touching the pedal, ignition off for 10 s, then start and idle for 1–2 minutes with all loads off.', 'Some makes (e.g. some VAG, Nissan) use a specific pedal/timing sequence; check the service information for your model.'] },
    { id: 'epb', name: 'Electronic parking brake', icon: 'Ⓟ', modes: [['01', 'Open: service position (to replace pads)'], ['00', 'Close: apply after the job']],
      what: 'Winds the rear calipers fully back so pads can be replaced, then closes and recalibrates them.',
      pre: () => [c(ctx().connected, 'Ignition on'), c(!run(), 'Engine off'), c((L().speed || 0) < 1, 'Vehicle stationary'), c(L().voltage == null || L().voltage >= 12.0, 'Battery above 12.0 V'),
        c(true, 'Wheels chocked and the car secured (confirm yourself)', false)],
      manual: ['Many cars have a button sequence for the service position (e.g. ignition on, hold the EPB switch down and press the accelerator); check the handbook.', 'Never force the caliper piston back on an EPB caliper with a wind-back tool while the motor is fitted.'],
      result: (pct, extra) => (pct >= 100 ? (extra ? 'Calipers open (service position)' : 'Calipers closed and calibrated') : '') },
    { id: 'bms', name: 'Battery registration (BMS)', icon: '▮', input: true,
      what: 'Tells the battery management system that a new battery has been fitted, and its capacity and type, so it charges it correctly.',
      pre: () => [c(ctx().connected, 'Ignition on'), c(!run(), 'Engine off'), c(L().voltage == null || L().voltage >= 12.2, 'Battery above 12.2 V (new battery charged)')],
      manual: ['Cars without a battery sensor on the negative terminal usually do not need registration.', 'BMW, VAG, Mercedes, Volvo, Ford (with BMS) and others do: an unregistered new battery is over/under-charged and ages quickly.'],
      result: () => '' },
    { id: 'tpms', name: 'TPMS reset', icon: '◌',
      what: 'Resets / relearns the tyre pressure monitoring system after adjusting pressures, rotating wheels or fitting sensors.',
      pre: () => [c(ctx().connected, 'Ignition on'), c((L().speed || 0) < 1, 'Vehicle stationary'), c(true, 'All tyres set to the placard pressure (confirm yourself)', false)],
      manual: ['Indirect TPMS (ABS-based): set the pressures, then use the TPMS reset button or the menu, then drive 10–20 minutes.', 'Direct TPMS (sensor in each valve): new sensors may need a TPMS activation tool to program their IDs.'] },
    { id: 'dpf', name: 'DPF regeneration', icon: '♨', long: true,
      what: 'Forces a stationary regeneration: the engine raises exhaust temperature to burn the soot out of the diesel particulate filter.',
      pre: () => [c(fuelDiesel(), 'Diesel engine with a DPF'), c(run(), 'Engine running at idle'), c((L().speed || 0) < 1, 'Vehicle stationary, parking brake on'),
        c((L().coolant || 0) >= 70, 'Coolant at least 70 °C'), c(L().fuelLevel == null || L().fuelLevel >= 25, 'Fuel level at least 25%'),
        c(!codes().some((x) => /^P(245[2-5]|0401|0402|040[0-9]|020[1-8])$/.test(x)), 'No DPF pressure sensor, EGR or injector codes'), c(true, 'Outdoors, nothing flammable near the exhaust (confirm yourself)', false)],
      manual: ['Drive at a steady 2,500–3,000 rpm (e.g. 50–60 mph in a lower gear) on a fast road for 20–30 minutes without stopping.', 'If the DPF light stays on after that, a forced regeneration with a dealer-level tool is needed.'],
      warn: 'The exhaust gets extremely hot (over 600 °C). Do not switch off the engine or leave the car unattended during regeneration.',
      result: (pct, extra) => `Soot load ${extra}%` },
  ];

  // Routine profiles: which module + routine implements each service on this vehicle.
  function provider() {
    const t = ctx().transport;
    if (t && t instanceof OBD.SimulatedElmTransport) return { name: 'Simulator routines', routines: OBD.SimulatedElmTransport.routines };
    const make = ctx().vehicle.info && ctx().vehicle.info.wmi;
    const p = (OBD.SERVICE_PROFILES || {})[make];
    return p || null;
  }

  // ---------- History ----------
  const histKey = 'obd-service-history';
  const history = () => JSON.parse(localStorage.getItem(histKey) || '[]');
  function logJob(svc, result, note = '') {
    const h = history();
    h.unshift({ at: new Date().toISOString(), id: svc.id, name: svc.name, result, note, vin: ctx().vin || null, km: ctx().latest.distClear != null ? Math.round(ctx().latest.distClear) : null });
    localStorage.setItem(histKey, JSON.stringify(h.slice(0, 200)));
    renderHistory();
  }
  function renderHistory() {
    const h = history(), { esc } = ctx();
    $('svc-history').innerHTML = h.length ? h.map((j) => `<li><span class="muted">${new Date(j.at).toLocaleString()}</span><b>${esc(OBD.t(j.name))}</b>
      <span>${esc(j.result)}${j.note ? ' · ' + esc(j.note) : ''}</span><span class="muted mono">${esc(j.vin || '')}</span></li>`).join('') : '<li class="empty">No service jobs logged yet.</li>';
  }

  // ---------- Cards ----------
  const state = {}; // id -> {running, pct, text}
  function render() {
    const prov = provider(), { esc, statusHtml } = ctx();
    $('svc-provider').textContent = !ctx().connected ? OBD.t('Not connected') : prov ? `Commands: ${prov.name}` : 'No command profile for this vehicle: manual methods shown';
    const keep = {};
    $('services').querySelectorAll('[data-id]').forEach((card) => {
      keep[card.dataset.id] = { open: card.querySelector('details.manual')?.open, vals: [...card.querySelectorAll('input,select')].map((el) => el.value) };
    });
    $('services').innerHTML = SERVICES.map((s) => {
      const pre = s.pre(), ok = pre.every((p) => p.ok || !p.required), st = state[s.id] || {};
      const supported = prov && prov.routines[s.id];
      return `<article class="service" data-id="${s.id}">
        <div class="svc-h"><span class="svc-ic" aria-hidden="true">${s.icon}</span><h3>${esc(OBD.t(s.name))}</h3></div>
        <p class="muted">${esc(s.what)}</p>
        <h4>${OBD.t('Preconditions')}</h4>
        <ul class="pre">${pre.map((p) => `<li>${p.ok ? statusHtml('good', '') : p.required ? statusHtml('warning', '') : statusHtml('info', '')}<span>${esc(p.text)}</span></li>`).join('')}</ul>
        ${s.warn ? `<p class="dtc-note">${esc(s.warn)}</p>` : ''}
        ${s.input ? `<div class="svc-input"><label class="field"><span>Capacity (Ah)</span><input class="input" type="number" min="20" max="250" value="70" data-ah></label>
          <label class="field"><span>Type</span><select data-type><option>AGM</option><option>EFB</option><option>Flooded (lead-acid)</option><option>Lithium</option></select></label></div>` : ''}
        ${s.modes ? `<div class="svc-input"><label class="field"><span>Action</span><select data-mode>${s.modes.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select></label></div>` : ''}
        ${st.running || st.text ? `<div class="progress"><div class="bar"><i style="width:${st.pct || 0}%"></i></div><span>${esc(st.text || '')}</span></div>` : ''}
        <div class="btns">
          ${supported ? (st.running ? `<button class="btn small danger" data-act="stop">${OBD.t('Stop')}</button>`
            : `<button class="btn small primary" data-act="start" ${ok && ctx().connected ? '' : 'disabled'}>${OBD.t('Start')}</button>`) : ''}
          <button class="btn small" data-act="log">${OBD.t('Log as done')}</button>
        </div>
        ${!supported ? `<details class="manual"><summary>Manual method</summary><ol>${s.manual.map((m) => `<li>${esc(m)}</li>`).join('')}</ol>
          <p class="muted">This needs a manufacturer-specific command that a generic OBD2 adapter cannot send safely without a profile for your make.</p></details>` : ''}
      </article>`;
    }).join('');
    $('services').querySelectorAll('[data-id]').forEach((card) => {
      const k = keep[card.dataset.id]; if (!k) return;
      if (k.open) card.querySelector('details.manual') && (card.querySelector('details.manual').open = true);
      card.querySelectorAll('input,select').forEach((el, i) => { if (k.vals[i] != null) el.value = k.vals[i]; });
    });
  }

  async function start(s, card) {
    const prov = provider(), r = prov.routines[s.id];
    let data = '', note = '';
    if (s.input) {
      const ah = +card.querySelector('[data-ah]').value, type = card.querySelector('[data-type]').value;
      if (!(ah >= 20 && ah <= 250)) return ctx().toast('Enter the battery capacity in Ah (from the battery label)');
      data = ah.toString(16).toUpperCase().padStart(2, '0') + (['AGM', 'EFB', 'Flooded (lead-acid)', 'Lithium'].indexOf(type) + 1).toString(16).padStart(2, '0');
      note = `${ah} Ah ${type}`;
    }
    if (s.modes) { data = card.querySelector('[data-mode]').value; note = s.modes.find(([v]) => v === data)[1].split(':')[0]; }
    const ok = await OBD.confirm(`${OBD.t(s.name)}?`, `<p>${ctx().esc(s.what)}</p>${s.warn ? `<p class="dtc-note">${ctx().esc(s.warn)}</p>` : ''}<p class="muted">Keep the ignition on and the adapter connected until it finishes.</p>`, OBD.t('Start'));
    if (!ok) return;
    state[s.id] = { running: true, pct: 0, text: 'Starting…' }; render();
    try {
      const resp = await ctx().exclusive(s.name, (cl) => cl.routine(r.tx, '01', r.rid, data).finally(() => cl.untarget()));
      if (!resp) throw new Error('The module refused the routine: conditions not met (check the preconditions)');
      // Poll results between live-data cycles so the dashboard keeps updating
      for (;;) {
        await new Promise((res) => setTimeout(res, 1000));
        if (!state[s.id].running) break;
        const p = await ctx().exclusive(s.name, (cl) => cl.routine(r.tx, '03', r.rid).finally(() => cl.untarget()));
        const b = p ? OBD.bytesFrom(p) : null; // 71 03 RID RID running pct extra
        if (!b) throw new Error('Lost contact with the module');
        const [running, pct, extra] = b.slice(4);
        const res = s.result ? s.result(pct, extra) : '';
        state[s.id] = { running: !!running, pct, text: running ? `${pct}%${res ? ' · ' + res : ''}` : `Done${res ? ' · ' + res : ''}` };
        render();
        if (!running) { logJob(s, 'Completed' + (res ? ' · ' + res : ''), note); ctx().toast(`${OBD.t(s.name)}: completed`); break; }
      }
    } catch (e) {
      state[s.id] = { running: false, pct: 0, text: 'Failed: ' + e.message }; ctx().toast(e.message); render();
      logJob(s, 'Failed: ' + e.message, note);
    }
    ctx().refreshDiagnostics().catch(() => {});
  }

  async function stop(s) {
    const prov = provider(), r = prov.routines[s.id];
    state[s.id] = { running: false, pct: state[s.id].pct, text: 'Stopped by user' };
    try { await ctx().exclusive(s.name, (cl) => cl.routine(r.tx, '02', r.rid).finally(() => cl.untarget())); } catch (e) { ctx().toast(e.message); }
    logJob(s, 'Stopped by user'); render();
  }

  OBD.services = { SERVICES, history };
  OBD.SERVICE_PROFILES = OBD.SERVICE_PROFILES || {}; // { WMI: { name, routines: { oil: {tx, rid}, ... } } }

  OBD.on('init', () => {
    $('services').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const card = b.closest('[data-id]'), s = SERVICES.find((x) => x.id === card.dataset.id);
      if (b.dataset.act === 'start') start(s, card);
      if (b.dataset.act === 'stop') stop(s);
      if (b.dataset.act === 'log') OBD.confirm(`Log “${OBD.t(s.name)}” as done?`, '<p>Adds it to the service history (stored in this browser).</p>', OBD.t('Log as done')).then((ok) => ok && logJob(s, 'Done (manual)'));
    });
    $('svc-history-clear').onclick = () => OBD.confirm('Clear service history?', '<p>This removes every logged job from this browser.</p>', OBD.t('Clear history')).then((ok) => { if (ok) { localStorage.removeItem(histKey); renderHistory(); } });
    render(); renderHistory();
  });
  let visible = false, last = 0;
  OBD.on('view', (v) => { visible = v === 'service'; if (visible) render(); });
  OBD.on('live', () => { if (visible && performance.now() - last > 1000 && !document.querySelector('#services :focus')) { last = performance.now(); render(); } });
  ['connected', 'disconnected', 'diag', 'lang'].forEach((ev) => OBD.on(ev, render));
})(window.OBD = window.OBD || {});
