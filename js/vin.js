/* AutoVIN: decodes a 17-character VIN into manufacturer, country, model year and check-digit status.
   Offline table of common world manufacturer identifiers (WMI); unknown makes fall back to the region. */
(function (OBD) {
  'use strict';

  const WMI = {
    WVW: 'Volkswagen', WVG: 'Volkswagen (SUV)', WV1: 'Volkswagen Commercial', WV2: 'Volkswagen Commercial', '3VW': 'Volkswagen (Mexico)',
    WAU: 'Audi', TRU: 'Audi (Hungary)', WBA: 'BMW', WBS: 'BMW M', WBY: 'BMW i', WMW: 'MINI', WDB: 'Mercedes-Benz', WDD: 'Mercedes-Benz',
    W1K: 'Mercedes-Benz', W1N: 'Mercedes-Benz (SUV)', WDF: 'Mercedes-Benz (van)', W1V: 'Mercedes-Benz (van)', WP0: 'Porsche', WP1: 'Porsche (SUV)',
    WF0: 'Ford (Germany)', W0L: 'Opel / Vauxhall', W0V: 'Opel / Vauxhall', VF1: 'Renault', VF3: 'Peugeot', VR3: 'Peugeot', VF7: 'Citroën',
    VR1: 'DS Automobiles', UU1: 'Dacia', VSS: 'SEAT', VSK: 'Nissan (Spain)', TMB: 'Škoda', TMA: 'Hyundai (Czechia)', U5Y: 'Kia (Slovakia)',
    ZFA: 'Fiat', ZAR: 'Alfa Romeo', ZFF: 'Ferrari', ZHW: 'Lamborghini', ZAM: 'Maserati', SAJ: 'Jaguar', SAL: 'Land Rover', SAD: 'Jaguar (SUV)',
    SCC: 'Lotus', SCF: 'Aston Martin', SCB: 'Bentley', SCA: 'Rolls-Royce', SAR: 'Rover', SHH: 'Honda (UK)', SHS: 'Honda (UK)', SJN: 'Nissan (UK)',
    SB1: 'Toyota (UK)', SFA: 'Ford (UK)', YV1: 'Volvo', YV4: 'Volvo (SUV)', YS3: 'Saab', LVY: 'Volvo (China)', NMT: 'Toyota (Turkey)', VNK: 'Toyota (France)',
    JHM: 'Honda', JHL: 'Honda', JN1: 'Nissan', JN8: 'Nissan (SUV)', JT: 'Toyota', JTH: 'Lexus', JM1: 'Mazda', JMZ: 'Mazda (Europe)', JF1: 'Subaru', JF2: 'Subaru',
    JS: 'Suzuki', JMB: 'Mitsubishi', JMY: 'Mitsubishi', KMH: 'Hyundai', KMF: 'Hyundai (van)', KNA: 'Kia', KND: 'Kia', KNM: 'Renault Samsung',
    MAL: 'Hyundai (India)', MA3: 'Suzuki (India)', '1FA': 'Ford', '1FT': 'Ford (truck)', '1FM': 'Ford (SUV)', '1G1': 'Chevrolet', '1GC': 'Chevrolet (truck)',
    '1GN': 'Chevrolet (SUV)', '1G6': 'Cadillac', '1HG': 'Honda (USA)', '1N4': 'Nissan (USA)', '1C4': 'Chrysler / Jeep', '1J4': 'Jeep', '2T1': 'Toyota (Canada)',
    '4T1': 'Toyota (USA)', '5YJ': 'Tesla', '7SA': 'Tesla', LRW: 'Tesla (China)', XP7: 'Tesla (Germany)', XTA: 'Lada', LSV: 'SAIC Volkswagen', LFV: 'FAW Volkswagen',
    LB3: 'Geely', LGX: 'BYD', SDB: 'Peugeot (UK)', NM0: 'Ford (Turkey)',
  };

  const REGION = (c) => {
    if (/[A-H]/.test(c)) return 'Africa';
    if (c === 'J') return 'Japan'; if (c === 'K') return 'South Korea'; if (c === 'L') return 'China';
    if (/[M-R]/.test(c)) return 'Asia';
    if (c === 'S') return 'United Kingdom'; if (c === 'W') return 'Germany'; if (c === 'Z') return 'Italy'; if (c === 'X') return 'Russia / Eastern Europe';
    if (c === 'Y') return 'Sweden / Finland / Belgium'; if (c === 'V') return 'France / Spain / Austria'; if (c === 'T') return 'Central Europe';
    if (c === 'U') return 'Europe';
    if (/[145]/.test(c)) return 'United States'; if (c === '2') return 'Canada'; if (c === '3') return 'Mexico';
    if (/[67]/.test(c)) return 'Oceania'; if (/[89]/.test(c)) return 'South America';
    return 'Unknown';
  };

  const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
  const VALUES = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
  const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

  function checkDigit(vin) {
    let sum = 0;
    for (let i = 0; i < 17; i++) { const c = vin[i]; sum += (/\d/.test(c) ? +c : VALUES[c] || 0) * WEIGHTS[i]; }
    const r = sum % 11;
    return r === 10 ? 'X' : String(r);
  }

  /** Returns { vin, make, wmi, region, year, yearAlt, serial, checkOk, northAmerica } or null. */
  function decodeVin(vin) {
    if (!vin) return null;
    vin = String(vin).toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (vin.length !== 17) return { vin, invalid: true };
    const wmi = vin.slice(0, 3);
    const make = WMI[wmi] || WMI[wmi.slice(0, 2)] || null;
    const region = REGION(vin[0]);
    const northAmerica = /[1-5]/.test(vin[0]);
    const idx = YEAR_CODES.indexOf(vin[9]);
    let year = null, yearAlt = null;
    if (idx >= 0) {
      const now = new Date().getFullYear() + 1;
      const candidates = [1980 + idx, 2010 + idx, 2040 + idx].filter((y) => y <= now);
      // North American VINs: position 7 numeric = 1980-2009, letter = 2010-2039.
      if (northAmerica) year = /\d/.test(vin[6]) ? 1980 + idx : 2010 + idx;
      else { year = candidates[candidates.length - 1]; yearAlt = candidates.length > 1 ? candidates[candidates.length - 2] : null; }
    }
    const expected = checkDigit(vin);
    return { vin, wmi, make, region, year, yearAlt, serial: vin.slice(11), plant: vin[10], vds: vin.slice(3, 9),
      northAmerica, checkOk: vin[8] === expected, expectedCheck: expected };
  }

  OBD.decodeVinInfo = decodeVin;
})(window.OBD = window.OBD || {});
