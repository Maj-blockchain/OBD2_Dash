/* Simulated car + ELM327 adapter. Answers AT and OBD commands with the same raw hex strings
   a real dongle would send, so the whole parsing pipeline is exercised during development. */
(function (OBD) {
  'use strict';

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const hex = (n) => clamp(Math.round(n), 0, 255).toString(16).toUpperCase().padStart(2, '0');
  const b1 = (v) => [v];
  const b2 = (v) => { v = clamp(Math.round(v), 0, 65535); return [v >> 8, v & 255]; };
  const trim = (t) => [t * 128 / 100 + 128];
  const noise = (a) => (Math.random() - 0.5) * 2 * a;

  const SCENARIOS = {
    koeo:     { label: 'Ignition on, engine off (for resets)', drive: 'off', faults: [] },
    idle:     { label: 'Healthy - idling', drive: 'idle', faults: [] },
    city:     { label: 'Healthy - city driving', drive: 'city', faults: [] },
    highway:  { label: 'Healthy - highway cruise', drive: 'highway', faults: [] },
    lean:     { label: 'Fault - vacuum leak (lean)', drive: 'idle', faults: [{ code: 'P0171', at: 4 }, { code: 'P0174', at: 9 }] },
    misfire:  { label: 'Fault - cylinder 2 misfire', drive: 'city', faults: [{ code: 'P0302', at: 3 }, { code: 'P0300', at: 10 }] },
    overheat: { label: 'Fault - cooling fan failure', drive: 'city', faults: [{ code: 'P0217', when: (s) => s.coolant > 112 }] },
    catalyst: { label: 'Fault - worn catalytic converter', drive: 'highway', faults: [{ code: 'P0420', at: 6 }] },
    charging: { label: 'Fault - alternator not charging', drive: 'city', faults: [{ code: 'P0562', when: (s) => s.voltage < 12.4 }] },
    chassis:  { label: 'Fault - ABS sensor + airbag (full system)', drive: 'city', faults: [],
      modules: { '760': [{ code: 'C0035', ftb: '1C', status: 0x2F }], '772': [{ code: 'B0001', ftb: '1A', status: 0xAF }], '710': [{ code: 'U0140', ftb: '00', status: 0x28 }] } },
    dpf:      { label: 'Diesel - DPF soot loading', drive: 'idle', diesel: true, faults: [{ code: 'P2463', at: 5 }] },
  };

  // Modules reachable by physical CAN address (request id; reply = id + 8). Addresses are the simulator's own.
  const MODULES = {
    '7E0': { name: 'ENGINE CONTROL MODULE', part: 'SIM-ECM-0001', sw: 'E1.04' },
    '7E1': { name: 'TRANSMISSION CONTROL', part: 'SIM-TCM-0002', sw: 'T2.11' },
    '710': { name: 'GATEWAY', part: 'SIM-GW-0003', sw: 'G0.90' },
    '760': { name: 'ABS / ESP', part: 'SIM-ABS-0004', sw: 'A3.02' },
    '772': { name: 'AIRBAG SRS', part: 'SIM-SRS-0005', sw: 'S1.20' },
    '742': { name: 'STEERING ANGLE SENSOR', part: 'SIM-SAS-0006', sw: 'W1.00' },
    '754': { name: 'TPMS', part: 'SIM-TPMS-0007', sw: 'P1.03' },
    '752': { name: 'ELECTRIC PARKING BRAKE', part: 'SIM-EPB-0008', sw: 'B2.40' },
    '746': { name: 'CLIMATE CONTROL A/C', part: 'SIM-HVAC-0009', sw: 'C1.50' },
    '773': { name: 'RADIO / INFOTAINMENT', part: 'SIM-RAD-0010', sw: 'R5.01' },
    '7A2': { name: 'BATTERY MANAGEMENT', part: 'SIM-BMS-0011', sw: 'M1.12' },
    '7B4': { name: 'INSTRUMENT CLUSTER', part: 'SIM-IC-0012', sw: 'I4.07' },
  };

  /** Reset / relearn routines the simulated car accepts (fictional routine ids, simulator only). */
  const SIM_ROUTINES = {
    oil:      { tx: '7B4', rid: 'F001', secs: 2 },
    throttle: { tx: '7E0', rid: 'F002', secs: 9 },
    epb:      { tx: '752', rid: 'F003', secs: 4 },
    bms:      { tx: '7A2', rid: 'F004', secs: 2 },
    tpms:     { tx: '754', rid: 'F005', secs: 3 },
    dpf:      { tx: '7E0', rid: 'F006', secs: 45 },
  };

  const NONCONT = ['Catalyst', 'Evaporative system', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR / VVT system'];
  const NONCONT_BIT = { 'Catalyst': 0, 'Evaporative system': 2, 'Oxygen sensor': 5, 'Oxygen sensor heater': 6, 'EGR / VVT system': 7 };
  const VIN = '1D3M5CAR0RU123456'; // fictional demo VIN (valid check digit)

  class SimulatedElmTransport {
    constructor(scenario = 'city') {
      this.name = 'Simulator (ELM327 v1.5)';
      this.s = {
        rpm: 0, speed: 0, coolant: 38, oilTemp: 34, ambient: 17, iat: 22, load: 0, throttle: 0, maf: 0,
        map: 101, baro: 101, timing: 0, stft1: 0, ltft1: 1.6, stft2: 0, ltft2: 0.8, o2b1s1: 0.45, o2b1s2: 0.7,
        voltage: 12.6, fuelLevel: 63, fuelPress: 381, runtime: 0, distMil: 0, distClear: 1843, warmups: 27, fuelRate: 0,
      };
      this.dtc = { stored: [], pending: [], permanent: [] };
      this.freeze = null;
      this.monitorDoneAt = Object.fromEntries(NONCONT.map((m) => [m, m === 'Evaporative system' ? 75 : 0]));
      this.t = 0;
      this.h1 = false; this.sh = '7DF';
      this.moduleDtcs = {};
      this.routines = {};
      this.soot = 18; this.oilLife = 12; this.epbOpen = false;
      this.setScenario(scenario);
    }

    static get scenarios() { return SCENARIOS; }

    setScenario(id, keepModules) {
      this.scenarioId = id;
      this.scenario = SCENARIOS[id] || SCENARIOS.city;
      this.scenarioT = 0;
      this.firedFaults = new Set();
      if (id === 'overheat') this.s.coolant = Math.max(this.s.coolant, 98);
      this.diesel = !!this.scenario.diesel;
      if (this.diesel && !keepModules) this.soot = Math.max(this.soot, 86);
      if (!keepModules) { this.moduleDtcs = {}; for (const [tx, list] of Object.entries(this.scenario.modules || {})) this.moduleDtcs[tx] = list.map((d) => ({ ...d })); }
    }

    async connect() { this.connected = true; this.last = performance.now(); this.t = 0; }
    async disconnect() { this.connected = false; }

    // ----- vehicle physics -----
    step() {
      const now = performance.now();
      const dt = Math.min(0.5, (now - this.last) / 1000);
      this.last = now;
      if (dt <= 0) return;
      this.t += dt; this.scenarioT += dt;
      const s = this.s, t = this.t, sc = this.scenarioId;

      let target = 0;
      if (this.scenario.drive === 'city') target = Math.sin(t / 14) > -0.35 ? clamp(32 + 22 * Math.sin(t / 6), 0, 60) : 0;
      if (this.scenario.drive === 'highway') target = 108 + 5 * Math.sin(t / 18);
      const prevSpeed = s.speed;
      s.speed = clamp(s.speed + clamp(target - s.speed, -6 * dt, 3.5 * dt), 0, 200);
      const accel = (s.speed - prevSpeed) / dt;

      let rpmTarget = 760;
      if (s.speed > 2) {
        const ratio = s.speed < 20 ? 95 : s.speed < 38 ? 60 : s.speed < 58 ? 42 : s.speed < 80 ? 31 : 21.5;
        rpmTarget = Math.max(1150, s.speed * ratio);
      }
      if (s.coolant < 50) rpmTarget += 350; // cold fast idle
      const off = this.scenario.drive === 'off';
      if (off) s.rpm = 0;
      else {
        if (s.rpm < 300) s.rpm = 900; // cranked and started
        s.rpm += (rpmTarget - s.rpm) * clamp(dt * 3, 0, 1) + noise(sc === 'misfire' ? 70 : 8);
        s.rpm = clamp(s.rpm, 600, 7000);
      }

      s.throttle = off ? 9 : clamp(13 + s.speed * 0.14 + Math.max(0, accel) * 6 + noise(0.4), 11, 100);
      s.load = off ? 0 : clamp(18 + s.throttle * 0.55 + Math.max(0, accel) * 4 + noise(1), 10, 100);
      s.maf = off ? 0 : clamp(s.rpm * s.load / 5200 + (sc === 'lean' ? -0.6 : 0) + noise(0.1), 0.5, 300);
      s.map = off ? s.baro : clamp(24 + s.load * 0.72 + (sc === 'lean' ? 6 : 0) + noise(0.8), 20, s.baro);
      s.timing = clamp(6 + s.rpm / 140 - s.load * 0.12 + noise(0.8), -10, 45);

      const thermostat = sc === 'overheat' ? 125 : 91;
      const warmRate = off ? (s.coolant > s.ambient ? -0.05 : 0) : s.coolant < thermostat ? (sc === 'overheat' ? 0.45 : 1.4) : -0.6;
      s.coolant = clamp(s.coolant + warmRate * dt + noise(0.03), s.ambient, 130);
      s.oilTemp += (s.coolant + 6 - s.oilTemp) * clamp(dt * 0.08, 0, 1);
      s.iat += (s.ambient + (s.speed < 5 ? 22 : 9) - s.iat) * clamp(dt * 0.05, 0, 1);

      const closedLoop = s.coolant > 60 && !off;
      const ltftTarget = sc === 'lean' ? 17.5 : 1.6, ltftTarget2 = sc === 'lean' ? 15.2 : 0.8;
      s.ltft1 += (ltftTarget - s.ltft1) * clamp(dt * 0.15, 0, 1);
      s.ltft2 += (ltftTarget2 - s.ltft2) * clamp(dt * 0.15, 0, 1);
      const stftBias = sc === 'lean' ? 6.5 : sc === 'misfire' ? 3 : 0;
      s.stft1 = closedLoop ? stftBias + 3.2 * Math.sin(t * 5.2) + noise(sc === 'misfire' ? 4 : 1) : 0;
      s.stft2 = closedLoop ? stftBias * 0.9 + 3 * Math.sin(t * 4.7 + 1) + noise(1) : 0;

      const period = s.speed > 5 ? 0.8 : 1.4;
      const bias = sc === 'lean' ? -0.12 : 0;
      s.o2b1s1 = closedLoop ? clamp(0.45 + bias + 0.38 * Math.tanh(3 * Math.sin(2 * Math.PI * t / period)) + noise(0.03), 0.05, 0.95) : 0.45;
      s.o2b1s2 = sc === 'catalyst' && closedLoop
        ? clamp(0.45 + 0.32 * Math.tanh(3 * Math.sin(2 * Math.PI * (t - 0.15) / period)) + noise(0.03), 0.05, 0.95)
        : clamp(0.68 + 0.03 * Math.sin(t / 3) + noise(0.01), 0, 1);

      const vTarget = off ? 12.55 : sc === 'charging' ? 11.8 : 14.25;
      s.voltage += (vTarget - s.voltage) * clamp(dt * (sc === 'charging' ? 0.02 : 0.8), 0, 1) + noise(0.02);

      s.fuelRate = s.maf / 14.7 / 745 * 3600;
      s.fuelLevel = clamp(s.fuelLevel - s.fuelRate * dt / 3600 / 0.5, 0, 100);
      s.fuelPress = 381 + noise(4);
      const regen = this.routines.dpf && this.routines.dpf.running;
      const catTarget = s.coolant < 60 ? s.coolant + 60 : 380 + s.load * 3 + (regen ? 260 : 0);
      s.catTemp = (s.catTemp || 30) + (catTarget - (s.catTemp || 30)) * clamp(dt * 0.1, 0, 1) + noise(1);
      s.egrCmd = this.diesel ? clamp(30 - s.load * 0.3, 0, 40) : clamp((s.load - 30) * 0.4, 0, 18);
      s.purge = s.coolant > 70 ? clamp(10 + 8 * Math.sin(t / 9), 0, 40) : 0;
      s.absLoad = clamp(s.load * 0.85 + noise(1), 0, 100);
      s.lambdaCmd = s.coolant < 60 ? 0.92 : this.diesel ? 1.6 + s.load / 100 : 1.0 + noise(0.003);
      s.relThrottle = clamp(s.throttle - 11, 0, 100);
      s.pedal = off ? 14 : clamp(15 + (s.throttle - 13) * 1.1, 14, 100);
      s.throttleCmd = clamp(s.throttle - 2, 0, 100);
      s.fuelSys = off ? 0 : s.coolant < 60 ? 1 : accel < -1.5 ? 4 : 2;
      if (off) { s.timing = 0; s.fuelRate = 0; s.stft1 = s.stft2 = 0; }
      s.timeMil = Math.floor((this.milSecs || 0) / 60);
      s.timeClear = Math.floor((this.clearSecs || 4420 * 60) / 60);
      this.clearSecs = (this.clearSecs || 4420 * 60) + dt;
      if (this.dtc.stored.length) this.milSecs = (this.milSecs || 0) + dt;
      this.stepRoutines(dt);
      if (!off) s.runtime += dt; else s.runtime = 0;
      const km = s.speed * dt / 3600;
      this.odoFrac = (this.odoFrac || 0) + km;
      s.distClear += km;
      if (this.dtc.stored.length) s.distMil += km;

      this.updateFaults();
    }

    updateFaults() {
      for (const f of this.scenario.faults) {
        if (this.firedFaults.has(f.code)) continue;
        const hit = f.when ? f.when(this.s) : this.scenarioT >= f.at;
        if (!hit) continue;
        this.firedFaults.add(f.code);
        if (!this.dtc.pending.includes(f.code)) this.dtc.pending.push(f.code);
        setTimeout(() => {                       // confirmed on the "second trip"
          if (!this.dtc.pending.includes(f.code)) return;
          if (!this.dtc.stored.includes(f.code)) this.dtc.stored.push(f.code);
          if (!this.dtc.permanent.includes(f.code)) this.dtc.permanent.push(f.code);
          if (!this.freeze) this.freeze = { dtc: f.code, ...this.s };
        }, 6000);
      }
    }

    // ----- ELM327 protocol -----
    async send(cmd) {
      const c = cmd.replace(/\s/g, '').toUpperCase();
      await new Promise((r) => setTimeout(r, c === 'ATZ' ? 300 : c.startsWith('AT') ? 4 : 10 + Math.random() * 14));
      if (!this.connected) throw new Error('Adapter not connected');
      this.step();
      return this.respond(c) + '\r\r>';
    }

    line(bytes) { return bytes.map(hex).join(' '); }

    /** Formats a response the way an ELM327 prints it: single frame, or ISO-TP multi-frame with ATH0. */
    frames(bytes, rx) {
      if (this.h1) {
        if (bytes.length <= 7) return `${rx} ${hex(bytes.length)} ${this.line(bytes)}`;
        const out = [`${rx} 1${hex(bytes.length >> 8).slice(1)} ${hex(bytes.length & 255)} ${this.line(bytes.slice(0, 6))}`];
        for (let i = 6, n = 1; i < bytes.length; i += 7, n++) out.push(`${rx} 2${(n & 15).toString(16).toUpperCase()} ${this.line(bytes.slice(i, i + 7))}`);
        return out.join('\r');
      }
      if (bytes.length <= 7) return this.line(bytes);
      const out = [bytes.length.toString(16).toUpperCase().padStart(3, '0'), '0: ' + this.line(bytes.slice(0, 6))];
      for (let i = 6, n = 1; i < bytes.length; i += 7, n++) out.push(`${(n & 15).toString(16).toUpperCase()}: ${this.line(bytes.slice(i, i + 7))}`);
      return out.join('\r');
    }

    respond(c) {
      if (c === 'ATZ') { this.h1 = false; this.sh = '7DF'; this.cra = null; return '\r\rELM327 v1.5'; }
      if (c === 'ATRV') return this.s.voltage.toFixed(1) + 'V';
      if (c === 'ATDPN') return 'A6';
      if (c === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
      if (c === 'ATH1') { this.h1 = true; return 'OK'; }
      if (c === 'ATH0') { this.h1 = false; return 'OK'; }
      if (c.startsWith('ATSH')) { this.sh = c.slice(4); return 'OK'; }
      if (c.startsWith('ATCRA')) { this.cra = c.slice(5) || null; return 'OK'; }
      if (c.startsWith('AT')) return 'OK';
      if (!/^[0-9A-F]+$/.test(c)) return '?';

      const functional = this.sh === '7DF';
      const uds = /^(3E|22|19|14|31|10)/.test(c);
      if (uds) {
        if (functional) return 'NO DATA';
        const mod = MODULES[this.sh];
        if (!mod) return 'NO DATA';
        const rx = (parseInt(this.sh, 16) + 8).toString(16).toUpperCase();
        if (this.cra && this.cra !== rx) return 'NO DATA';
        const bytes = this.uds(this.sh, mod, c);
        return bytes ? this.frames(bytes, rx) : 'NO DATA';
      }
      if (!functional && this.sh !== '7E0') return 'NO DATA';
      if (this.h1 && c === '0100') { // discovery: engine + transmission both answer the functional request
        return [this.frames([0x41, 0, ...this.mask(0x00)], '7E8'), this.frames([0x41, 0, 0x98, 0x18, 0x00, 0x01], '7E9')].join('\r');
      }
      const bytes = this.obd(c);
      if (bytes == null) return 'NO DATA';
      if (typeof bytes === 'string') return bytes;
      return this.frames(bytes, '7E8');
    }

    /** OBD-II service request -> response bytes, a raw string, or null for NO DATA. */
    obd(c) {
      const mode = c.slice(0, 2), pid = c.slice(2, 4);
      if (mode === '01') {
        if (pid === '00') {
          const r = this.line([0x41, 0, ...this.mask(0x00)]);
          return this.searched || this.h1 ? [0x41, 0, ...this.mask(0x00)] : (this.searched = true, 'SEARCHING...\r' + r);
        }
        if (pid === '20' || pid === '40') return [0x41, parseInt(pid, 16), ...this.mask(parseInt(pid, 16))];
        if (pid === '01') return [0x41, 0x01, ...this.monitorBytes()];
        const data = this.encode(pid, this.s);
        return data ? [0x41, parseInt(pid, 16), ...data] : null;
      }
      if (mode === '02') {
        if (!this.freeze) return null;
        if (pid === '02') return [0x42, 0x02, 0x00, ...OBD.encodeDtc(this.freeze.dtc)];
        const data = this.encode(pid, this.freeze);
        return data ? [0x42, parseInt(pid, 16), 0x00, ...data] : null;
      }
      if (c === '03') return this.dtcBytes(0x43, this.dtc.stored);
      if (c === '07') return this.dtcBytes(0x47, this.dtc.pending);
      if (c === '0A') return this.dtcBytes(0x4A, this.dtc.permanent);
      if (c === '04') { this.clearEngine(); return [0x44]; }
      if (mode === '06') return this.mode06(parseInt(pid, 16));
      if (c === '0902') return [0x49, 0x02, 0x01, ...[...VIN].map((ch) => ch.charCodeAt(0))];
      if (c === '0904') return [0x49, 0x04, 0x01, ...this.ascii('SIMCAL-E104-0001', 16)];
      if (c === '0906') return [0x49, 0x06, 0x01, 0x1A, 0x2B, 0x3C, 0x4D];
      if (c === '090A') return [0x49, 0x0A, 0x01, ...this.ascii('ECM-EngineControl', 20)];
      return null;
    }

    ascii(t, n) { return [...t.padEnd(n, '\0')].slice(0, n).map((ch) => ch.charCodeAt(0)); }

    clearEngine() {
      this.dtc.stored = []; this.dtc.pending = []; this.freeze = null;
      Object.assign(this.s, { distClear: 0, distMil: 0, warmups: 0 });
      this.clearSecs = 0; this.milSecs = 0;
      const now = this.t;
      NONCONT.forEach((m) => { this.monitorDoneAt[m] = now + 12 + Math.random() * 60; });
      this.setScenario(this.scenarioId, true); // a fault that is still present will be re-detected
    }

    dtcBytes(modeByte, codes) { return [modeByte, codes.length, ...codes.flatMap(OBD.encodeDtc)]; }

    // ----- Mode 06 -----
    mode06(mid) {
      const sc = this.scenarioId, warm = this.s.coolant > 70;
      const tests = {
        0x01: [[0x01, 0x0A, 0.45 / 0.000122, 0.3 / 0.000122, 0.6 / 0.000122], [0x05, 0x10, sc === 'lean' ? 128 : 68, 0, 100]],
        0x02: [[0x01, 0x0A, 0.68 / 0.000122, 0.5 / 0.000122, 1.0 / 0.000122]],
        0x21: [[0x80, 0x01, sc === 'catalyst' ? 720 : 210, 0, 512]],
        0x31: [[0x80, 0x1A, this.diesel ? 22 : 14, 8, 40]],
        0x3C: [[0x80, 0x17, 120, 0, 650]],
        0x41: [[0x80, 0x10, 21, 0, 60]],
        0xA1: [[0x0B, 0x24, sc === 'misfire' ? 46 : 0, 0, 0xFFFF], [0x0C, 0x24, sc === 'misfire' ? 61 : 1, 0, 0xFFFF]],
      };
      for (let cyl = 1; cyl <= 4; cyl++) {
        const n = sc === 'misfire' && cyl === 2 ? 58 : cyl === 3 ? 1 : 0;
        tests[0xA1 + cyl] = [[0x0B, 0x24, Math.round(n * 0.8), 0, 0xFFFF], [0x0C, 0x24, n, 0, 0xFFFF]];
      }
      if (mid % 0x20 === 0) { // supported-MID bitmask for this range
        const bytes = [0, 0, 0, 0];
        for (const m of Object.keys(tests).map(Number)) { const i = m - mid - 1; if (i >= 0 && i < 31) bytes[i >> 3] |= 0x80 >> (i & 7); }
        if (Object.keys(tests).map(Number).some((m) => m > mid + 0x20)) bytes[3] |= 1;
        return [0x46, mid, ...bytes];
      }
      const t = tests[mid];
      if (!t) return null;
      if (!warm && mid < 0xA1) return [0x46, ...t.flatMap(([tid, uas]) => [mid, tid, uas, 0, 0, 0, 0, 0, 0])]; // not run yet
      return [0x46, ...t.flatMap(([tid, uas, v, lo, hi]) => [mid, tid, uas, ...b2(v), ...b2(lo), ...b2(hi)])];
    }

    // ----- UDS for each module -----
    dtcsFor(tx) {
      if (tx === '7E0') {
        const map = new Map();
        for (const c of this.dtc.pending) map.set(c, 0x05);
        for (const c of this.dtc.stored) map.set(c, (map.get(c) || 0) | 0x2F | 0x80);
        return [...map].map(([code, status]) => ({ code, ftb: '00', status }));
      }
      return this.moduleDtcs[tx] || [];
    }

    uds(tx, mod, c) {
      const sid = c.slice(0, 2);
      if (sid === '3E') return [0x7E, 0x00];
      if (sid === '10') return [0x50, parseInt(c.slice(2, 4), 16), 0x00, 0x32, 0x01, 0xF4];
      if (sid === '22') {
        const did = c.slice(2, 6), txt = { F197: mod.name, F187: mod.part, F195: mod.sw, F190: VIN }[did];
        return txt ? [0x62, parseInt(did.slice(0, 2), 16), parseInt(did.slice(2), 16), ...[...txt].map((ch) => ch.charCodeAt(0))] : [0x7F, 0x22, 0x31];
      }
      if (sid === '19') {
        if (c.slice(2, 4) !== '02') return [0x7F, 0x19, 0x12];
        const mask = parseInt(c.slice(4, 6) || 'FF', 16);
        const list = this.dtcsFor(tx).filter((d) => d.status & mask);
        return [0x59, 0x02, 0xFF, ...list.flatMap((d) => [...OBD.encodeDtc(d.code), parseInt(d.ftb, 16), d.status])];
      }
      if (sid === '14') {
        if (tx === '7E0') this.clearEngine();
        else this.moduleDtcs[tx] = (this.moduleDtcs[tx] || []).filter((d) => d.status & 0x01 && this.stillFaulty(d)).map((d) => ({ ...d, status: 0x09 }));
        return [0x54];
      }
      if (sid === '31') return this.routineControl(tx, c.slice(2, 4), c.slice(4, 8), c.slice(8));
      return [0x7F, parseInt(sid, 16), 0x11];
    }

    /** Hardware faults (sensor, squib) come straight back after clearing; network history codes do not. */
    stillFaulty(d) { return /^[BC]/.test(d.code); }

    routineControl(tx, sub, rid, data) {
      const entry = Object.entries(SIM_ROUTINES).find(([, r]) => r.tx === tx && r.rid === rid);
      if (!entry) return [0x7F, 0x31, 0x31];
      const [id, def] = entry;
      const ridB = [parseInt(rid.slice(0, 2), 16), parseInt(rid.slice(2), 16)];
      if (sub === '01') {
        if (id === 'dpf' && !this.diesel) return [0x7F, 0x31, 0x22];
        if (id === 'dpf' && this.s.rpm < 500) return [0x7F, 0x31, 0x22]; // conditions not correct
        if (id === 'throttle' && this.s.rpm > 400) return [0x7F, 0x31, 0x22];
        this.routines[id] = { running: true, start: this.t, secs: def.secs, data };
        return [0x71, 0x01, ...ridB, 0x00];
      }
      if (sub === '03') {
        const r = this.routines[id];
        if (!r) return [0x7F, 0x31, 0x24];
        const pct = Math.min(100, Math.round((this.t - r.start) / r.secs * 100));
        const extra = id === 'dpf' ? Math.round(this.soot) : id === 'oil' ? Math.round(this.oilLife) : id === 'epb' ? (this.epbOpen ? 1 : 0) : 0;
        return [0x71, 0x03, ...ridB, r.running ? 0x01 : 0x00, pct, extra];
      }
      if (sub === '02') { if (this.routines[id]) this.routines[id].running = false; return [0x71, 0x02, ...ridB, 0x00]; }
      return [0x7F, 0x31, 0x12];
    }

    stepRoutines(dt) {
      for (const [id, r] of Object.entries(this.routines)) {
        if (!r.running) continue;
        if (id === 'dpf') this.soot = Math.max(4, this.soot - dt * 82 / r.secs);
        if (this.t - r.start >= r.secs) {
          r.running = false;
          if (id === 'oil') this.oilLife = 100;
          if (id === 'epb') this.epbOpen = r.data === '01';
          if (id === 'dpf') { this.soot = 4; this.dtc.stored = this.dtc.stored.filter((c) => c !== 'P2463'); this.dtc.pending = this.dtc.pending.filter((c) => c !== 'P2463'); this.firedFaults.add('P2463'); this.scenario = { ...this.scenario, faults: [] }; }
        }
      }
    }

    monitorBytes() {
      const A = (this.dtc.stored.length ? 0x80 : 0) | this.dtc.stored.length;
      const B = 0x07 | (this.diesel ? 0x08 : 0);
      let C = 0, D = 0;
      for (const m of NONCONT) {
        C |= 1 << NONCONT_BIT[m];
        if (this.t < this.monitorDoneAt[m]) D |= 1 << NONCONT_BIT[m];
      }
      return [A, B, C, D];
    }

    mask(base) {
      const supported = [...Object.keys(OBD.PIDS).map((p) => parseInt(p, 16)), 0x01, 0x20, 0x40];
      const bytes = [0, 0, 0, 0];
      for (const p of supported) {
        const i = p - base - 1;
        if (i >= 0 && i < 32) bytes[i >> 3] |= 0x80 >> (i & 7);
      }
      return bytes;
    }

    encode(pid, s) {
      switch (pid) {
        case '04': return b1(s.load * 255 / 100);
        case '05': return b1(s.coolant + 40);
        case '06': return trim(s.stft1);
        case '07': return trim(s.ltft1);
        case '08': return trim(s.stft2);
        case '09': return trim(s.ltft2);
        case '0A': return this.diesel ? null : b1(s.fuelPress / 3);
        case '0B': return b1(s.map);
        case '0C': return b2(s.rpm * 4);
        case '0D': return b1(s.speed);
        case '0E': return b1((s.timing + 64) * 2);
        case '0F': return b1(s.iat + 40);
        case '10': return b2(s.maf * 100);
        case '11': return b1(s.throttle * 255 / 100);
        case '14': return [s.o2b1s1 * 200, 0x80];
        case '15': return [s.o2b1s2 * 200, 0xFF];
        case '1F': return b2(s.runtime);
        case '21': return b2(s.distMil);
        case '2F': return b1(s.fuelLevel * 255 / 100);
        case '30': return b1(s.warmups);
        case '31': return b2(s.distClear);
        case '33': return b1(s.baro);
        case '42': return b2(s.voltage * 1000);
        case '46': return b1(s.ambient + 40);
        case '5C': return b1(s.oilTemp + 40);
        case '5E': return b2(s.fuelRate * 20);
        case '03': return [s.fuelSys || 2, 0];
        case '1C': return b1(6);
        case '2C': return b1(s.egrCmd * 255 / 100);
        case '2E': return b1(s.purge * 255 / 100);
        case '3C': return b2((s.catTemp + 40) * 10);
        case '43': return b2(s.absLoad * 255 / 100);
        case '44': return b2(s.lambdaCmd * 65536 / 2);
        case '45': return b1(s.relThrottle * 255 / 100);
        case '49': return b1(s.pedal * 255 / 100);
        case '4C': return b1(s.throttleCmd * 255 / 100);
        case '4D': return b2(s.timeMil || 0);
        case '4E': return b2(s.timeClear || 0);
        case '51': return b1(this.diesel ? 4 : 1);
        default: return null;
      }
    }
  }

  SimulatedElmTransport.routines = SIM_ROUTINES;
  OBD.SimulatedElmTransport = SimulatedElmTransport;
})(window.OBD = window.OBD || {});
