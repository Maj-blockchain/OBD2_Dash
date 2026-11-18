/* OBD-II protocol layer: PID definitions, response parsing, DTC + monitor decoding.
   Pure functions only - shared by the real Bluetooth client and the simulator. */
(function (OBD) {
  'use strict';

  // Mode 01 PIDs. key = internal name, kind = unit family used for display conversion.
  // f() decodes the data bytes (A, B, ...) into metric engineering units.
  const PIDS = {
    '04': { key: 'load',      label: 'Engine load',          kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '05': { key: 'coolant',   label: 'Coolant temp',         kind: 'temp',     n: 1, f: ([a]) => a - 40 },
    '06': { key: 'stft1',     label: 'Short fuel trim B1',   kind: 'trim',     n: 1, f: ([a]) => (a - 128) * 100 / 128 },
    '07': { key: 'ltft1',     label: 'Long fuel trim B1',    kind: 'trim',     n: 1, f: ([a]) => (a - 128) * 100 / 128 },
    '08': { key: 'stft2',     label: 'Short fuel trim B2',   kind: 'trim',     n: 1, f: ([a]) => (a - 128) * 100 / 128 },
    '09': { key: 'ltft2',     label: 'Long fuel trim B2',    kind: 'trim',     n: 1, f: ([a]) => (a - 128) * 100 / 128 },
    '0A': { key: 'fuelPress', label: 'Fuel pressure',        kind: 'pressure', n: 1, f: ([a]) => a * 3 },
    '0B': { key: 'map',       label: 'Intake manifold (MAP)', kind: 'pressure', n: 1, f: ([a]) => a },
    '0C': { key: 'rpm',       label: 'Engine speed',         kind: 'rpm',      n: 2, f: ([a, b]) => (a * 256 + b) / 4 },
    '0D': { key: 'speed',     label: 'Vehicle speed',        kind: 'speed',    n: 1, f: ([a]) => a },
    '0E': { key: 'timing',    label: 'Timing advance',       kind: 'deg',      n: 1, f: ([a]) => a / 2 - 64 },
    '0F': { key: 'iat',       label: 'Intake air temp',      kind: 'temp',     n: 1, f: ([a]) => a - 40 },
    '10': { key: 'maf',       label: 'Mass air flow',        kind: 'flow',     n: 2, f: ([a, b]) => (a * 256 + b) / 100 },
    '11': { key: 'throttle',  label: 'Throttle position',    kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '14': { key: 'o2b1s1',    label: 'O2 B1 S1 (upstream)',  kind: 'volt',     n: 2, f: ([a]) => a / 200 },
    '15': { key: 'o2b1s2',    label: 'O2 B1 S2 (downstream)', kind: 'volt',    n: 2, f: ([a]) => a / 200 },
    '1F': { key: 'runtime',   label: 'Run time since start', kind: 'sec',      n: 2, f: ([a, b]) => a * 256 + b },
    '21': { key: 'distMil',   label: 'Distance with MIL on', kind: 'dist',     n: 2, f: ([a, b]) => a * 256 + b },
    '2F': { key: 'fuelLevel', label: 'Fuel level',           kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '30': { key: 'warmups',   label: 'Warm-ups since clear', kind: 'count',    n: 1, f: ([a]) => a },
    '31': { key: 'distClear', label: 'Distance since clear', kind: 'dist',     n: 2, f: ([a, b]) => a * 256 + b },
    '33': { key: 'baro',      label: 'Barometric pressure',  kind: 'pressure', n: 1, f: ([a]) => a },
    '42': { key: 'voltage',   label: 'Control module voltage', kind: 'volt',   n: 2, f: ([a, b]) => (a * 256 + b) / 1000 },
    '46': { key: 'ambient',   label: 'Ambient air temp',     kind: 'temp',     n: 1, f: ([a]) => a - 40 },
    '5C': { key: 'oilTemp',   label: 'Engine oil temp',      kind: 'temp',     n: 1, f: ([a]) => a - 40 },
    '5E': { key: 'fuelRate',  label: 'Engine fuel rate',     kind: 'lph',      n: 2, f: ([a, b]) => (a * 256 + b) / 20 },
  };
  const KEY_TO_PID = Object.fromEntries(Object.entries(PIDS).map(([pid, d]) => [d.key, pid]));

  // ---------- Raw response handling ----------
  const ERROR_RE = /NO DATA|UNABLE TO CONNECT|CAN ERROR|BUS (INIT|BUSY|ERROR)|STOPPED|ERROR|^\?$/i;

  function cleanLines(raw) {
    return String(raw).replace(/>/g, '').split(/[\r\n]+/)
      .map((l) => l.trim()).filter((l) => l && !/^SEARCHING/i.test(l));
  }

  /** Joins a (possibly multi-frame ISO-TP) response into one hex string, or null on error. */
  function payload(raw) {
    const lines = cleanLines(raw);
    if (!lines.length || lines.some((l) => ERROR_RE.test(l))) return null;
    const parts = [];
    for (const l of lines) {
      const framed = l.match(/^[0-9A-F]:\s*(.*)$/i);           // "0: 49 02 01 ..."
      if (framed) { parts.push(framed[1]); continue; }
      if (/^[0-9A-F]{3}$/i.test(l.replace(/\s/g, ''))) continue; // ISO-TP length line "014"
      parts.push(l);
    }
    return parts.join('').replace(/\s/g, '').toUpperCase();
  }

  function bytesFrom(hex) {
    const out = [];
    for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
    return out;
  }

  /** Byte array following the first byte-aligned occurrence of `header` (e.g. "410C"). */
  function after(hex, header) {
    if (!hex) return null;
    for (let i = 0; i <= hex.length - header.length; i += 2) {
      if (hex.substr(i, header.length) === header) return bytesFrom(hex.substr(i + header.length));
    }
    return null;
  }

  function decodePid(pid, raw, mode = '41') {
    const def = PIDS[pid];
    const data = after(payload(raw), mode + pid);
    if (!def || !data || data.length < def.n) return null;
    return def.f(data.slice(0, def.n));
  }

  // Bitmask from 0100 / 0120 / 0140: bit i (MSB first) => PID base+1+i supported.
  function decodeSupported(base, raw) {
    const data = after(payload(raw), '41' + base);
    if (!data || data.length < 4) return [];
    const list = [];
    const start = parseInt(base, 16);
    for (let i = 0; i < 32; i++) {
      if (data[i >> 3] & (0x80 >> (i & 7))) list.push((start + i + 1).toString(16).toUpperCase().padStart(2, '0'));
    }
    return list;
  }

  // ---------- Diagnostic trouble codes ----------
  function decodeDtc(b1, b2) {
    const h = (n) => n.toString(16).toUpperCase();
    return 'PCBU'[b1 >> 6] + ((b1 >> 4) & 3) + h(b1 & 0xF) + h(b2 >> 4) + h(b2 & 0xF);
  }
  function encodeDtc(code) {
    const letter = 'PCBU'.indexOf(code[0]);
    const d = code.slice(1);
    return [(letter << 6) | (parseInt(d[0], 16) << 4) | parseInt(d[1], 16), parseInt(d.slice(2), 16)];
  }

  /** Mode 03 / 07 / 0A response -> ["P0171", ...], or null when the adapter got no valid reply.
      Each line is one ECU's answer (CAN: count byte + pairs; legacy: 3 pairs per line). */
  function decodeDtcList(raw, respMode) {
    const lines = cleanLines(raw);
    if (!lines.length || lines.some((l) => ERROR_RE.test(l))) return null;
    const multiFrame = lines.some((l) => /^[0-9A-F]:/i.test(l));
    const chunks = multiFrame ? [payload(raw)] : lines.map((l) => l.replace(/\s/g, '').toUpperCase());
    const codes = [];
    let valid = false;
    for (const chunk of chunks) {
      if (!chunk || !chunk.startsWith(respMode)) continue;
      valid = true;
      let data = bytesFrom(chunk.slice(2));
      if (data.length % 2 === 1) data = data.slice(1); // CAN: leading DTC count byte
      for (let i = 0; i + 1 < data.length; i += 2) {
        if (data[i] === 0 && data[i + 1] === 0) continue;
        codes.push(decodeDtc(data[i], data[i + 1]));
      }
    }
    return valid ? [...new Set(codes)] : null;
  }

  // ---------- Monitor status (PID 01) ----------
  const SPARK_MONITORS = ['Catalyst', 'Heated catalyst', 'Evaporative system', 'Secondary air', 'A/C refrigerant', 'Oxygen sensor', 'Oxygen sensor heater', 'EGR / VVT system'];
  const DIESEL_MONITORS = ['NMHC catalyst', 'NOx / SCR', null, 'Boost pressure', null, 'Exhaust gas sensor', 'Particulate filter', 'EGR / VVT system'];

  function decodeMonitorStatus(raw) {
    const d = after(payload(raw), '4101');
    if (!d || d.length < 4) return null;
    const [A, B, C, D] = d;
    const diesel = !!(B & 0x08);
    const monitors = [];
    ['Misfire', 'Fuel system', 'Comprehensive components'].forEach((name, i) => {
      monitors.push({ name, continuous: true, supported: !!(B & (1 << i)), complete: !(B & (1 << (i + 4))) });
    });
    (diesel ? DIESEL_MONITORS : SPARK_MONITORS).forEach((name, i) => {
      if (!name) return;
      monitors.push({ name, continuous: false, supported: !!(C & (1 << i)), complete: !(D & (1 << i)) });
    });
    return { mil: !!(A & 0x80), dtcCount: A & 0x7F, ignition: diesel ? 'Compression (diesel)' : 'Spark (petrol)', monitors };
  }

  function decodeVin(raw) {
    const data = after(payload(raw), '4902');
    if (!data) return null;
    const ascii = data.slice(1).map((b) => String.fromCharCode(b)).join('').replace(/[^A-HJ-NPR-Z0-9]/g, '');
    return ascii.slice(-17) || null;
  }

  const PROTOCOLS = {
    '1': 'SAE J1850 PWM', '2': 'SAE J1850 VPW', '3': 'ISO 9141-2', '4': 'ISO 14230-4 KWP (5 baud)',
    '5': 'ISO 14230-4 KWP (fast)', '6': 'ISO 15765-4 CAN 11/500', '7': 'ISO 15765-4 CAN 29/500',
    '8': 'ISO 15765-4 CAN 11/250', '9': 'ISO 15765-4 CAN 29/250', 'A': 'SAE J1939 CAN',
  };
  function decodeProtocol(raw) {
    const l = cleanLines(raw)[0] || '';
    const num = l.replace(/^A/i, '').trim().toUpperCase();
    return PROTOCOLS[num] ? PROTOCOLS[num] + (/^A/i.test(l) ? ' (auto)' : '') : l || 'Unknown';
  }

  Object.assign(OBD, {
    PROTOCOL_NAMES: PROTOCOLS, PIDS, KEY_TO_PID, payload, after, bytesFrom, cleanLines, decodePid, decodeSupported,
    decodeDtc, encodeDtc, decodeDtcList, decodeMonitorStatus, decodeVin, decodeProtocol,
  });
})(window.OBD = window.OBD || {});
