/* Dashboard controller: connection, polling loop, rule-based alerts and rendering. */
(function (OBD) {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const { PIDS, KEY_TO_PID } = OBD;

  // ---------- Units ----------
  let units = localStorage.getItem('obd-units') || 'metric';
  const UNIT = {
    temp:     { metric: ['°C', (v) => v],   imperial: ['°F', (v) => v * 9 / 5 + 32] },
    speed:    { metric: ['km/h', (v) => v], imperial: ['mph', (v) => v * 0.621371] },
    dist:     { metric: ['km', (v) => v],   imperial: ['mi', (v) => v * 0.621371] },
    pressure: { metric: ['kPa', (v) => v],  imperial: ['psi', (v) => v * 0.145038] },
    lph:      { metric: ['L/h', (v) => v],  imperial: ['gal/h', (v) => v * 0.264172] },
    flow: ['g/s'], pct: ['%'], trim: ['%'], rpm: ['rpm'], volt: ['V'], deg: ['° BTDC'], count: [''], sec: [''], ratio: ['λ'], min: ['min'], enum: [''],
  };
  const unitOf = (kind) => { const u = UNIT[kind]; return Array.isArray(u) ? u[0] : u[units][0]; };
  const conv = (kind) => (v) => { const u = UNIT[kind]; return Array.isArray(u) ? v : u[units][1](v); };
  const DIGITS = { volt: 2, trim: 1, flow: 1, lph: 1, deg: 1, pressure: 0, ratio: 3 };
  function fmt(kind, v, withUnit = true) {
    if (v == null || isNaN(v)) return '—';
    if (kind === 'sec') { const h = Math.floor(v / 3600), m = Math.floor(v / 60) % 60, s = Math.floor(v % 60); return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`; }
    let d = DIGITS[kind] ?? 0;
    if (kind === 'pressure' && units === 'imperial') d = 1;
    const n = conv(kind)(v);
    const txt = (kind === 'trim' && n > 0 ? '+' : '') + n.toFixed(d);
    return withUnit && unitOf(kind) ? `${txt} ${unitOf(kind)}` : txt;
  }

  // ---------- Status rules (metric thresholds) ----------
  const ICON = { good: '✓', warning: '!', serious: '!', critical: '✕', info: 'i' };
  OBD.statusHtml = (s) => `<span class="status ${s.level}"><i>${ICON[s.level]}</i>${s.text}</span>`;
  const st = (level, text) => ({ level, text });
  const running = () => (latest.rpm || 0) > 400;

  const RULES = {
    rpm: (v) => v > 6500 ? st('warning', 'Near redline') : st('good', 'Normal'),
    speed: () => st('good', 'Normal'),
    coolant: (v) => v >= 110 ? st('critical', 'Overheating') : v >= 104 ? st('warning', 'Running hot')
      : v < 60 ? st('info', 'Warming up') : (v < 75 && (latest.runtime || 0) > 900) ? st('warning', 'Not reaching temp') : st('good', 'Normal'),
    voltage: (v) => running()
      ? (v < 12.8 ? st('critical', 'Not charging') : v < 13.3 ? st('warning', 'Low charge') : v > 15.0 ? st('critical', 'Overcharging') : v > 14.8 ? st('warning', 'High charge') : st('good', 'Charging OK'))
      : (v < 12.0 ? st('critical', 'Battery flat') : v < 12.4 ? st('warning', 'Battery low') : st('good', 'Battery OK')),
    oilTemp: (v) => v >= 135 ? st('critical', 'Oil overheating') : v >= 120 ? st('warning', 'Oil hot') : null,
    iat: (v) => v >= 60 ? st('warning', 'Hot intake air') : null,
    fuelLevel: (v) => v < 12 ? st('warning', 'Low fuel') : null,
    map: (v) => (latest.rpm < 1000 && latest.speed < 1 && v > 45) ? st('warning', 'Low vacuum at idle') : null,
  };
  const statusFor = (key) => RULES[key] && latest[key] != null ? RULES[key](latest[key]) : null;

  // ---------- State ----------
  let transport = null, client = null, connected = false, loopToken = 0, connectedAt = 0;
  let latest = {}, history = {}, csvRows = [], diag = { dtcs: { stored: [], pending: [], permanent: [] }, monitors: null, freeze: null };
  let dtcTab = 'stored';
  const HISTORY_MS = 65000;

  // ---------- UI build ----------
  const GAUGES = [
    { key: 'rpm', label: 'Engine speed', min: 0, max: 8000, kind: 'rpm', zones: [{ from: 6500, to: 8000, status: 'critical' }] },
    { key: 'speed', label: 'Vehicle speed', min: 0, max: 220, kind: 'speed' },
    { key: 'coolant', label: 'Coolant temperature', min: 40, max: 130, kind: 'temp', zones: [{ from: 104, to: 110, status: 'warning' }, { from: 110, to: 130, status: 'critical' }] },
    { key: 'voltage', label: 'System voltage', min: 10, max: 16, kind: 'volt', digits: 1, zones: [{ from: 10, to: 12.8, status: 'warning' }, { from: 15, to: 16, status: 'critical' }] },
  ];
  const CHARTS = [
    { title: 'Engine speed', kind: 'rpm', series: [{ key: 'rpm', label: 'RPM' }], min: 0 },
    { title: 'Vehicle speed', kind: 'speed', series: [{ key: 'speed', label: 'Speed' }], min: 0 },
    { title: 'Coolant & oil temperature', kind: 'temp', series: [{ key: 'coolant', label: 'Coolant' }, { key: 'oilTemp', label: 'Oil', short: 'Oil' }], refs: [104] },
    { title: 'Fuel trims · Bank 1', kind: 'trim', digits: 1, series: [{ key: 'stft1', label: 'Short term', short: 'STFT' }, { key: 'ltft1', label: 'Long term', short: 'LTFT' }], min: -25, max: 25, refs: [0, 10, -10] },
    { title: 'O2 sensors · Bank 1', kind: 'volt', digits: 2, series: [{ key: 'o2b1s1', label: 'Upstream S1', short: 'S1' }, { key: 'o2b1s2', label: 'Downstream S2', short: 'S2' }], min: 0, max: 1.0, refs: [0.45] },
    { title: 'System voltage', kind: 'volt', digits: 2, series: [{ key: 'voltage', label: 'Voltage' }], refs: [13.3, 14.8] },
  ];
  const TILE_KEYS = ['load', 'throttle', 'maf', 'map', 'baro', 'timing', 'iat', 'ambient', 'oilTemp', 'fuelPress', 'fuelRate', 'fuelLevel', 'o2b1s1', 'o2b1s2', 'stft2', 'ltft2'];
  const TRIMS = ['stft1', 'ltft1', 'stft2', 'ltft2'];
  const FREEZE_PIDS = ['0C', '0D', '05', '04', '11', '0B', '10', '0F', '06', '07', '08', '09', '42'];
  const FAST = ['0C', '0D', '05', '04', '11', '06', '07', '14', '15', '10', '0B', '0E', '42'];
  const SLOW = ['08', '09', '0F', '0A', '1F', '21', '2F', '30', '31', '33', '46', '5C', '5E', '03', '2C', '2E', '3C', '43', '44', '45', '49', '4C', '4D', '4E'];
  const ONCE = ['1C', '51'];

  let gauges = [], charts = [];
  const color = (i) => getComputedStyle(document.documentElement).getPropertyValue(`--series-${i + 1}`).trim();

  function buildUi() {
    $('gauges').innerHTML = '';
    gauges = GAUGES.map((g) => ({ g, w: new OBD.Gauge($('gauges'), { ...g, conv: conv(g.kind), unitOf: () => unitOf(g.kind), scaleDigits: 0 }) }));
    $('charts').innerHTML = '';
    charts = CHARTS.map((c) => new OBD.LineChart($('charts'), {
      ...c, series: c.series.map((s, i) => ({ ...s, color: color(i) })), conv: conv(c.kind), unitOf: () => unitOf(c.kind),
    }));
    $('tiles').innerHTML = TILE_KEYS.map((k) => `<div class="tile" id="tile-${k}"><div class="l">${PIDS[KEY_TO_PID[k]].label}</div><div class="v">—</div><div class="s"></div></div>`).join('');
    $('trims').innerHTML = TRIMS.map((k) => `<div class="trim-row" id="trim-${k}"><div class="top"><span>${PIDS[KEY_TO_PID[k]].label}</span><b>—</b></div>
      <div class="trim-bar"><div class="zone"></div><div class="mid"></div><div class="fill"></div></div></div>`).join('') +
      '<div class="trim-scale"><span>−25% rich</span><span>0</span><span>lean +25%</span></div>';
    renderAll();
  }

  // ---------- Rendering ----------
  function renderLive() {
    const now = performance.now();
    gauges.forEach(({ g, w }) => w.set(latest[g.key], statusFor(g.key)));
    charts.forEach((c) => c.render(history, now));
    for (const k of TILE_KEYS) {
      const t = $('tile-' + k), pid = KEY_TO_PID[k], kind = PIDS[pid].kind;
      const supported = !client || client.has(pid);
      t.classList.toggle('na', !supported);
      const v = latest[k];
      t.querySelector('.v').innerHTML = !supported ? 'Not supported' : v == null ? '—' : `${fmt(kind, v, false)}<small>${unitOf(kind)}</small>`;
      const s = statusFor(k);
      t.querySelector('.s').innerHTML = s && s.level !== 'good' ? OBD.statusHtml(s) : '';
    }
    for (const k of TRIMS) {
      const row = $('trim-' + k), v = latest[k];
      row.querySelector('b').textContent = fmt('trim', v);
      const fill = row.querySelector('.fill');
      if (v == null) { fill.style.width = 0; continue; }
      const pct = Math.max(-25, Math.min(25, v)) / 25 * 50;
      fill.style.left = (pct < 0 ? 50 + pct : 50) + '%';
      fill.style.width = Math.abs(pct) + '%';
      fill.style.background = v < 0 ? 'var(--rich)' : 'var(--lean)';
    }
    $('trip').innerHTML = [
      ['Distance since codes cleared', fmt('dist', latest.distClear)], ['Distance with MIL on', fmt('dist', latest.distMil)],
      ['Warm-ups since cleared', fmt('count', latest.warmups)], ['Engine run time', fmt('sec', latest.runtime)],
      ['Fuel level', fmt('pct', latest.fuelLevel)], ['Fuel consumption', fmt('lph', latest.fuelRate)],
    ].map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
    $('runtime').textContent = fmt('sec', latest.runtime);
    updateEvidence();
    renderAlerts();
  }

  function renderDiag() {
    const { dtcs, monitors, freeze } = diag;
    ['stored', 'pending', 'permanent'].forEach((t) => { $('n-' + t).textContent = dtcs[t].length; });
    renderDtcList();

    if (monitors) {
      $('mil').innerHTML = monitors.mil ? OBD.statusHtml(st('critical', `ON · ${monitors.dtcCount} code(s)`)) : OBD.statusHtml(st('good', 'Off'));
      const sup = monitors.monitors.filter((m) => m.supported && !m.continuous);
      const inc = sup.filter((m) => !m.complete).length;
      $('ready-summary').innerHTML = (inc <= 1 ? OBD.statusHtml(st('good', 'Inspection ready')) : OBD.statusHtml(st('warning', 'Not inspection ready'))) +
        ` <span class="muted">· ${sup.length - inc}/${sup.length} non-continuous monitors complete · ${monitors.ignition}</span>`;
      $('monitors').innerHTML = monitors.monitors.map((m) => `<li><span>${m.name}<span class="kind">${m.continuous ? 'continuous' : ''}</span></span>${
        !m.supported ? '<span class="status info"><i>–</i>Not supported</span>' : m.complete ? OBD.statusHtml(st('good', 'Complete')) : OBD.statusHtml(st('warning', 'Incomplete'))}</li>`).join('');
    } else {
      $('mil').textContent = '—'; $('ready-summary').textContent = 'No data'; $('monitors').innerHTML = '';
    }

    $('freeze').innerHTML = freeze
      ? `<p>Captured when <b>${freeze.dtc}</b> was set — ${OBD.describeDtc(freeze.dtc).title}</p><table>${
        Object.entries(freeze.values).map(([pid, v]) => `<tr><td>${PIDS[pid].label}</td><td>${fmt(PIDS[pid].kind, v)}</td></tr>`).join('')}</table>`
      : '<p class="muted">No freeze frame stored.</p>';
    renderAlerts();
  }


  // ---------- Trouble-code cards ----------
  const SEV_LABEL = { critical: 'Critical', serious: 'Fix soon', warning: 'Monitor' };
  const TAB_NOTE = {
    stored: 'Confirmed faults: these turn on the check-engine light.',
    pending: 'Detected once. If the fault is seen again on the next drive cycle it becomes a stored code and turns on the check-engine light. Fixing it now prevents that.',
    permanent: 'Permanent codes cannot be erased with a scan tool. They clear themselves once the ECU re-tests the system and it passes, usually 1–3 drive cycles after the repair.',
  };
  const openCodes = new Set();
  let dtcRenderKey = '';
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function renderDtcList(force) {
    const { dtcs } = diag;
    const list = dtcs[dtcTab];
    const all = [...new Set([...dtcs.stored, ...dtcs.pending, ...dtcs.permanent])];
    const key = [dtcTab, units, connected, list.join(), all.join()].join('|');
    if (!force && key === dtcRenderKey) return updateEvidence();
    dtcRenderKey = key;

    // Where to start: repair order + cross-code insights
    const ordered = OBD.repairOrder(all);
    const insights = OBD.relatedInsights(all);
    $('dtc-insights').hidden = !(insights.length || ordered.length > 1);
    $('dtc-insights').innerHTML = `<h3>Where to start <span class="muted">· suggested repair order</span></h3>` +
      (ordered.length > 1 ? `<ol class="order">${ordered.map((d) => `<li><b>${d.code}</b> ${esc(d.title)} <span class="muted">· ${OBD.DRIVE_ADVICE[d.drive].label}${d.root ? ' · likely root cause' : ''}</span></li>`).join('')}</ol>` : '') +
      insights.map((i) => `<div class="insight ${i.level}"><span class="ic">${ICON[i.level]}</span><p>${i.text}</p></div>`).join('');

    $('dtc-tabnote').textContent = list.length ? TAB_NOTE[dtcTab] : '';
    if (!list.length) { $('dtcs').innerHTML = `<li class="empty">No ${dtcTab} codes${connected ? '' : ' (not connected)'}</li>`; return; }
    if (!openCodes.size) openCodes.add(ordered[0] ? ordered[0].code : list[0]);

    $('dtcs').innerHTML = list.map((c) => {
      const d = OBD.describeDtc(c);
      const drive = OBD.DRIVE_ADVICE[d.drive];
      const where = ['stored', 'pending', 'permanent'].filter((t) => dtcs[t].includes(c)).map((t) => `<span class="chip">${t}</span>`).join('');
      const q = encodeURIComponent(`${c} OBD2 code ${d.manufacturer ? '' : 'meaning fix'}`.trim());
      return `<li class="dtc sev-${d.severity}"><details data-code="${c}"${openCodes.has(c) ? ' open' : ''}>
        <summary><span class="code">${c}</span><div class="sum-main"><div class="desc">${esc(d.title)}</div><div class="sys">${esc(d.system)}${d.manufacturer ? ' · manufacturer specific' : ''} ${where}</div></div>
          ${OBD.statusHtml(st(d.severity, SEV_LABEL[d.severity]))}</summary>
        <div class="dtc-body">
          <div class="drive ${drive.level}">${OBD.statusHtml(st(drive.level, drive.label))}<span>${drive.text}</span></div>
          ${d.note ? `<p class="dtc-note">${esc(d.note)}</p>` : ''}
          <p class="meaning">${esc(d.meaning)}</p>
          ${d.live ? `<div class="evidence" data-live="${d.live}" data-bank="${d.bank || 1}" data-code="${c}"></div>` : ''}
          <div class="dtc-cols">
            ${d.causes.length ? `<div><h4>Likely causes <span class="muted">most common first</span></h4><ol class="causes">${d.causes.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>` : ''}
            <div><h4>Recommended steps</h4><ol class="steps">${d.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>
          </div>
          ${d.symptoms.length ? `<p class="symptoms"><b>Typical symptoms:</b> ${d.symptoms.map(esc).join(' · ')}</p>` : ''}
          <div class="dtc-foot"><span>DIY difficulty: <b>${esc(d.diy)}</b></span>
            <a href="https://www.google.com/search?q=${q}" target="_blank" rel="noopener">Search this code online ↗</a></div>
        </div></details></li>`;
    }).join('');
    $('dtcs').querySelectorAll('details').forEach((el) => el.addEventListener('toggle', () => {
      el.open ? openCodes.add(el.dataset.code) : openCodes.delete(el.dataset.code);
      if (el.open) updateEvidence();
    }));
    updateEvidence();
  }

  function stats(key, ms = 10000) {
    const now = performance.now(), pts = (history[key] || []).filter((p) => p.t > now - ms);
    if (pts.length < 6) return null;
    const vs = pts.map((p) => p.v), mean = vs.reduce((a, b) => a + b, 0) / vs.length;
    let crossings = 0;
    for (let i = 1; i < vs.length; i++) if ((vs[i - 1] - 0.45) * (vs[i] - 0.45) < 0) crossings++;
    return { min: Math.min(...vs), max: Math.max(...vs), range: Math.max(...vs) - Math.min(...vs), mean, sd: Math.sqrt(vs.reduce((a, v) => a + (v - mean) ** 2, 0) / vs.length), crossings };
  }

  /** Live-data checks that help confirm or rule out a code. Returns {level, html} or null. */
  const EVIDENCE = {
    trims(code, bank) {
      const s = latest['stft' + bank], l = latest['ltft' + bank];
      if (s == null || l == null) return null;
      const total = s + l, isLean = /P017[14]/.test(code);
      const now = `Bank ${bank} now: short ${fmt('trim', s)}, long ${fmt('trim', l)}, <b>total ${fmt('trim', total)}</b> at ${fmt('rpm', latest.rpm)}.`;
      if ((latest.coolant || 0) < 70) return { level: 'info', html: `${now} The engine is still warming up, so trims are not reliable yet. Re-check when the coolant is above ${fmt('temp', 80)}.` };
      if (isLean ? total >= 10 : total <= -10) return { level: 'serious', html: `${now} <b>Confirms the fault:</b> the ECU is ${isLean ? 'adding' : 'removing'} ${Math.abs(total).toFixed(0)}% fuel. ${isLean ? 'Now hold 2,500 rpm: if the total drops towards 0%, suspect a vacuum leak; if it stays high or rises, suspect fuel delivery or the MAF.' : ''}` };
      if (isLean ? total <= -10 : total >= 10) return { level: 'warning', html: `${now} The trims currently show the <b>opposite</b> condition. Check for a recent repair, or for a faulty O2 sensor.` };
      return { level: 'good', html: `${now} <b>Currently within normal range (±10%).</b> The fault may be intermittent or only under load. Re-check at idle and at 2,500 rpm, and after a cold start.` };
    },
    misfire() {
      const r = stats('rpm');
      if (!r) return null;
      const idle = (latest.speed || 0) < 1 && r.mean < 1300;
      const trims = (latest.stft1 ?? 0) + (latest.ltft1 ?? 0);
      const lean = trims >= 10 ? ` Fuel trims are lean (${fmt('trim', trims)}). A lean mixture can cause misfires: fix that first.` : '';
      if (!idle) return { level: 'info', html: `Let the engine idle in Park/Neutral to judge idle smoothness (now ${fmt('rpm', r.mean)}, ${fmt('speed', latest.speed)}).${lean}` };
      return r.sd > 35
        ? { level: 'serious', html: `<b>Idle is unstable:</b> RPM varies ±${r.sd.toFixed(0)} rpm (${r.min.toFixed(0)}–${r.max.toFixed(0)}), consistent with a misfire.${lean}` }
        : { level: 'good', html: `Idle is steady right now (±${r.sd.toFixed(0)} rpm). The misfire may only occur under load or when cold.${lean}` };
    },
    cat() {
      const a = stats('o2b1s1'), b = stats('o2b1s2');
      if (!a || !b) return null;
      if ((latest.coolant || 0) < 70) return { level: 'info', html: 'Warm the engine fully to judge the catalyst from the O2 sensors.' };
      const ratio = b.range / Math.max(a.range, 0.01);
      return ratio > 0.6
        ? { level: 'serious', html: `<b>Downstream O2 mirrors upstream</b> (swing ${b.range.toFixed(2)} V vs ${a.range.toFixed(2)} V). Confirms the catalyst is not storing oxygen.` }
        : { level: 'good', html: `Downstream O2 is steady (swing ${b.range.toFixed(2)} V, average ${b.mean.toFixed(2)} V) while upstream switches (${a.range.toFixed(2)} V). The catalyst looks healthy right now, so check for an exhaust leak or an intermittent fault.` };
    },
    o2() {
      const a = stats('o2b1s1');
      if (!a) return null;
      if ((latest.coolant || 0) < 70) return { level: 'info', html: 'The engine is not warm yet; the O2 sensor is not in closed-loop control.' };
      return a.range < 0.4 || a.crossings < 4
        ? { level: 'serious', html: `<b>Upstream O2 is lazy:</b> swing ${a.range.toFixed(2)} V and ${a.crossings} switches in 10 s (expect 0.1–0.9 V and several switches).` }
        : { level: 'good', html: `Upstream O2 is switching normally right now (${a.min.toFixed(2)}–${a.max.toFixed(2)} V, ${a.crossings} switches in 10 s).` };
    },
    coolant() {
      if (latest.coolant == null) return null;
      const c = latest.coolant, oil = latest.oilTemp != null ? `, oil ${fmt('temp', latest.oilTemp)}` : '';
      if (c <= -35) return { level: 'serious', html: `Coolant reads ${fmt('temp', c)}: <b>that is an open circuit</b> (sensor unplugged or broken wire).` };
      if (c >= 125) return { level: 'critical', html: `Coolant reads ${fmt('temp', c)}${oil}. That is either genuine severe overheating or a shorted sensor. Feel the upper radiator hose carefully to tell which.` };
      if (c >= 108) return { level: 'critical', html: `Coolant ${fmt('temp', c)}${oil}: <b>the engine is overheating now.</b> Switch off and let it cool.` };
      return { level: 'good', html: `Coolant ${fmt('temp', c)}${oil}: currently within normal range.` };
    },
    warmup() {
      if (latest.coolant == null) return null;
      const mins = (latest.runtime || 0) / 60;
      if (mins < 10) return { level: 'info', html: `Coolant ${fmt('temp', latest.coolant)} after ${mins.toFixed(0)} min of running. Watch it for 10–15 minutes of driving: it should reach ${fmt('temp', 85)}–${fmt('temp', 95)}.` };
      return latest.coolant < 75
        ? { level: 'serious', html: `Only ${fmt('temp', latest.coolant)} after ${mins.toFixed(0)} min. <b>Confirms the thermostat is stuck open</b> (or the sensor is faulty).` }
        : { level: 'good', html: `Coolant reached ${fmt('temp', latest.coolant)}. The warm-up looks normal now; the fault may only show in cold weather or at highway speed.` };
    },
    voltage() {
      if (latest.voltage == null) return null;
      const v = latest.voltage, run = running();
      const verdict = run
        ? (v < 13.3 ? { level: 'serious', t: '<b>Not charging properly</b> (expect 13.5–14.7 V with the engine running).' }
          : v > 14.9 ? { level: 'serious', t: '<b>Overcharging.</b> Confirm with a multimeter at the battery; adapters can read a few tenths high.' }
          : { level: 'good', t: 'Charging voltage is normal right now.' })
        : (v < 12.4 ? { level: 'warning', t: 'Battery is partly discharged (a healthy battery rests at about 12.6 V).' } : { level: 'good', t: 'Battery voltage is fine. Start the engine to check charging.' });
      return { level: verdict.level, html: `System voltage ${fmt('volt', v)} with the engine ${run ? 'running' : 'off'}. ${verdict.t}` };
    },
    maf() {
      if (latest.maf == null) return null;
      const idle = (latest.speed || 0) < 1 && (latest.rpm || 0) < 1100;
      return { level: 'info', html: `MAF ${fmt('flow', latest.maf)} at ${fmt('rpm', latest.rpm)}. ${idle ? 'At warm idle, expect roughly 1–1.5 g/s per litre of engine size (e.g. 2.0 L ≈ 2–3 g/s). Much lower suggests a dirty sensor or an air leak after it.' : 'Check at warm idle for the most reliable comparison.'}` };
    },
    dpf() {
      const fuelType = OBD.enumText('51', latest.fuelType);
      const t = latest.catTemp != null ? ` Exhaust/catalyst temperature ${fmt('temp', latest.catTemp)}.` : '';
      return { level: 'info', html: `${fuelType ? 'Fuel type: ' + fuelType + '.' : ''}${t} Soot load is manufacturer data; use <b>Service functions → DPF regeneration</b> to check it and start a forced regeneration where supported.` };
    },
    evap() {
      return { level: 'info', html: 'EVAP faults cannot be seen in live data. Check the fuel cap first, then smoke-test the system.' };
    },
  };

  function updateEvidence() {
    document.querySelectorAll('#dtcs details[open] .evidence').forEach((el) => {
      const fn = EVIDENCE[el.dataset.live];
      const r = fn && (connected || Object.keys(latest).length) ? fn(el.dataset.code, +el.dataset.bank) : null;
      el.className = 'evidence ' + (r ? r.level : 'info');
      el.innerHTML = `<h4>Live data check</h4><p>${r ? r.html : 'Connect to the vehicle with the engine running to check this against live data.'}</p>`;
    });
  }

  function rangeOver(key, ms) {
    const now = performance.now(), pts = (history[key] || []).filter((p) => p.t > now - ms);
    if (pts.length < 8) return null;
    const vs = pts.map((p) => p.v);
    return Math.max(...vs) - Math.min(...vs);
  }

  function computeAlerts() {
    if (!connected && !Object.keys(latest).length) return [{ level: 'info', title: 'Waiting for data', text: 'Connect to the simulator or a Bluetooth adapter.' }];
    const out = [];
    if (connected && client && !client.ecuOk) out.push({ level: 'critical', title: 'Vehicle ECU is not responding', text: `The adapter answered "${client.lastError}". All protocols were tried; the app keeps retrying every few seconds. Check the ignition is ON (or start the engine) and the adapter is fully seated in the OBD2 port.` });
    if (connected && client && client.ecuOk && performance.now() - connectedAt > 6000 && latest.rpm == null && latest.coolant == null)
      out.push({ level: 'critical', title: 'No live data received', text: 'The adapter is connected but sensor requests return no data. Open the Adapter log below, tap Copy log and share it.' });
    const m = diag.monitors;
    if (m && m.mil) out.push({ level: 'critical', title: 'Check engine light is ON', text: `${diag.dtcs.stored.join(', ') || m.dtcCount + ' stored code(s)'} — see trouble codes below.` });
    if (diag.dtcs.pending.length) out.push({ level: 'warning', title: 'Pending trouble codes', text: `${diag.dtcs.pending.join(', ')} detected once; will set the MIL if seen again.` });
    const labels = { rpm: 'Engine speed', coolant: 'Coolant temperature', voltage: 'System voltage', oilTemp: 'Oil temperature', iat: 'Intake air temperature', fuelLevel: 'Fuel level', map: 'Manifold pressure' };
    const tips = {
      coolant: 'Check coolant level, radiator fan, thermostat and water pump.',
      voltage: running() ? 'Test alternator output, drive belt, battery terminals and grounds.' : 'Charge/test the battery.',
      map: 'High MAP at idle suggests a vacuum leak, misfire or late cam timing.',
    };
    for (const k of Object.keys(RULES)) {
      const s = statusFor(k);
      if (s && (s.level === 'warning' || s.level === 'serious' || s.level === 'critical'))
        out.push({ level: s.level, title: `${labels[k]}: ${s.text.toLowerCase()}`, text: `${fmt(PIDS[KEY_TO_PID[k]].kind, latest[k])}. ${tips[k] || ''}` });
    }
    for (const b of [1, 2]) {
      const s = latest['stft' + b], l = latest['ltft' + b];
      if (s == null || l == null) continue;
      const total = s + l;
      if (Math.abs(total) >= 10) out.push({
        level: Math.abs(total) >= 20 ? 'serious' : 'warning',
        title: `Bank ${b} running ${total > 0 ? 'lean' : 'rich'} (${fmt('trim', total)} total trim)`,
        text: total > 0 ? 'ECU is adding fuel: check for vacuum/intake leaks, MAF contamination, low fuel pressure.' : 'ECU is removing fuel: check for leaking injectors, high fuel pressure, purge valve, MAF.',
      });
    }
    if ((latest.coolant || 0) > 70 && running()) {
      const r1 = rangeOver('o2b1s1', 10000), r2 = rangeOver('o2b1s2', 10000);
      if (r1 != null && r1 < 0.3) out.push({ level: 'warning', title: 'Upstream O2 sensor not switching', text: `Only ${r1.toFixed(2)} V swing in 10 s. Sensor may be lazy or the engine is in open loop.` });
      if (r1 != null && r2 != null && r1 > 0.4 && r2 > r1 * 0.6) out.push({ level: 'serious', title: 'Downstream O2 mirrors upstream', text: 'The catalytic converter is no longer storing oxygen — likely worn catalyst (P0420/P0430).' });
    }
    if (m) {
      const inc = m.monitors.filter((x) => x.supported && !x.continuous && !x.complete);
      if (inc.length > 1) out.push({ level: 'warning', title: `${inc.length} readiness monitors incomplete`, text: `${inc.map((x) => x.name).join(', ')}. Complete a drive cycle before an emissions test.` });
    }
    if (!out.length) out.push({ level: 'good', title: 'No issues detected', text: 'All monitored parameters are within normal range.' });
    const order = { critical: 0, serious: 1, warning: 2, info: 3, good: 4 };
    return out.sort((a, b) => order[a.level] - order[b.level]);
  }

  function renderAlerts() {
    const list = computeAlerts();
    $('alerts').innerHTML = list.map((a) => `<li class="alert ${a.level}"><span class="ic">${ICON[a.level]}</span><div><b>${a.title}</b><p>${a.text}</p></div></li>`).join('');
    const issues = list.filter((a) => a.level !== 'good' && a.level !== 'info').length;
    $('alerts-count').textContent = issues ? `${issues} issue${issues > 1 ? 's' : ''}` : '';
  }

  function renderAll() { renderLive(); renderDiag(); }

  // ---------- Shared context for the feature modules (live data, system scan, services, smog, report) ----------
  const listeners = {};
  OBD.on = (ev, fn) => (listeners[ev] = listeners[ev] || []).push(fn);
  const emit = (ev, arg) => (listeners[ev] || []).forEach((fn) => { try { fn(arg); } catch (e) { console.error(e); } });
  // While a feature has exclusive use of the adapter (it changes CAN headers), the poll loop waits at the gate.
  let gate = null;
  const waitGate = async () => { while (gate) await gate; };
  async function exclusive(label, fn) {
    if (!client || !connected) throw new Error('Not connected');
    if (gate) throw new Error('Busy: ' + gate.label);
    let open;
    gate = new Promise((r) => (open = r)); gate.label = label; emit('gate', label);
    try { await client.queue; return await fn(client); }
    finally { const g = gate; gate = null; open(); if (g) emit('gate', null); }
  }
  const extraFast = new Set(); // PIDs the live-data view wants refreshed every cycle
  OBD.ctx = {
    get client() { return client; }, get connected() { return connected; }, get latest() { return latest; }, get history() { return history; },
    get diag() { return diag; }, get units() { return units; }, get busy() { return gate && gate.label; }, get transport() { return transport; },
    get vin() { return vehicle.vin; }, get vehicle() { return vehicle; }, get csvRows() { return csvRows; },
    fmt, unitOf, conv, statusFor, toast, exclusive, emit, extraFast, running, color, esc: (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])),
    statusHtml: (level, text) => OBD.statusHtml(st(level, text)), refreshDiagnostics: () => refreshDiagnostics(), exportCsv: () => exportCsv(),
  };
  let vehicle = {}, connState = 'idle';
  OBD.emitLang = () => { $('connect').textContent = OBD.t(connState === 'idle' ? 'Connect' : connState === 'connecting' ? 'Connecting…' : 'Disconnect'); emit('lang'); };

  // ---------- Data acquisition ----------
  function record(key, v) {
    if (v == null || isNaN(v)) return;
    latest[key] = v;
    const h = history[key] || (history[key] = []);
    const now = performance.now();
    h.push({ t: now, v });
    while (h.length && h[0].t < now - HISTORY_MS) h.shift();
  }

  async function refreshDiagnostics() {
    await waitGate();
    const [monitors, dtcs] = [await client.readMonitorStatus(), await client.readDtcs()];
    let freeze = null;
    if (dtcs.stored.length) {
      const dtc = await client.readFreezeDtc();
      if (dtc) {
        const values = {};
        for (const pid of FREEZE_PIDS) { if (!client.has(pid)) continue; const v = await client.readFreeze(pid); if (v != null) values[pid] = v; }
        freeze = { dtc, values };
      }
    }
    diag = { monitors, dtcs, freeze };
    renderDiag();
    emit('diag', diag);
  }

  async function pollLoop(token) {
    let cycle = 0;
    while (connected && token === loopToken) {
      const started = performance.now();
      try {
        const fast = [...new Set([...FAST, ...extraFast])];
        for (const pid of fast) if (client.has(pid)) { await waitGate(); if (token !== loopToken) return; record(PIDS[pid].key, await client.readPid(pid)); }
        if (cycle % 5 === 0) {
          for (const pid of SLOW) if (client.has(pid) && !extraFast.has(pid)) { await waitGate(); if (token !== loopToken) return; record(PIDS[pid].key, await client.readPid(pid)); }
          await waitGate();
          if (!client.has('42')) record('voltage', await client.readBatteryVoltage());
        }
        await waitGate();
        if (!client.ecuOk && cycle % 8 === 4 && await client.retryEcu()) {
          $('protocol').textContent = client.protocol; $('pidcount').textContent = client.supported.size;
          localStorage.setItem('obd-proto-' + (transport.name || 'ble'), client.protocolNum);
          toast('Vehicle ECU is now responding');
        }
        if (cycle % 20 === 10) await refreshDiagnostics();
        csvRows.push({ time: new Date().toISOString(), ...latest });
        if (csvRows.length > 20000) csvRows.shift();
        renderLive();
        emit('live');
      } catch (e) {
        if (!connected || token !== loopToken) return;
        console.error(e); toast('Read error: ' + e.message);
      }
      cycle++;
      await new Promise((r) => setTimeout(r, Math.max(30, 250 - (performance.now() - started))));
    }
  }

  function setConn(state, sub) {
    const p = $('conn-sub');
    p.className = state === 'live' ? 'live' : '';
    p.innerHTML = `<span class="dot"></span>${sub}`;
    connState = state;
    $('connect').textContent = OBD.t(state === 'idle' ? 'Connect' : state === 'connecting' ? 'Connecting…' : 'Disconnect');
    $('connect').disabled = state === 'connecting';
    $('source').disabled = state !== 'idle';
  }

  async function connect() {
    const src = $('source').value;
    transport = src === 'sim' ? new OBD.SimulatedElmTransport($('scenario').value) : new OBD.BleElmTransport();
    transport.onDisconnect = () => { if (connected) { disconnect(); toast('Adapter disconnected'); } };
    setConn('connecting', src === 'sim' ? 'Starting simulator…' : 'Pairing with adapter…');
    try {
      await transport.connect();
      logLines.length = 0;
      client = new OBD.ElmClient(transport, log);
      const protoKey = 'obd-proto-' + (transport.name || src);
      const info = await client.init({
        savedProto: src === 'ble' ? localStorage.getItem(protoKey) : null,
        onProgress: (t) => { setConn('connecting', t); log('info', t); },
      });
      if (client.ecuOk && client.protocolNum && client.protocolNum !== '0') localStorage.setItem(protoKey, client.protocolNum);
      $('adapter').textContent = `${info.adapter}${src === 'ble' ? ' · ' + transport.name : ''}`;
      $('protocol').textContent = info.protocol;
      $('pidcount').textContent = client.supported.size;
      const vin = await client.readVin();
      vehicle = { vin, info: OBD.decodeVinInfo(vin), source: src };
      $('vin').textContent = vin || 'Not reported';
      $('vin').title = vehicle.info && vehicle.info.make ? `${vehicle.info.make}${vehicle.info.year ? ' · ' + vehicle.info.year : ''}` : '';
      latest = {}; history = {}; csvRows = [];
      for (const pid of ONCE) if (client.has(pid)) record(PIDS[pid].key, await client.readPid(pid));
      vehicle.ecuInfo = client.ecuOk ? await client.readVehicleInfo() : null;
      $('make').textContent = vehicle.info && !vehicle.info.invalid ? [vehicle.info.make || 'Unknown make (' + vehicle.info.region + ')', vehicle.info.year].filter(Boolean).join(' · ') : '—';
      connected = true; connectedAt = performance.now();
      if (transport.info) log('rx', 'BLE ' + transport.info);
      if (!client.ecuOk) toast('Vehicle ECU did not respond - is the ignition on?');
      $('pidcount').textContent = client.supportedGuessed ? 'ECU not responding' : client.supported.size;
      log('info', client.ecuOk ? `Connected: ${client.protocol}, ${client.supported.size} PIDs` : `ECU silent (${client.lastError}) - will keep retrying`);
      setConn('live', `Live · ${src === 'sim' ? 'Simulator' : transport.name}`);
      await refreshDiagnostics();
      pollLoop(++loopToken);
      emit('connected', vehicle);
    } catch (e) {
      console.error(e);
      toast(e.message || String(e));
      try { await transport.disconnect(); } catch {}
      transport = client = null;
      setConn('idle', 'Not connected');
    }
  }

  async function disconnect() {
    connected = false; loopToken++;
    try { if (client) await client.disconnect(); } catch {}
    transport = null;
    setConn('idle', 'Disconnected');
    renderAll();
    emit('disconnected');
  }

  // ---------- Log / toast / export ----------
  const logLines = [];
  function log(dir, text) {
    logLines.push(`${new Date().toLocaleTimeString()} ${dir === 'tx' ? '→' : dir === 'rx' ? '←' : '•'} ${text}`);
    if (logLines.length > 400) logLines.splice(60, logLines.length - 400); // keep the first 60 lines (connection handshake)
    const el = $('log');
    if (el.closest('details').open) { el.textContent = logLines.join('\n'); el.scrollTop = el.scrollHeight; }
  }
  let toastTimer;
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4000); }

  function exportCsv() {
    if (!csvRows.length) return toast('No data recorded yet');
    const keys = ['time', ...Object.values(PIDS).map((d) => d.key).filter((k) => csvRows.some((r) => r[k] != null))];
    const head = keys.map((k) => (k === 'time' ? 'time' : `${PIDS[KEY_TO_PID[k]].label} (${PIDS[KEY_TO_PID[k]].kind === 'sec' ? 's' : unitOf(PIDS[KEY_TO_PID[k]].kind) || '-'})`));
    const lines = [head.join(','), ...csvRows.map((r) => keys.map((k) => k === 'time' ? r.time : r[k] == null ? '' : conv(PIDS[KEY_TO_PID[k]].kind)(r[k]).toFixed(3)).join(','))];
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    a.download = `obd-log-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
  }

  // ---------- Wire up ----------
  function init() {
    const theme = localStorage.getItem('obd-theme') || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    document.documentElement.dataset.theme = theme;
    for (const [id, sc] of Object.entries(OBD.SimulatedElmTransport.scenarios)) $('scenario').add(new Option(sc.label, id));
    $('scenario').value = 'city';
    document.querySelectorAll('[data-units]').forEach((b) => b.classList.toggle('on', b.dataset.units === units));
    buildUi();

    $('connect').onclick = () => (transport ? disconnect() : connect());
    $('source').value = localStorage.getItem('obd-source') || 'sim';
    $('scenario-field').hidden = $('source').value !== 'sim';
    $('source').onchange = () => {
      localStorage.setItem('obd-source', $('source').value);
      $('scenario-field').hidden = $('source').value !== 'sim';
      if ($('source').value === 'ble' && !OBD.BleElmTransport.supported())
        toast('Web Bluetooth needs Chrome/Edge (Android, desktop) over https:// or localhost. iOS Safari does not support it.');
    };
    $('scenario').onchange = () => { if (transport && transport.setScenario) { transport.setScenario($('scenario').value); toast('Scenario: ' + $('scenario').selectedOptions[0].text); } };
    document.querySelectorAll('[data-units]').forEach((b) => b.onclick = () => {
      units = b.dataset.units; localStorage.setItem('obd-units', units);
      document.querySelectorAll('[data-units]').forEach((x) => x.classList.toggle('on', x === b));
      buildUi();
      emit('units');
    });
    $('theme').onclick = () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t; localStorage.setItem('obd-theme', t);
      buildUi();
      emit('units');
    };
    $('dtc-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      dtcTab = b.dataset.tab;
      document.querySelectorAll('#dtc-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      renderDtcList(true);
    };
    $('scan').onclick = () => (client && connected ? refreshDiagnostics().then(() => toast('Codes re-scanned')) : toast('Not connected'));
    $('clear').onclick = () => (!client || !connected ? toast('Not connected') : gate ? toast('Busy: ' + gate.label) : $('clear-dialog').showModal());
    $('clear-dialog').addEventListener('close', async () => {
      if ($('clear-dialog').returnValue !== 'ok') return;
      await waitGate();
      const ok = await client.clearDtcs();
      toast(ok ? 'Codes cleared, monitors reset' : 'ECU did not confirm the clear');
      await refreshDiagnostics();
    });
    $('export').onclick = exportCsv;
    $('copy-log').onclick = async (e) => {
      e.preventDefault();
      const text = logLines.join('\n') || '(log is empty)';
      try { await navigator.clipboard.writeText(text); toast('Log copied - paste it into the chat'); }
      catch { $('log').textContent = text; getSelection().selectAllChildren($('log')); toast('Select-all done - copy with Ctrl/Cmd+C'); }
    };
    $('log').closest('details').addEventListener('toggle', () => { $('log').textContent = logLines.join('\n'); });
    let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { renderLive(); emit('resize'); }, 100); });
    const showView = (v) => {
      document.querySelectorAll('[data-view-panel]').forEach((p) => { p.hidden = p.dataset.viewPanel !== v; });
      document.querySelectorAll('#views [data-view]').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === v));
      localStorage.setItem('obd-view', v);
      requestAnimationFrame(() => { renderLive(); emit('view', v); });
    };
    $('views').onclick = (e) => { const b = e.target.closest('[data-view]'); if (b) showView(b.dataset.view); };
    showView(localStorage.getItem('obd-view') || 'dash');
    emit('init');

    if ($('source').value === 'sim') connect(); // demo data straight away; Bluetooth needs a tap (browser rule)
    else toast('Tap Connect to pair with your Bluetooth adapter');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.OBD = window.OBD || {});
