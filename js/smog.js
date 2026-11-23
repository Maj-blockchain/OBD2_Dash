/* Smog check / MOT readiness: a pass/fail prediction from the MIL, codes, readiness monitors and module scan,
   plus Mode 06 on-board test results and per-cylinder misfire counts. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const ctx = () => OBD.ctx;
  let m06 = null, m06At = null;

  const rules = () => $('smog-rules').value;
  function modelYear() {
    const v = +$('smog-year').value;
    if (v) return v;
    const i = ctx().vehicle.info;
    return i && i.year ? i.year : null;
  }
  function diesel() {
    const f = $('smog-fuel').value;
    if (f !== 'auto') return f === 'diesel';
    const m = ctx().diag.monitors, ft = ctx().latest.fuelType;
    return ft === 4 || ft === 19 || !!(m && /diesel/i.test(m.ignition));
  }

  /** Returns { verdict: 'pass'|'notready'|'fail'|'nodata', checks: [{level, title, text}] } */
  function evaluate() {
    const { diag, latest, connected } = ctx();
    const m = diag.monitors, d = diag.dtcs, r = rules(), year = modelYear(), dsl = diesel();
    if (!m) return { verdict: 'nodata', checks: [{ level: 'info', title: connected ? 'Waiting for monitor status' : OBD.t('Not connected'), text: 'Connect to the vehicle with the ignition on.' }] };
    const checks = [];
    let fail = false, notReady = false;
    const push = (level, title, text) => checks.push({ level, title, text });

    // 1. Malfunction indicator lamp
    if (m.mil) {
      const exempt = r === 'mot' && dsl && year && year < 2008;
      if (!exempt) fail = true;
      push(exempt ? 'warning' : 'critical', 'Check engine light (MIL) is ON',
        r === 'mot' ? (exempt ? 'MOT testers only check the engine MIL on diesels first used from 1 July 2008; still repair the fault.' : 'A lit engine MIL is a major defect (MOT manual 8.2.1.2 / 8.2.2.2): automatic fail.')
          : r === 'epa' ? 'A commanded-on MIL fails the OBD inspection.' : 'Most periodic inspections fail a vehicle with the MIL on.');
    } else push('good', 'Check engine light (MIL) is off', 'The ECU is not requesting the warning lamp.');

    // 2. Trouble codes
    if (d.stored.length) push(m.mil ? 'serious' : 'warning', `${d.stored.length} stored code${d.stored.length > 1 ? 's' : ''}: ${d.stored.join(', ')}`, 'Repair and verify before the test.');
    if (d.pending.length) push('warning', `Pending: ${d.pending.join(', ')}`, 'May turn the MIL on during the next drive cycle, possibly on the way to the test.');
    if (d.permanent.length) {
      push(r === 'epa' ? 'serious' : 'info', `Permanent code${d.permanent.length > 1 ? 's' : ''}: ${d.permanent.join(', ')}`,
        r === 'epa' ? 'Some US programs (for example California) fail a vehicle with permanent codes. They clear only after the ECU re-tests the repair over 1–3 drive cycles.' : 'Clears itself once the ECU confirms the repair; drive normally for a few days.');
      if (r === 'epa') notReady = true;
    }
    if (!d.stored.length && !d.pending.length && !d.permanent.length) push('good', 'No engine trouble codes', 'Stored, pending and permanent lists are empty.');

    // 3. Readiness monitors
    const sup = m.monitors.filter((x) => x.supported && !x.continuous), inc = sup.filter((x) => !x.complete);
    const allowed = r === 'epa' ? (year && year <= 2000 ? 2 : 1) : r === 'eu' ? 1 : null;
    const names = inc.map((x) => x.name).join(', ');
    if (allowed == null) {
      push(inc.length > 1 ? 'warning' : 'good', `${sup.length - inc.length}/${sup.length} readiness monitors complete`,
        inc.length ? `Incomplete: ${names}. The MOT does not read monitors, but several incomplete monitors usually mean codes were cleared recently, and the tailpipe emissions test may still be affected.` : 'All emission monitors have run.');
    } else if (inc.length > allowed) {
      notReady = true;
      push('serious', `${inc.length} monitors incomplete (max ${allowed} allowed${r === 'epa' ? year ? ` for model year ${year}` : ' for 2001+' : ''})`, `Incomplete: ${names}. Drive a full drive cycle (mixed city and steady 40–60 mph, cold start to hot) and re-check.`);
    } else push('good', `${sup.length - inc.length}/${sup.length} readiness monitors complete`, inc.length ? `Incomplete: ${names} (within the ${allowed} allowed).` : 'All emission monitors have run.');
    if (r === 'epa' && !year) push('info', 'Model year unknown', 'Enter the model year: 1996–2000 vehicles may have 2 incomplete monitors, 2001+ only 1.');

    // 4. Recently cleared
    if ((latest.warmups != null && latest.warmups < 3) || (latest.distClear != null && latest.distClear < 50))
      push('warning', 'Codes were cleared recently', `${latest.warmups ?? '?'} warm-ups and ${ctx().fmt('dist', latest.distClear)} since the codes were cleared. Test stations can see this; drive more first.`);

    // 5. Other warning lamps (MOT) from the full system scan
    if (r === 'mot') {
      const mods = OBD.systems ? OBD.systems.modules : [];
      if (!mods.length) push('info', 'Other warning lamps not checked', 'Run a Full system scan: the MOT also fails a lit airbag (SRS), ABS, EPB or TPMS (cars from 2012) warning lamp.');
      for (const mod of mods) {
        const live = (mod.dtcs || []).filter((x) => x.confirmed || x.active);
        if (!live.length) continue;
        const [cat] = OBD.systems.categorise(mod.name, mod.tx);
        const lamp = { 'Airbag (SRS)': 'airbag (SRS)', 'ABS / stability': 'ABS', 'Parking brake (EPB)': 'parking brake', 'Tyre pressure (TPMS)': 'TPMS' }[cat];
        if (lamp) { fail = true; push('critical', `${cat}: ${live.map((x) => x.code).join(', ')}`, `The ${lamp} warning lamp is probably lit: that is an MOT failure${lamp === 'TPMS' ? ' for cars first used from 1 January 2012' : ''}.`); }
      }
    }
    return { verdict: fail ? 'fail' : notReady ? 'notready' : 'pass', checks };
  }

  function render() {
    const { verdict, checks } = evaluate(), { statusHtml, esc } = ctx();
    const V = { pass: ['good', OBD.t('Ready'), rules() === 'mot' ? 'No OBD-related MOT failures found. The tester still checks tailpipe emissions and everything else.' : 'Should pass the OBD part of the inspection.'],
      notready: ['warning', OBD.t('Not ready'), 'Not ready for the OBD inspection yet: see below.'], fail: ['critical', OBD.t('Will fail'), 'Will fail as things stand: fix the items marked in red.'],
      nodata: ['info', '—', 'No data yet.'] }[verdict];
    $('smog-verdict').className = 'verdict ' + V[0];
    $('smog-verdict').innerHTML = `${statusHtml(V[0], V[1])}<span>${V[2]}</span>`;
    $('smog-checks').innerHTML = checks.map((c) => `<li class="alert ${c.level}"><span class="ic">${{ good: '✓', warning: '!', serious: '!', critical: '✕', info: 'i' }[c.level]}</span><div><b>${esc(c.title)}</b><p>${esc(c.text)}</p></div></li>`).join('');
  }

  async function readMode06() {
    const c = ctx();
    if (!c.connected) return c.toast(OBD.t('Not connected'));
    if (!c.client.isCan()) return c.toast('Mode 06 results are shown here for CAN vehicles only');
    $('m06').innerHTML = '<p class="muted">Reading…</p>';
    try {
      m06 = await c.exclusive('Reading Mode 06', (cl) => cl.readMode06((i, n) => { $('m06').innerHTML = `<p class="muted">Reading monitor ${i} of ${n}…</p>`; }));
      m06At = new Date();
    } catch (e) { m06 = null; c.toast(e.message); }
    renderM06();
    c.emit('mode06', m06);
  }

  function renderM06() {
    const { esc, statusHtml } = ctx();
    if (!m06) { $('m06').innerHTML = '<p class="muted">No results read.</p>'; $('m06-misfire').innerHTML = ''; return; }
    if (!m06.results.length) { $('m06').innerHTML = '<p class="muted">The ECU reported no Mode 06 tests.</p>'; return; }
    const fmtv = (v, u) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3)) + (u ? ' ' + u : '');
    const notMisfire = m06.results.filter((r) => r.mid < 0xA1 || r.mid > 0xAD);
    const fails = notMisfire.filter((r) => !r.pass);
    $('m06').innerHTML = `<p>${fails.length ? statusHtml('serious', `${fails.length} test${fails.length > 1 ? 's' : ''} failed`) : statusHtml('good', 'All tests within limits')}
      <span class="muted"> · ${notMisfire.length} tests · read ${m06At.toLocaleTimeString()}</span></p>
      <div class="table-wrap"><table class="m06"><thead><tr><th>Monitor</th><th>Test</th><th class="num">Value</th><th class="num">Min</th><th class="num">Max</th><th>Result</th></tr></thead><tbody>
      ${notMisfire.map((r) => `<tr class="${r.pass ? '' : 'fail'}"><td>${esc(r.name)}</td><td class="muted">${esc(r.test)}</td><td class="num">${fmtv(r.value, r.unit)}</td><td class="num">${fmtv(r.min, '')}</td><td class="num">${fmtv(r.max, '')}</td>
        <td>${r.pass ? statusHtml('good', 'Pass') : statusHtml('critical', 'Fail')}</td></tr>`).join('')}</tbody></table></div>
      <p class="note">Values are the ECU's latest test results; a test that has not run since the codes were cleared often reads 0 with 0 limits.</p>`;
    const cyl = m06.results.filter((r) => r.mid > 0xA1 && r.mid <= 0xAD && r.tid === 0x0C);
    const avg = m06.results.filter((r) => r.mid > 0xA1 && r.mid <= 0xAD && r.tid === 0x0B);
    if (!cyl.length) { $('m06-misfire').innerHTML = ''; return; }
    const max = Math.max(10, ...cyl.map((r) => r.value));
    $('m06-misfire').innerHTML = `<h3>Misfire counts per cylinder <span class="muted">· current / last drive cycle</span></h3>
      <ul class="bars">${cyl.map((r) => { const a = avg.find((x) => x.mid === r.mid); const bad = r.value >= 20;
        return `<li><span>Cyl ${r.mid - 0xA1}</span><div class="bar"><i style="width:${r.value / max * 100}%;background:var(--${bad ? 'critical' : r.value ? 'warning' : 'good'})"></i></div><b>${r.value}</b><span class="muted">${a ? 'avg ' + a.value : ''}</span></li>`; }).join('')}</ul>`;
  }

  OBD.smog = { evaluate, get mode06() { return m06; } };
  OBD.on('init', () => {
    $('smog-rules').value = localStorage.getItem('obd-smog-rules') || 'mot';
    $('smog-year').value = localStorage.getItem('obd-smog-year') || '';
    $('smog-rules').onchange = () => { localStorage.setItem('obd-smog-rules', rules()); render(); };
    $('smog-year').onchange = () => { localStorage.setItem('obd-smog-year', $('smog-year').value); render(); };
    $('smog-fuel').onchange = render;
    $('m06-run').onclick = readMode06;
    render();
  });
  ['diag', 'connected', 'disconnected', 'systems', 'lang', 'units'].forEach((ev) => OBD.on(ev, render));
  OBD.on('connected', () => { m06 = null; renderM06(); if (!$('smog-year').value && ctx().vehicle.info) $('smog-year').placeholder = ctx().vehicle.info.year || ''; });
})(window.OBD = window.OBD || {});
