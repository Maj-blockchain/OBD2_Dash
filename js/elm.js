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
        if (this.tx && this.rx) break;
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
        const r = await this.t.send(c, timeout);
        this.log('rx', r.replace(/[\r\n]+/g, ' ').replace(/>\s*$/, '').trim());
        return r;
      };
      const p = this.queue.then(run, run);
      this.queue = p.catch(() => {});
      return p;
    }

    async init() {
      const id = OBD.cleanLines(await this.cmd('ATZ', 8000)).pop() || 'ELM327';
      for (const c of ['ATE0', 'ATL0', 'ATS1', 'ATH0', 'ATAT1', 'ATSP0']) await this.cmd(c);
      await this.cmd('0100', 15000); // triggers protocol search
      this.adapter = id;
      this.protocol = OBD.decodeProtocol(await this.cmd('ATDPN'));
      await this.loadSupported();
      return { adapter: this.adapter, protocol: this.protocol };
    }

    async loadSupported() {
      this.supported.clear();
      for (const base of ['00', '20', '40', '60']) {
        const list = OBD.decodeSupported(base, await this.cmd('01' + base));
        list.forEach((p) => this.supported.add(p));
        const next = (parseInt(base, 16) + 0x20).toString(16).toUpperCase().padStart(2, '0');
        if (!this.supported.has(next)) break;
      }
    }

    has(pid) { return this.supported.has(pid); }
    async readPid(pid) { return OBD.decodePid(pid, await this.cmd('01' + pid)); }
    async readFreeze(pid) {
      const def = OBD.PIDS[pid];
      const d = OBD.after(OBD.payload(await this.cmd('02' + pid + '00')), '42' + pid + '00'); // 42 PID FRAME data...
      return def && d && d.length >= def.n ? def.f(d.slice(0, def.n)) : null;
    }
    async readFreezeDtc() {
      const d = OBD.after(OBD.payload(await this.cmd('020200')), '420200');
      return d && (d[0] || d[1]) ? OBD.decodeDtc(d[0], d[1]) : null;
    }
    async readMonitorStatus() { return OBD.decodeMonitorStatus(await this.cmd('0101')); }
    async readDtcs() {
      return {
        stored: OBD.decodeDtcList(await this.cmd('03'), '43'),
        pending: OBD.decodeDtcList(await this.cmd('07'), '47'),
        permanent: OBD.decodeDtcList(await this.cmd('0A'), '4A'),
      };
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
