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
    flow: ['g/s'], pct: ['%'], trim: ['%'], rpm: ['rpm'], volt: ['V'], deg: ['° BTDC'], count: [''], sec: [''],
  };
  const unitOf = (kind) => { const u = UNIT[kind]; return Array.isArray(u) ? u[0] : u[units][0]; };
  const conv = (kind) => (v) => { const u = UNIT[kind]; return Array.isArray(u) ? v : u[units][1](v); };
  const DIGITS = { volt: 2, trim: 1, flow: 1, lph: 1, deg: 1, pressure: 0 };
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
  const SLOW = ['08', '09', '0F', '0A', '1F', '21', '2F', '30', '31', '33', '46', '5C', '5E'];

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
    renderAlerts();
  }

  function renderDiag() {
    const { dtcs, monitors, freeze } = diag;
    ['stored', 'pending', 'permanent'].forEach((t) => { $('n-' + t).textContent = dtcs[t].length; });
    const list = dtcs[dtcTab];
    $('dtcs').innerHTML = list.length ? list.map((c) => {
      const d = OBD.describeDtc(c);
      const label = { critical: 'Critical', serious: 'Fix soon', warning: 'Monitor' }[d.severity];
      return `<li class="dtc"><span class="code">${d.code}</span><div><div class="desc">${d.description}</div><div class="sys">${d.system}${d.manufacturer ? ' · manufacturer specific' : ''}</div></div>
        ${OBD.statusHtml(st(d.severity, label))}<div class="hint">${d.hint}</div></li>`;
    }).join('') : `<li class="empty">No ${dtcTab} codes${connected ? '' : ' (not connected)'}</li>`;

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
      ? `<p>Captured when <b>${freeze.dtc}</b> was set — ${OBD.describeDtc(freeze.dtc).description}</p><table>${
        Object.entries(freeze.values).map(([pid, v]) => `<tr><td>${PIDS[pid].label}</td><td>${fmt(PIDS[pid].kind, v)}</td></tr>`).join('')}</table>`
      : '<p class="muted">No freeze frame stored.</p>';
    renderAlerts();
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
  }

  async function pollLoop(token) {
    let cycle = 0;
    while (connected && token === loopToken) {
      const started = performance.now();
      try {
        for (const pid of FAST) if (client.has(pid)) record(PIDS[pid].key, await client.readPid(pid));
        if (cycle % 5 === 0) {
          for (const pid of SLOW) if (client.has(pid)) record(PIDS[pid].key, await client.readPid(pid));
          if (!client.has('42')) record('voltage', await client.readBatteryVoltage());
        }
        if (!client.ecuOk && cycle % 8 === 4 && await client.retryEcu()) {
          $('protocol').textContent = client.protocol; $('pidcount').textContent = client.supported.size;
          localStorage.setItem('obd-proto-' + (transport.name || 'ble'), client.protocolNum);
          toast('Vehicle ECU is now responding');
        }
        if (cycle % 20 === 10) await refreshDiagnostics();
        csvRows.push({ time: new Date().toISOString(), ...latest });
        if (csvRows.length > 20000) csvRows.shift();
        renderLive();
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
    $('connect').textContent = state === 'idle' ? 'Connect' : state === 'connecting' ? 'Connecting…' : 'Disconnect';
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
      $('vin').textContent = (await client.readVin()) || 'Not reported';
      latest = {}; history = {}; csvRows = [];
      connected = true; connectedAt = performance.now();
      if (transport.info) log('rx', 'BLE ' + transport.info);
      if (!client.ecuOk) toast('Vehicle ECU did not respond - is the ignition on?');
      $('pidcount').textContent = client.supportedGuessed ? 'ECU not responding' : client.supported.size;
      log('info', client.ecuOk ? `Connected: ${client.protocol}, ${client.supported.size} PIDs` : `ECU silent (${client.lastError}) - will keep retrying`);
      setConn('live', `Live · ${src === 'sim' ? 'Simulator' : transport.name}`);
      await refreshDiagnostics();
      pollLoop(++loopToken);
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
    });
    $('theme').onclick = () => {
      const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = t; localStorage.setItem('obd-theme', t);
      buildUi();
    };
    $('dtc-tabs').onclick = (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      dtcTab = b.dataset.tab;
      document.querySelectorAll('#dtc-tabs [data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      renderDiag();
    };
    $('scan').onclick = () => (client && connected ? refreshDiagnostics().then(() => toast('Codes re-scanned')) : toast('Not connected'));
    $('clear').onclick = () => (client && connected ? $('clear-dialog').showModal() : toast('Not connected'));
    $('clear-dialog').addEventListener('close', async () => {
      if ($('clear-dialog').returnValue !== 'ok') return;
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
    let rT; addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(renderLive, 100); });

    if ($('source').value === 'sim') connect(); // demo data straight away; Bluetooth needs a tap (browser rule)
    else toast('Tap Connect to pair with your Bluetooth adapter');
  }

  document.addEventListener('DOMContentLoaded', init);
})(window.OBD = window.OBD || {});
