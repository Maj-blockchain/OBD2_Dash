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
    idle:     { label: 'Healthy - idling', drive: 'idle', faults: [] },
    city:     { label: 'Healthy - city driving', drive: 'city', faults: [] },
    highway:  { label: 'Healthy - highway cruise', drive: 'highway', faults: [] },
    lean:     { label: 'Fault - vacuum leak (lean)', drive: 'idle', faults: [{ code: 'P0171', at: 4 }, { code: 'P0174', at: 9 }] },
    misfire:  { label: 'Fault - cylinder 2 misfire', drive: 'city', faults: [{ code: 'P0302', at: 3 }, { code: 'P0300', at: 10 }] },
    overheat: { label: 'Fault - cooling fan failure', drive: 'city', faults: [{ code: 'P0217', when: (s) => s.coolant > 112 }] },
    catalyst: { label: 'Fault - worn catalytic converter', drive: 'highway', faults: [{ code: 'P0420', at: 6 }] },
    charging: { label: 'Fault - alternator not charging', drive: 'city', faults: [{ code: 'P0562', when: (s) => s.voltage < 12.4 }] },
  };

  const NONCONT = ['Catalyst', 'Evaporative system', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR / VVT system'];
  const NONCONT_BIT = { 'Catalyst': 0, 'Evaporative system': 2, 'Oxygen sensor': 5, 'Oxygen sensor heater': 6, 'EGR / VVT system': 7 };
  const VIN = '1ABCD23E4FG567890'; // fictional demo VIN

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
      this.setScenario(scenario);
    }

    static get scenarios() { return SCENARIOS; }

    setScenario(id) {
      this.scenarioId = id;
      this.scenario = SCENARIOS[id] || SCENARIOS.city;
      this.scenarioT = 0;
      this.firedFaults = new Set();
      if (id === 'overheat') this.s.coolant = Math.max(this.s.coolant, 98);
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
      s.rpm += (rpmTarget - s.rpm) * clamp(dt * 3, 0, 1) + noise(sc === 'misfire' ? 70 : 8);
      s.rpm = clamp(s.rpm, 600, 7000);

      s.throttle = clamp(13 + s.speed * 0.14 + Math.max(0, accel) * 6 + noise(0.4), 11, 100);
      s.load = clamp(18 + s.throttle * 0.55 + Math.max(0, accel) * 4 + noise(1), 10, 100);
      s.maf = clamp(s.rpm * s.load / 5200 + (sc === 'lean' ? -0.6 : 0) + noise(0.1), 0.5, 300);
      s.map = clamp(24 + s.load * 0.72 + (sc === 'lean' ? 6 : 0) + noise(0.8), 20, s.baro);
      s.timing = clamp(6 + s.rpm / 140 - s.load * 0.12 + noise(0.8), -10, 45);

      const thermostat = sc === 'overheat' ? 125 : 91;
      const warmRate = s.coolant < thermostat ? (sc === 'overheat' ? 0.45 : 1.4) : -0.6;
      s.coolant = clamp(s.coolant + warmRate * dt + noise(0.03), s.ambient, 130);
      s.oilTemp += (s.coolant + 6 - s.oilTemp) * clamp(dt * 0.08, 0, 1);
      s.iat += (s.ambient + (s.speed < 5 ? 22 : 9) - s.iat) * clamp(dt * 0.05, 0, 1);

      const closedLoop = s.coolant > 60;
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

      const vTarget = sc === 'charging' ? 11.8 : 14.25;
      s.voltage += (vTarget - s.voltage) * clamp(dt * (sc === 'charging' ? 0.02 : 0.8), 0, 1) + noise(0.02);

      s.fuelRate = s.maf / 14.7 / 745 * 3600;
      s.fuelLevel = clamp(s.fuelLevel - s.fuelRate * dt / 3600 / 0.5, 0, 100);
      s.fuelPress = 381 + noise(4);
      s.runtime += dt;
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
      await new Promise((r) => setTimeout(r, c === 'ATZ' ? 300 : 12 + Math.random() * 18));
      if (!this.connected) throw new Error('Adapter not connected');
      this.step();
      return this.respond(c) + '\r\r>';
    }

    line(bytes) { return bytes.map(hex).join(' '); }

    respond(c) {
      if (c === 'ATZ') return '\r\rELM327 v1.5';
      if (c === 'ATRV') return this.s.voltage.toFixed(1) + 'V';
      if (c === 'ATDPN') return 'A6';
      if (c === 'ATDP') return 'AUTO, ISO 15765-4 (CAN 11/500)';
      if (c.startsWith('AT')) return 'OK';

      const mode = c.slice(0, 2), pid = c.slice(2, 4);
      if (mode === '01') {
        if (pid === '00') return (this.searched ? '' : (this.searched = true, 'SEARCHING...\r')) + this.line([0x41, 0, ...this.mask(0x00)]);
        if (pid === '20' || pid === '40') return this.line([0x41, parseInt(pid, 16), ...this.mask(parseInt(pid, 16))]);
        if (pid === '01') return this.line([0x41, 0x01, ...this.monitorBytes()]);
        const data = this.encode(pid, this.s);
        return data ? this.line([0x41, parseInt(pid, 16), ...data]) : 'NO DATA';
      }
      if (mode === '02') {
        if (!this.freeze) return 'NO DATA';
        if (pid === '02') return this.line([0x42, 0x02, 0x00, ...OBD.encodeDtc(this.freeze.dtc)]);
        const data = this.encode(pid, this.freeze);
        return data ? this.line([0x42, parseInt(pid, 16), 0x00, ...data]) : 'NO DATA';
      }
      if (c === '03') return this.dtcLine(0x43, this.dtc.stored);
      if (c === '07') return this.dtcLine(0x47, this.dtc.pending);
      if (c === '0A') return this.dtcLine(0x4A, this.dtc.permanent);
      if (c === '04') {
        this.dtc.stored = []; this.dtc.pending = []; this.freeze = null;
        Object.assign(this.s, { distClear: 0, distMil: 0, warmups: 0 });
        const now = this.t;
        NONCONT.forEach((m) => { this.monitorDoneAt[m] = now + 12 + Math.random() * 60; });
        this.setScenario(this.scenarioId); // a fault that is still present will be re-detected
        return '44';
      }
      if (c === '0902') {
        const bytes = [0x49, 0x02, 0x01, ...[...VIN].map((ch) => ch.charCodeAt(0))];
        return ['014', '0: ' + this.line(bytes.slice(0, 6)), '1: ' + this.line(bytes.slice(6, 13)), '2: ' + this.line(bytes.slice(13, 20))].join('\r');
      }
      return c.length && /^[0-9A-F]+$/.test(c) ? 'NO DATA' : '?';
    }

    dtcLine(modeByte, codes) { return this.line([modeByte, codes.length, ...codes.flatMap(OBD.encodeDtc)]); }

    monitorBytes() {
      const A = (this.dtc.stored.length ? 0x80 : 0) | this.dtc.stored.length;
      const B = 0x07;
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
        case '0A': return b1(s.fuelPress / 3);
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
        default: return null;
      }
    }
  }

  OBD.SimulatedElmTransport = SimulatedElmTransport;
})(window.OBD = window.OBD || {});
