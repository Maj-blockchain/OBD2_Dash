/* Live data view: every supported sensor with session min/max, plus user-chosen real-time graphs. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const MAX_GRAPHS = 6;
  let selected = JSON.parse(localStorage.getItem('obd-live-graphs') || '["rpm","load","maf"]');
  let charts = [], paused = false, filter = '', mm = {}, visible = false, built = '';

  const ctx = () => OBD.ctx;
  const pidOf = (key) => OBD.KEY_TO_PID[key];
  const def = (key) => OBD.PIDS[pidOf(key)];

  function valueText(key, v) {
    const pid = pidOf(key), d = def(key);
    if (v == null) return '—';
    return d.kind === 'enum' ? OBD.enumText(pid, v) : ctx().fmt(d.kind, v, false);
  }

  function keys() {
    const c = ctx().client;
    return Object.entries(OBD.PIDS).filter(([pid]) => !c || c.has(pid)).sort((a, b) => parseInt(a[0], 16) - parseInt(b[0], 16)).map(([, d]) => d.key);
  }

  function syncFast() {
    const f = ctx().extraFast; f.clear();
    if (visible) selected.forEach((k) => { const p = pidOf(k); if (p) f.add(p); });
  }

  function buildCharts() {
    $('live-charts').innerHTML = '';
    charts = selected.filter((k) => def(k) && def(k).kind !== 'enum').map((k, i) => {
      const d = def(k);
      return new OBD.LineChart($('live-charts'), {
        title: d.label, kind: d.kind, digits: { volt: 2, trim: 1, flow: 1, lph: 1, ratio: 3 }[d.kind] || 0,
        series: [{ key: k, label: d.label, color: ctx().color(i % 2) }], conv: ctx().conv(d.kind), unitOf: () => ctx().unitOf(d.kind),
      });
    });
    $('live-charts-empty').hidden = charts.length > 0;
    localStorage.setItem('obd-live-graphs', JSON.stringify(selected));
    syncFast();
  }

  function buildRows() {
    const list = keys().filter((k) => !filter || def(k).label.toLowerCase().includes(filter));
    const sig = list.join() + ctx().units;
    if (sig === built) return;
    built = sig;
    $('live-rows').innerHTML = list.map((k) => {
      const d = def(k);
      return `<tr data-key="${k}"><td>${d.label} <span class="muted pid">01 ${pidOf(k)}</span></td><td class="num v">—</td><td class="num mn">—</td><td class="num mx">—</td>
        <td class="u">${ctx().unitOf(d.kind)}</td><td>${d.kind === 'enum' ? '' : `<input type="checkbox" aria-label="Graph ${d.label}" ${selected.includes(k) ? 'checked' : ''}>`}</td></tr>`;
    }).join('');
  }

  function render() {
    if (!visible || paused) return;
    const { latest, history } = ctx();
    for (const [k, v] of Object.entries(latest)) {
      if (v == null || !def(k) || def(k).kind === 'enum') continue;
      const m = mm[k] || (mm[k] = { min: v, max: v });
      m.min = Math.min(m.min, v); m.max = Math.max(m.max, v);
    }
    buildRows();
    $('live-rows').querySelectorAll('tr').forEach((tr) => {
      const k = tr.dataset.key, v = latest[k], m = mm[k];
      tr.querySelector('.v').textContent = valueText(k, v);
      tr.querySelector('.mn').textContent = m ? valueText(k, m.min) : '—';
      tr.querySelector('.mx').textContent = m ? valueText(k, m.max) : '—';
      tr.classList.toggle('stale', v == null);
    });
    const now = performance.now();
    charts.forEach((c) => c.render(history, now));
  }

  OBD.on('init', () => {
    $('live-filter').oninput = (e) => { filter = e.target.value.trim().toLowerCase(); built = ''; render(); };
    $('live-rows').addEventListener('change', (e) => {
      const tr = e.target.closest('tr'); if (!tr) return;
      const k = tr.dataset.key;
      if (e.target.checked) {
        if (selected.length >= MAX_GRAPHS) { e.target.checked = false; return ctx().toast(`Up to ${MAX_GRAPHS} graphs at a time`); }
        selected.push(k);
      } else selected = selected.filter((x) => x !== k);
      buildCharts(); render();
    });
    $('live-pause').onclick = () => { paused = !paused; $('live-pause').textContent = OBD.t(paused ? 'Resume' : 'Pause'); $('live-pause').classList.toggle('on', paused); if (!paused) render(); };
    $('live-clear-graphs').onclick = () => { selected = []; built = ''; buildCharts(); render(); };
    $('live-export').onclick = () => ctx().exportCsv();
    buildCharts();
  });
  OBD.on('view', (v) => { visible = v === 'live'; syncFast(); if (visible) { built = ''; render(); } });
  OBD.on('live', render);
  OBD.on('resize', render);
  OBD.on('units', () => { built = ''; buildCharts(); render(); });
  OBD.on('connected', () => { mm = {}; built = ''; render(); });
  OBD.on('lang', () => { $('live-pause').textContent = OBD.t(paused ? 'Resume' : 'Pause'); });
})(window.OBD = window.OBD || {});
