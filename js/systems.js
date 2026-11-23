/* Full system diagnosis: finds every module on the CAN bus and reads / clears its trouble codes with UDS. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ctx = () => OBD.ctx;
  let modules = [], scannedAt = null, cancel = false, scanning = false;

  const CATEGORIES = [
    [/ENGINE|ECM|PCM|DME|MOTOR/i, 'Engine', '⚙'], [/TRANS|TCM|GEAR|DSG|CVT/i, 'Transmission', '⇄'], [/ABS|ESP|ESC|BRAKE.*CONTROL|DSC|VSC/i, 'ABS / stability', '◎'],
    [/AIRBAG|SRS|RESTRAINT|ACSM/i, 'Airbag (SRS)', '✱'], [/STEER|SAS|EPS|EPAS/i, 'Steering', '◐'], [/TPMS|TYRE|TIRE/i, 'Tyre pressure (TPMS)', '◌'],
    [/PARK.*BRAKE|EPB/i, 'Parking brake (EPB)', 'Ⓟ'], [/CLIMATE|HVAC|A\/C|AIR ?CON/i, 'Climate / A/C', '❄'], [/RADIO|INFOTAIN|AUDIO|HEAD ?UNIT|MMI|NAV/i, 'Radio / infotainment', '♫'],
    [/BATTERY|BMS|POWER ?MAN/i, 'Battery management', '▮'], [/GATEWAY|GW\b/i, 'Gateway', '⌘'], [/CLUSTER|INSTRUMENT|KOMBI|IPC/i, 'Instrument cluster', '◔'],
    [/BODY|BCM|COMFORT/i, 'Body control', '▣'],
  ];
  const categorise = (name, tx) => {
    if (!name) return tx === '7E0' ? ['Engine', '⚙'] : tx === '7E1' ? ['Transmission', '⇄'] : ['Module', '□'];
    const hit = CATEGORIES.find(([re]) => re.test(name));
    return hit ? [hit[1], hit[2]] : ['Module', '□'];
  };

  const knownKey = () => 'obd-modules-' + (ctx().vin || 'unknown');
  const known = () => JSON.parse(localStorage.getItem(knownKey()) || '[]');
  const remember = (ids) => localStorage.setItem(knownKey(), JSON.stringify([...new Set([...known(), ...ids])].sort()));

  function progress(text, frac) {
    $('sys-progress').hidden = text == null;
    if (text == null) return;
    $('sys-progress').querySelector('span').textContent = text;
    $('sys-progress').querySelector('i').style.width = Math.round((frac || 0) * 100) + '%';
  }

  async function scan(deep) {
    const c = ctx();
    if (!c.connected) return c.toast(OBD.t('Not connected'));
    if (scanning) return;
    if (!c.client.isCan()) {
      modules = [{ tx: '7E0', alive: true, name: 'ENGINE (generic OBD-II)', obdOnly: true, dtcs: engineCodes() }];
      scannedAt = new Date(); render();
      return c.toast('This vehicle does not use CAN: only the engine can be read over generic OBD-II');
    }
    scanning = true; cancel = false;
    try {
      await c.exclusive(deep ? 'Deep module scan' : 'Module scan', async (cl) => {
        progress('Finding OBD-II control units…', 0.02);
        let ids = await cl.discoverObdEcus();
        if (!ids.length) ids = ['7E0'];
        if (deep) {
          const found = await cl.probeAddresses((i, n, tx) => progress(`Probing address ${tx}…`, i / n * 0.7), () => cancel);
          ids = [...ids, ...found];
          if (!cancel) remember(found);
        }
        ids = [...new Set([...ids, ...known()])].sort();
        const out = [];
        for (let i = 0; i < ids.length && !cancel; i++) {
          progress(`Reading module ${ids[i]} (${i + 1}/${ids.length})…`, (deep ? 0.7 : 0.05) + (i + 1) / ids.length * (deep ? 0.3 : 0.95));
          try { out.push(await cl.readModule(ids[i])); } catch (e) { out.push({ tx: ids[i], alive: false, error: e.message }); }
        }
        await cl.untarget();
        modules = out.filter((m) => m.alive || ['7E0', '7E1'].includes(m.tx));
        remember(modules.filter((m) => m.alive).map((m) => m.tx));
      });
      scannedAt = new Date();
      const n = modules.reduce((a, m) => a + (m.dtcs ? m.dtcs.length : 0), 0);
      c.toast(cancel ? 'Scan cancelled' : `${modules.length} modules scanned · ${n} code${n === 1 ? '' : 's'}`);
      c.emit('systems', modules);
    } catch (e) { c.toast(e.message); }
    finally { scanning = false; progress(null); render(); }
  }

  function engineCodes() {
    const d = ctx().diag.dtcs, out = [];
    d.stored.forEach((code) => out.push({ code, ftb: '00', confirmed: true, active: true, pending: false }));
    d.pending.filter((x) => !d.stored.includes(x)).forEach((code) => out.push({ code, ftb: '00', pending: true }));
    return out;
  }

  async function clearAll() {
    const c = ctx();
    if (!c.connected) return c.toast(OBD.t('Not connected'));
    if (!modules.length) return c.toast('Scan the modules first');
    const ok = await OBD.confirm('Clear codes in all modules?',
      `<p>Sends "clear diagnostic information" to the ${modules.length} module(s) found. Engine readiness monitors will reset, and faults that are still present (e.g. a broken sensor) will come straight back.</p><p class="muted">Ignition on, engine off is recommended. Note the codes first, or download the report.</p>`, 'Clear all codes');
    if (!ok) return;
    try {
      let n = 0;
      await c.exclusive('Clearing codes', async (cl) => {
        for (const m of modules) { progress(`Clearing ${m.tx}…`, ++n / modules.length); if (m.obdOnly) await cl.clearDtcs(); else await cl.clearModule(m.tx); }
        await cl.untarget();
      });
      c.toast('Clear sent to all modules, re-scanning…');
    } catch (e) { c.toast(e.message); }
    progress(null);
    await c.refreshDiagnostics();
    await scan(false);
  }

  async function clearOne(tx) {
    const c = ctx(), m = modules.find((x) => x.tx === tx);
    if (!(await OBD.confirm(`Clear codes in ${m.name || tx}?`, '<p>Faults that are still present will be detected again.</p>', 'Clear codes'))) return;
    try { await c.exclusive('Clearing codes', async (cl) => { await cl.clearModule(tx); await cl.untarget(); }); } catch (e) { return c.toast(e.message); }
    if (tx === '7E0') await c.refreshDiagnostics();
    await scan(false);
  }

  function statusChips(d) {
    return [d.active && '<span class="chip">active</span>', d.confirmed && '<span class="chip">confirmed</span>', d.pending && '<span class="chip">pending</span>',
      !d.active && d.confirmed && '<span class="chip">history</span>', d.mil && '<span class="chip warn">warning lamp</span>'].filter(Boolean).join('');
  }

  function render() {
    const { esc, statusHtml } = ctx();
    const total = modules.reduce((a, m) => a + (m.dtcs ? m.dtcs.length : 0), 0), faulty = modules.filter((m) => m.dtcs && m.dtcs.length).length;
    $('sys-summary').innerHTML = !modules.length ? `<p class="muted">${ctx().connected ? 'Press “Scan modules”. The first time on a vehicle, run a deep scan to find every module.' : OBD.t('Not connected')}</p>`
      : `${total ? statusHtml(faulty > 1 ? 'serious' : 'warning', `${total} code${total > 1 ? 's' : ''} in ${faulty} module${faulty > 1 ? 's' : ''}`) : statusHtml('good', 'No codes in any module')}
         <span class="muted"> · ${modules.length} modules · scanned ${scannedAt.toLocaleTimeString()}</span>`;
    $('sys-modules').innerHTML = modules.map((m) => {
      const [cat, icon] = categorise(m.name, m.tx);
      const n = m.dtcs ? m.dtcs.length : 0;
      const state = !m.alive ? statusHtml('info', OBD.t('No response')) : !m.dtcs ? statusHtml('info', 'Codes not readable') : n ? statusHtml(n > 1 ? 'serious' : 'warning', `${n} code${n > 1 ? 's' : ''}`) : statusHtml('good', OBD.t('No codes'));
      const codes = (m.dtcs || []).map((d) => {
        const info = OBD.describeDtc(d.code);
        return `<li class="dtc sev-${info.severity}"><details><summary><span class="code">${d.code}${d.ftb && d.ftb !== '00' ? `<small>-${d.ftb}</small>` : ''}</span>
          <div class="sum-main"><div class="desc">${esc(info.title)}</div><div class="sys">${esc(info.system)} ${statusChips(d)}</div></div></summary>
          <div class="dtc-body">${info.note ? `<p class="dtc-note">${esc(info.note)}</p>` : ''}<p class="meaning">${esc(info.meaning)}</p>
          ${d.ftb && d.ftb !== '00' ? `<p class="muted">Failure type byte ${d.ftb}: sub-type of the fault defined by ISO 15031-6 / the manufacturer (e.g. circuit short, open, signal invalid).</p>` : ''}
          <div class="dtc-cols">${info.causes.length ? `<div><h4>Likely causes</h4><ol class="causes">${info.causes.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
          <div><h4>Recommended steps</h4><ol class="steps">${info.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div></div></div></details></li>`;
      }).join('');
      return `<li class="module ${n ? 'has-codes' : ''}"><div class="mod-h"><span class="mod-ic" aria-hidden="true">${icon}</span>
        <div class="mod-main"><b>${esc(m.name || cat)}</b><span class="muted">${cat} · address ${m.tx}${m.part ? ' · part ' + esc(m.part) : ''}${m.sw ? ' · sw ' + esc(m.sw) : ''}</span></div>
        ${state}${n ? `<button class="btn small" data-clear="${m.tx}">${OBD.t('Clear codes')}</button>` : ''}</div>
        ${n ? `<ul class="dtcs">${codes}</ul>` : ''}</li>`;
    }).join('');
  }

  // Generic confirmation dialog (shared with services)
  OBD.confirm = (title, html, okLabel = 'OK') => new Promise((resolve) => {
    const d = $('confirm-dialog');
    $('confirm-title').textContent = title; $('confirm-body').innerHTML = html; $('confirm-ok').textContent = okLabel;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });

  OBD.systems = { get modules() { return modules; }, get scannedAt() { return scannedAt; }, categorise };

  OBD.on('init', () => {
    $('sys-quick').onclick = () => scan(false);
    $('sys-deep').onclick = () => scan(true);
    $('sys-cancel').onclick = () => { cancel = true; };
    $('sys-clear').onclick = clearAll;
    $('sys-modules').addEventListener('click', (e) => { const b = e.target.closest('[data-clear]'); if (b) clearOne(b.dataset.clear); });
    $('sys-auto').checked = localStorage.getItem('obd-autoscan') !== '0';
    $('sys-auto').onchange = () => localStorage.setItem('obd-autoscan', $('sys-auto').checked ? '1' : '0');
    render();
  });
  OBD.on('connected', () => {
    modules = []; scannedAt = null; render();
    if ($('sys-auto').checked && ctx().client.ecuOk) {
      // AutoVIN & scan: first visit on a simulator runs the deep scan so every module shows up
      const first = !known().length && ctx().vehicle.source === 'sim';
      setTimeout(() => scan(first), 600);
    }
  });
  OBD.on('disconnected', () => { scanning = false; cancel = true; progress(null); render(); });
  OBD.on('lang', render);
})(window.OBD = window.OBD || {});
