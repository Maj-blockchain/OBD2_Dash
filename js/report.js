/* Vehicle information (AutoVIN decode + Mode 09) and a printable / downloadable diagnostic report. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ctx = () => OBD.ctx;

  function vehicleRows() {
    const { vehicle, latest, client, esc } = ctx();
    const v = vehicle.info, e = vehicle.ecuInfo || {};
    const rows = [
      ['VIN', vehicle.vin || 'Not reported'],
      ['Manufacturer', v && !v.invalid ? v.make || `Unknown (WMI ${v.wmi})` : '—'],
      ['Built in', v && !v.invalid ? v.region : '—'],
      ['Model year', v && v.year ? v.year + (v.yearAlt ? ` (or ${v.yearAlt})` : '') : '—'],
      ['VIN check digit', v && !v.invalid ? (v.checkOk ? 'Valid' : v.northAmerica ? `Mismatch (expected ${v.expectedCheck})` : 'Not used outside North America') : '—'],
      ['Serial', v && !v.invalid ? v.serial : '—'],
      ['ECU name', (e.ecuName || []).join(', ') || '—'],
      ['Calibration ID', (e.calid || []).join(', ') || '—'],
      ['Calibration verification (CVN)', (e.cvn || []).join(', ') || '—'],
      ['OBD standard', OBD.enumText('1C', latest.obdStd) || '—'],
      ['Fuel type', OBD.enumText('51', latest.fuelType) || '—'],
      ['Protocol', client ? client.protocol : '—'],
      ['Adapter', client ? client.adapter : '—'],
      ['Supported PIDs', client ? client.supported.size : '—'],
    ];
    return rows.map(([a, b]) => [a, esc(String(b))]);
  }

  function renderVehicle() {
    $('vehicle-info').innerHTML = vehicleRows().map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  }

  function buildReport() {
    const { diag, latest, fmt, esc, vehicle } = ctx();
    const smog = OBD.smog.evaluate(), mods = OBD.systems.modules, m06 = OBD.smog.mode06;
    const dtcRow = (code, where) => { const d = OBD.describeDtc(code); return `<tr><td class="mono">${code}</td><td>${esc(d.title)}</td><td>${where}</td><td>${esc(OBD.DRIVE_ADVICE[d.drive].label)}</td></tr>`; };
    const engine = [...new Set([...diag.dtcs.stored, ...diag.dtcs.pending, ...diag.dtcs.permanent])];
    const live = [['Engine speed', fmt('rpm', latest.rpm)], ['Coolant', fmt('temp', latest.coolant)], ['System voltage', fmt('volt', latest.voltage)],
      ['Fuel trim B1 (short / long)', `${fmt('trim', latest.stft1)} / ${fmt('trim', latest.ltft1)}`], ['Distance since codes cleared', fmt('dist', latest.distClear)],
      ['Distance with MIL on', fmt('dist', latest.distMil)], ['Fuel level', fmt('pct', latest.fuelLevel)]];
    const hist = OBD.services.history().filter((j) => !vehicle.vin || !j.vin || j.vin === vehicle.vin).slice(0, 15);
    const monitors = diag.monitors ? diag.monitors.monitors.filter((m) => m.supported) : [];
    const sev = { pass: 'Ready', notready: 'Not ready', fail: 'Will fail', nodata: 'No data' }[smog.verdict];
    return `<header class="rep-h"><div><h2>Vehicle diagnostic report</h2><p class="muted">${new Date().toLocaleString()} · OBD2 Mechanic Dashboard</p></div>
        <div class="rep-badge ${smog.verdict}">${sev}<small>${{ mot: 'UK MOT', epa: 'US smog check', eu: 'EU inspection' }[$('smog-rules').value]}</small></div></header>
      <h3>Vehicle</h3><table>${vehicleRows().slice(0, 9).map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      <h3>Engine trouble codes <span class="muted">(MIL ${diag.monitors ? (diag.monitors.mil ? 'ON' : 'off') : 'unknown'})</span></h3>
      ${engine.length ? `<table><thead><tr><th>Code</th><th>Description</th><th>Status</th><th>Advice</th></tr></thead>${engine.map((c) => dtcRow(c, ['stored', 'pending', 'permanent'].filter((t) => diag.dtcs[t].includes(c)).join(', '))).join('')}</table>` : '<p>No engine codes.</p>'}
      <h3>All modules <span class="muted">${OBD.systems.scannedAt ? '(scanned ' + OBD.systems.scannedAt.toLocaleTimeString() + ')' : '(full system scan not run)'}</span></h3>
      ${mods.length ? `<table><thead><tr><th>Module</th><th>Address</th><th>Codes</th></tr></thead>${mods.map((m) => `<tr><td>${esc(m.name || OBD.systems.categorise(m.name, m.tx)[0])}</td><td class="mono">${m.tx}</td>
        <td>${!m.alive ? 'No response' : m.dtcs && m.dtcs.length ? m.dtcs.map((d) => `<b class="mono">${d.code}</b> ${esc(OBD.describeDtc(d.code).title)}`).join('<br>') : 'None'}</td></tr>`).join('')}</table>` : '<p class="muted">Not scanned.</p>'}
      <h3>Inspection readiness</h3><ul class="rep-list">${smog.checks.map((c) => `<li class="${c.level}"><b>${esc(c.title)}</b> ${esc(c.text)}</li>`).join('')}</ul>
      ${monitors.length ? `<table><thead><tr><th>Monitor</th><th>Status</th></tr></thead>${monitors.map((m) => `<tr><td>${m.name}${m.continuous ? ' <span class="muted">(continuous)</span>' : ''}</td><td>${m.complete ? 'Complete' : 'Incomplete'}</td></tr>`).join('')}</table>` : ''}
      ${m06 && m06.results.length ? `<h3>Mode 06 failed tests</h3>${m06.results.filter((r) => !r.pass).length ? `<table>${m06.results.filter((r) => !r.pass).map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.test)}</td><td>${r.value.toFixed(3)} (limits ${r.min.toFixed(3)}–${r.max.toFixed(3)} ${esc(r.unit)})</td></tr>`).join('')}</table>` : '<p>None: all on-board tests within limits.</p>'}` : ''}
      ${diag.freeze ? `<h3>Freeze frame (${diag.freeze.dtc})</h3><table>${Object.entries(diag.freeze.values).map(([pid, v]) => `<tr><td>${OBD.PIDS[pid].label}</td><td>${fmt(OBD.PIDS[pid].kind, v)}</td></tr>`).join('')}</table>` : ''}
      <h3>Live snapshot</h3><table>${live.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>
      ${hist.length ? `<h3>Service history</h3><table>${hist.map((j) => `<tr><td>${new Date(j.at).toLocaleDateString()}</td><td>${esc(j.name)}</td><td>${esc(j.result)}${j.note ? ' · ' + esc(j.note) : ''}</td></tr>`).join('')}</table>` : ''}
      <p class="note">Generated from generic OBD-II and UDS data. Code meanings for manufacturer-specific codes vary by make; confirm with the service information for this vehicle.</p>`;
  }

  function renderReport() { $('report').innerHTML = buildReport(); }

  function download() {
    renderReport();
    const css = [...document.styleSheets].map((s) => { try { return [...s.cssRules].map((r) => r.cssText).join('\n'); } catch { return ''; } }).join('\n');
    const html = `<!DOCTYPE html><html lang="${document.documentElement.lang}" data-theme="light"><head><meta charset="utf-8"><title>Diagnostic report ${ctx().vin || ''}</title><style>${css}
      body{padding:24px;max-width:900px;margin:auto}</style></head><body><div class="report">${$('report').innerHTML}</div></body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    a.download = `diagnostic-report-${ctx().vin || 'vehicle'}-${new Date().toISOString().slice(0, 10)}.html`;
    a.click();
  }

  let visible = false;
  OBD.on('init', () => {
    $('rep-refresh').onclick = renderReport;
    $('rep-print').onclick = () => { renderReport(); document.body.classList.add('printing-report'); print(); document.body.classList.remove('printing-report'); };
    $('rep-download').onclick = download;
    renderVehicle(); renderReport();
  });
  OBD.on('view', (v) => { visible = v === 'report'; if (visible) { renderVehicle(); renderReport(); } });
  ['connected', 'diag', 'systems', 'mode06', 'units'].forEach((ev) => OBD.on(ev, () => { renderVehicle(); if (visible) renderReport(); }));
})(window.OBD = window.OBD || {});
