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
    // Extended set (live data view)
    '03': { key: 'fuelSys',   label: 'Fuel system status',   kind: 'enum',     n: 2, f: ([a]) => a, enum: { 0: 'Off', 1: 'Open loop (cold)', 2: 'Closed loop', 4: 'Open loop (load / decel)', 8: 'Open loop (fault)', 16: 'Closed loop (O2 fault)' } },
    '1C': { key: 'obdStd',    label: 'OBD standard',         kind: 'enum',     n: 1, f: ([a]) => a, enum: { 1: 'OBD-II (CARB)', 2: 'OBD (EPA)', 3: 'OBD and OBD-II', 4: 'OBD-I', 5: 'Not OBD compliant', 6: 'EOBD (Europe)', 7: 'EOBD and OBD-II', 8: 'EOBD and OBD', 9: 'EOBD, OBD and OBD-II', 10: 'JOBD (Japan)', 11: 'JOBD and OBD-II', 12: 'JOBD and EOBD', 13: 'JOBD, EOBD and OBD-II' } },
    '2C': { key: 'egrCmd',    label: 'Commanded EGR',        kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '2E': { key: 'purge',     label: 'Commanded EVAP purge', kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '3C': { key: 'catTemp',   label: 'Catalyst temp B1S1',   kind: 'temp',     n: 2, f: ([a, b]) => (a * 256 + b) / 10 - 40 },
    '43': { key: 'absLoad',   label: 'Absolute load',        kind: 'pct',      n: 2, f: ([a, b]) => (a * 256 + b) * 100 / 255 },
    '44': { key: 'lambdaCmd', label: 'Commanded lambda',     kind: 'ratio',    n: 2, f: ([a, b]) => (a * 256 + b) * 2 / 65536 },
    '45': { key: 'relThrottle', label: 'Relative throttle',  kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '49': { key: 'pedal',     label: 'Accelerator pedal D',  kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '4C': { key: 'throttleCmd', label: 'Commanded throttle', kind: 'pct',      n: 1, f: ([a]) => a * 100 / 255 },
    '4D': { key: 'timeMil',   label: 'Time with MIL on',     kind: 'min',      n: 2, f: ([a, b]) => a * 256 + b },
    '4E': { key: 'timeClear', label: 'Time since codes cleared', kind: 'min',  n: 2, f: ([a, b]) => a * 256 + b },
    '51': { key: 'fuelType',  label: 'Fuel type',            kind: 'enum',     n: 1, f: ([a]) => a, enum: { 1: 'Petrol', 2: 'Methanol', 3: 'Ethanol', 4: 'Diesel', 5: 'LPG', 6: 'CNG', 7: 'Propane', 8: 'Electric', 9: 'Bifuel petrol', 17: 'Hybrid petrol', 19: 'Hybrid diesel', 20: 'Hybrid electric' } },
  };
  /** Display text for an enum PID value (fuel system status, OBD standard, fuel type). */
  function enumText(pid, v) {
    const e = PIDS[pid] && PIDS[pid].enum;
    if (!e || v == null) return null;
    return e[v] || (pid === '03' ? `Status 0x${v.toString(16)}` : `Code ${v}`);
  }
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

  // ---------- Mode 09 vehicle information ----------
  /** 49 04 (CALID, 16 chars each) / 49 0A (ECU name, 20 chars) -> array of strings. */
  function decodeInfoStrings(raw, infoType, size) {
    const d = after(payload(raw), '49' + infoType);
    if (!d || d.length < 1) return null;
    const out = [];
    for (let i = 1; i + size <= d.length; i += size) {
      const s = d.slice(i, i + size).filter((b) => b >= 32 && b < 127).map((b) => String.fromCharCode(b)).join('').trim();
      if (s) out.push(s);
    }
    return out.length ? out : null;
  }
  function decodeCvn(raw) {
    const d = after(payload(raw), '4906');
    if (!d || d.length < 5) return null;
    const out = [];
    for (let i = 1; i + 4 <= d.length; i += 4) out.push(d.slice(i, i + 4).map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(''));
    return out;
  }

  // ---------- Mode 06 on-board monitoring test results (CAN) ----------
  // Unit and scaling IDs (SAE J1979 appendix). [unit, factor, offset]; IDs >= 0x80 are the signed versions.
  const UAS = {
    0x01: ['', 1], 0x02: ['', 0.1], 0x03: ['', 0.01], 0x04: ['', 0.001], 0x05: ['', 0.0000305], 0x06: ['', 0.000305],
    0x07: ['rpm', 0.25], 0x08: ['km/h', 0.01], 0x09: ['km/h', 1], 0x0A: ['mV', 0.122], 0x0B: ['V', 0.001], 0x0C: ['V', 0.01],
    0x0D: ['mA', 0.00390625], 0x0E: ['A', 0.001], 0x0F: ['A', 0.01], 0x10: ['ms', 1], 0x11: ['ms', 100], 0x12: ['s', 1],
    0x13: ['mΩ', 1], 0x14: ['Ω', 1], 0x15: ['kΩ', 1], 0x16: ['°C', 0.1, -40], 0x17: ['kPa', 0.01], 0x18: ['kPa', 0.0117],
    0x19: ['kPa', 0.079], 0x1A: ['kPa', 1], 0x1B: ['kPa', 10], 0x1C: ['°', 0.01], 0x1D: ['°', 0.5], 0x1E: ['λ', 0.0000305],
    0x1F: ['AFR', 0.05], 0x20: ['ratio', 0.0039062], 0x21: ['mHz', 1], 0x22: ['Hz', 1], 0x23: ['kHz', 1], 0x24: ['counts', 1],
    0x25: ['km', 1], 0x26: ['mV/ms', 0.1], 0x27: ['g/s', 0.01], 0x28: ['g/s', 1],
    0x81: ['', 1], 0x82: ['', 0.1], 0x83: ['', 0.01], 0x84: ['', 0.001], 0x85: ['', 0.0000305], 0x86: ['', 0.000305],
    0x8A: ['mV', 0.122], 0x8B: ['V', 0.001], 0x8C: ['V', 0.01], 0x8D: ['mA', 0.00390625], 0x8E: ['A', 0.001], 0x90: ['ms', 1],
    0x96: ['°C', 0.1], 0x9C: ['°', 0.01], 0x9D: ['°', 0.5], 0xFC: ['kPa', 0.01], 0xFD: ['kPa', 0.001], 0xFE: ['Pa', 0.25],
  };
  const MID_NAMES = (() => {
    const n = {};
    const sensors = ['B1 S1', 'B1 S2', 'B1 S3', 'B1 S4', 'B2 S1', 'B2 S2', 'B2 S3', 'B2 S4', 'B3 S1', 'B3 S2', 'B3 S3', 'B3 S4', 'B4 S1', 'B4 S2', 'B4 S3', 'B4 S4'];
    sensors.forEach((s, i) => { n[1 + i] = `O2 sensor ${s}`; n[0x41 + i] = `O2 sensor heater ${s}`; });
    for (let b = 1; b <= 4; b++) {
      n[0x20 + b] = `Catalyst bank ${b}`; n[0x60 + b] = `Heated catalyst bank ${b}`; n[0x70 + b] = `Secondary air ${b}`;
      n[0x30 + b] = `EGR / VVT bank ${b}`; n[0x80 + b] = `Fuel system bank ${b}`; n[0x84 + b] = `Boost pressure bank ${b}`;
    }
    Object.assign(n, { 0x39: 'EVAP (cap off / 0.150")', 0x3A: 'EVAP leak 0.090"', 0x3B: 'EVAP leak 0.040"', 0x3C: 'EVAP leak 0.020"', 0x3D: 'EVAP purge flow',
      0x90: 'NOx adsorber bank 1', 0x91: 'NOx adsorber bank 2', 0x98: 'NOx catalyst bank 1', 0x99: 'NOx catalyst bank 2', 0xA1: 'Misfire (general)',
      0xB0: 'Particulate filter bank 1', 0xB1: 'Particulate filter bank 2' });
    for (let c = 1; c <= 12; c++) n[0xA1 + c] = `Misfire cylinder ${c}`;
    return n;
  })();
  const TID_NAMES = { 0x0B: 'Misfire count (avg of last 10 cycles)', 0x0C: 'Misfire count (last / current cycle)' };

  function scaleUas(id, raw) {
    const u = UAS[id];
    const signed = id >= 0x80 && raw > 0x7FFF ? raw - 0x10000 : raw;
    if (!u) return { v: raw, unit: `(units 0x${id.toString(16).toUpperCase()})` };
    return { v: (id >= 0x80 ? signed : raw) * u[1] + (u[2] || 0), unit: u[0] };
  }

  /** 46 MID TID UASID VAL(2) MIN(2) MAX(2) ... -> [{mid, tid, name, test, value, min, max, unit, pass}] */
  function decodeMode06(raw) {
    const hex = payload(raw);
    if (!hex || !hex.startsWith('46')) return null;
    const d = bytesFrom(hex.slice(2));
    const out = [];
    for (let i = 0; i + 9 <= d.length; i += 9) {
      const [mid, tid, uas] = d.slice(i, i + 3);
      const w = (k) => d[i + k] * 256 + d[i + k + 1];
      const val = scaleUas(uas, w(3)), lo = scaleUas(uas, w(5)), hi = scaleUas(uas, w(7));
      out.push({ mid, tid, name: MID_NAMES[mid] || `Monitor 0x${mid.toString(16).toUpperCase()}`, test: TID_NAMES[tid] || `Test 0x${tid.toString(16).toUpperCase().padStart(2, '0')}`,
        value: val.v, min: lo.v, max: hi.v, unit: val.unit, pass: val.v >= lo.v && val.v <= hi.v });
    }
    return out;
  }

  // ---------- UDS (ISO 14229) for other modules ----------
  /** 59 02 <mask> [DTC_hi DTC_mid FTB status]... -> [{code, ftb, status, active, confirmed, pending}] or null. */
  function decodeUdsDtcs(raw) {
    const hex = payload(raw);
    if (!hex) return null;
    if (hex.startsWith('7F19')) return { negative: hex.slice(4, 6) };
    const d = after(hex, '5902');
    if (!d) return null;
    const out = [];
    for (let i = 1; i + 4 <= d.length; i += 4) {
      const [h, m, ftb, s] = d.slice(i, i + 4);
      if (!h && !m && !ftb) continue;
      out.push({ code: decodeDtc(h, m), ftb: ftb.toString(16).toUpperCase().padStart(2, '0'), status: s,
        active: !!(s & 0x01), pending: !!(s & 0x04), confirmed: !!(s & 0x08), mil: !!(s & 0x80) });
    }
    return out;
  }
  /** 62 F1 97 <ascii...> -> string */
  function decodeUdsString(raw, did) {
    const d = after(payload(raw), '62' + did);
    if (!d) return null;
    const s = d.filter((b) => b >= 32 && b < 127).map((b) => String.fromCharCode(b)).join('').trim();
    return s || null;
  }

  Object.assign(OBD, {
    PROTOCOL_NAMES: PROTOCOLS, PIDS, KEY_TO_PID, payload, after, bytesFrom, cleanLines, decodePid, decodeSupported,
    decodeDtc, encodeDtc, decodeDtcList, decodeMonitorStatus, decodeVin, decodeProtocol, enumText,
    decodeInfoStrings, decodeCvn, decodeMode06, MID_NAMES, decodeUdsDtcs, decodeUdsString,
  });
})(window.OBD = window.OBD || {});
