/* ELM327 client + transports.
   A transport is anything with: connect(), send(cmd) -> Promise<raw string ending in '>'>, disconnect().
   - SimulatedElmTransport (sim.js) emulates a car + adapter for development.
   - BleElmTransport (below) talks to a real Bluetooth LE OBD2 dongle via Web Bluetooth. */
(function (OBD) {
  'use strict';

  // GATT services used by common BLE ELM327 clones (Vgate, Veepeak, OBDLink CX, generic FFF0/FFE0).
  const BLE_SERVICES = [
    '0000fff0-0000-1000-8000-00805f9b34fb',
    '0000ffe0-0000-1000-8000-00805f9b34fb',
    '000018f0-0000-1000-8000-00805f9b34fb',
    'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
    '0000ae00-0000-1000-8000-00805f9b34fb',
  ];

  class BleElmTransport {
    static supported() { return !!(navigator.bluetooth && window.isSecureContext); }
    get name() { return this.device ? this.device.name || 'BLE adapter' : 'BLE adapter'; }

    async connect() {
      if (!navigator.bluetooth) throw new Error('Web Bluetooth is not available in this browser (use Chrome/Edge on Android, Windows, macOS or ChromeOS).');
      if (!window.isSecureContext) throw new Error('Web Bluetooth requires https:// or http://localhost.');
      this.device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
      this.device.addEventListener('gattserverdisconnected', () => this.onDisconnect && this.onDisconnect());
      const server = await this.device.gatt.connect();
      for (const uuid of BLE_SERVICES) {
        let svc;
        try { svc = await server.getPrimaryService(uuid); } catch { continue; }
        const chars = await svc.getCharacteristics();
        this.tx = chars.find((c) => c.properties.write || c.properties.writeWithoutResponse);
        this.rx = chars.find((c) => c.properties.notify || c.properties.indicate);
        if (this.tx && this.rx) { this.serviceUuid = uuid; break; }
      }
      if (!this.tx || !this.rx) throw new Error('No ELM327 serial characteristic found on this device.');
      this.decoder = new TextDecoder();
      this.encoder = new TextEncoder();
      this.buffer = '';
      this.rx.addEventListener('characteristicvaluechanged', (e) => {
        this.buffer += this.decoder.decode(e.target.value);
        if (this.buffer.includes('>') && this.pending) {
          const { resolve, timer } = this.pending;
          clearTimeout(timer);
          this.pending = null;
          const out = this.buffer; this.buffer = '';
          resolve(out);
        }
      });
      await this.rx.startNotifications();
      this.info = `service ${this.serviceUuid.slice(4, 8)} · write ${this.tx.uuid.slice(4, 8)}${this.tx.properties.writeWithoutResponse ? ' (no-resp)' : ''} · notify ${this.rx.uuid.slice(4, 8)}`;
    }

    send(cmd, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        this.buffer = '';
        const timer = setTimeout(() => { this.pending = null; reject(new Error('Timeout waiting for ' + cmd)); }, timeoutMs);
        this.pending = { resolve, timer };
        const data = this.encoder.encode(cmd + '\r');
        const write = this.tx.properties.writeWithoutResponse ? this.tx.writeValueWithoutResponse(data) : this.tx.writeValue(data);
        write.catch((err) => { clearTimeout(timer); this.pending = null; reject(err); });
      });
    }

    async disconnect() { if (this.device && this.device.gatt.connected) this.device.gatt.disconnect(); }
  }

  class ElmClient {
    constructor(transport, log = () => {}) {
      this.t = transport;
      this.log = log;
      this.queue = Promise.resolve();
      this.supported = new Set();
    }

    /** Serialises commands: the ELM327 handles exactly one request at a time. */
    cmd(c, timeout) {
      const run = async () => {
        this.log('tx', c);
        const r = await this.t.send(c, timeout || 10000);
        this.log('rx', r.replace(/[\r\n]+/g, ' ').replace(/>\s*$/, '').trim());
        return r;
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }

    /** onProgress(text) reports connection steps; savedProto = protocol number that worked last time. */
    async init({ onProgress = () => {}, savedProto } = {}) {
      onProgress('Resetting adapter…');
      const id = OBD.cleanLines(await this.cmd('ATZ', 8000)).pop() || 'ELM327';
      for (const c of ['ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATAT1']) await this.cmd(c);
      this.adapter = id;
      this.ecuOk = false;
      // Clone adapters (e.g. "v2.1") often fail the automatic search, so fall back to trying each protocol explicitly.
      const order = [...new Set([savedProto, '0', '6', '8', '7', '9', '5', '4', '3', '1', '2'].filter(Boolean))];
      for (const p of order) {
        onProgress(p === '0' ? 'Searching for vehicle protocol…' : `Trying ${OBD.PROTOCOL_NAMES[p] || 'protocol ' + p}…`);
        await this.cmd('ATSP' + p);
        if (await this.probe(2)) break;
      }
      if (!this.ecuOk) await this.cmd('ATSP0'); // leave the adapter on auto-search for the background retries
      this.protocol = OBD.decodeProtocol(await this.cmd('ATDPN'));
      this.protocolNum = (OBD.cleanLines(await this.cmd('ATDPN'))[0] || '').replace(/^A/i, '').trim();
      onProgress('Reading supported sensors…');
      await this.loadSupported();
      return { adapter: this.adapter, protocol: this.protocol };
    }

    /** Sends 0100 up to `tries` times; true once the ECU reports its supported PIDs. */
    async probe(tries = 1) {
      for (let i = 0; i < tries; i++) {
        const r = await this.cmd('0100', 15000);
        if (OBD.decodeSupported('00', r).length) { this.ecuOk = true; this.lastError = null; return true; }
        this.lastError = OBD.cleanLines(r).join(' ') || 'no response';
        // "NO DATA" means the bus answered on this protocol and only the reply was lost: keep trying it.
        if (/NO DATA/i.test(this.lastError) && tries < 5) tries++;
      }
      return false;
    }

    /** Called periodically while the ECU is silent (e.g. ignition switched on after connecting). */
    async retryEcu() {
      if (await this.probe(1)) {
        this.protocol = OBD.decodeProtocol(await this.cmd('ATDPN'));
        this.protocolNum = (OBD.cleanLines(await this.cmd('ATDPN'))[0] || '').replace(/^A/i, '').trim();
        await this.loadSupported();
        return true;
      }
      return false;
    }

    async loadSupported() {
      this.supported.clear();
      this.supportedGuessed = !this.ecuOk;
      if (!this.ecuOk) { // ECU didn't report support: poll the common PIDs anyway and let NO DATA filter them
        Object.keys(OBD.PIDS).forEach((p) => this.supported.add(p));
        return;
      }
      for (const base of ['00', '20', '40', '60']) {
        let list = [];
        for (let i = 0; i < 3 && !list.length; i++) list = OBD.decodeSupported(base, await this.cmd('01' + base)); // replies get dropped
        if (!list.length) { // reply never arrived: assume the PIDs we know in this range, NO DATA will filter them
          const lo = parseInt(base, 16), known = Object.keys(OBD.PIDS).filter((p) => parseInt(p, 16) > lo && parseInt(p, 16) <= lo + 0x20);
          known.forEach((p) => this.supported.add(p));
          if (base === '00') { this.supportedGuessed = true; return; }
          continue;
        }
        list.forEach((p) => this.supported.add(p));
        const next = (parseInt(base, 16) + 0x20).toString(16).toUpperCase().padStart(2, '0');
        if (!this.supported.has(next)) break;
      }
    }

    has(pid) { return this.supported.has(pid); }
    async readPid(pid) {
      let v = OBD.decodePid(pid, await this.cmd('01' + pid));
      // Clone adapters drop replies now and then: retry a supported PID once before giving up.
      if (v == null && this.ecuOk && !this.supportedGuessed) v = OBD.decodePid(pid, await this.cmd('01' + pid));
      return v;
    }
    async readFreeze(pid) {
      const def = OBD.PIDS[pid];
      const d = OBD.after(OBD.payload(await this.cmd('02' + pid + '00')), '42' + pid + '00'); // 42 PID FRAME data...
      return def && d && d.length >= def.n ? def.f(d.slice(0, def.n)) : null;
    }
    async readFreezeDtc() {
      const d = OBD.after(OBD.payload(await this.cmd('020200')), '420200');
      return d && (d[0] || d[1]) ? OBD.decodeDtc(d[0], d[1]) : null;
    }
    async readMonitorStatus() {
      const m = OBD.decodeMonitorStatus(await this.cmd('0101')) || OBD.decodeMonitorStatus(await this.cmd('0101'));
      if (m) this.lastMonitors = m;
      return m || this.lastMonitors || null; // a dropped reply keeps the last good status
    }
    async readDtcs() {
      const prev = this.lastDtcs || { stored: [], pending: [], permanent: [] };
      const read = async (cmd, mode, key) => {
        const list = OBD.decodeDtcList(await this.cmd(cmd), mode) ?? OBD.decodeDtcList(await this.cmd(cmd), mode);
        return list ?? prev[key]; // NO DATA is not the same as "no codes" (43 00): keep the last good answer
      };
      this.lastDtcs = { stored: await read('03', '43', 'stored'), pending: await read('07', '47', 'pending'), permanent: await read('0A', '4A', 'permanent') };
      return this.lastDtcs;
    }
    async clearDtcs() { return /44/.test(OBD.payload(await this.cmd('04')) || ''); }
    async readVin() { return OBD.decodeVin(await this.cmd('0902', 8000)); }
    async readBatteryVoltage() {
      const m = (OBD.cleanLines(await this.cmd('ATRV'))[0] || '').match(/([\d.]+)/);
      return m ? parseFloat(m[1]) : null;
    }
    disconnect() { return this.t.disconnect(); }
  }

  Object.assign(OBD, { BleElmTransport, ElmClient });
})(window.OBD = window.OBD || {});
