# OBD2 Mechanic Dashboard

Open `index.html` in a browser. No build step and no dependencies. It starts the built-in simulator automatically.

## Sections
| Tab | What it does |
|---|---|
| **Dashboard** | Alerts, gauges, live trends, fuel trims, engine codes with repair guidance, readiness monitors, freeze frame |
| **Live data** | Every supported sensor (42 PIDs incl. fuel system status, catalyst temp, lambda, pedal, EGR, purge) with session min/max; tick any sensor to graph it in real time (up to 6); pause; CSV export |
| **Full system scan** | Finds every module on the CAN bus (engine, transmission, ABS/ESP, airbag, steering, TPMS, EPB, A/C, radio, BMS, gateway, cluster) and reads / clears their codes with UDS (ISO 14229). Deep scan probes all 11-bit addresses once and remembers the modules per VIN. **AutoVIN & scan** runs it on every connect |
| **Service resets** | Oil reset, throttle adaptation, EPB service mode, battery registration (BMS), TPMS reset, DPF regeneration. Each checks its preconditions against live data and logs to a service history |
| **Smog / MOT check** | Pass / not ready / will fail prediction for UK MOT, US EPA OBD I/M or generic EU rules (MIL, codes, readiness, recently cleared, SRS/ABS/EPB/TPMS lamps from the module scan) plus Mode 06 on-board test results and per-cylinder misfire counts |
| **Vehicle & report** | AutoVIN decode (manufacturer, country, model year, check digit), ECU name, calibration ID and CVN (Mode 09); printable / downloadable diagnostic report |

Interface languages: English, French, German, Spanish, Portuguese, Italian. Trouble-code explanations and alerts stay in English.

## Honest limits
- Service resets are manufacturer-specific UDS routines. The simulator implements them; for real vehicles the cards show the manual method and the
  **Log as done** button until a routine profile for that make is added to `OBD.SERVICE_PROFILES` (`{ WMI: { name, routines: { oil: { tx, rid }, … } } }`).
  Never add routine IDs you have not verified against the manufacturer's service information.
- The full system scan needs a CAN vehicle (protocols 6–9). Module addresses, names and B/C/U code meanings vary by make; cheap ELM327 clones may not
  support `ATCRA` or multi-frame UDS replies.

## Structure
| File | Role |
|---|---|
| `js/obd.js` | OBD-II protocol: PID formulas, response parsing, DTC / readiness / VIN / Mode 06 / Mode 09 / UDS decoding |
| `js/vin.js` | AutoVIN decoder (WMI table, model year, check digit) |
| `js/dtc-db.js` | Trouble-code descriptions, severity and repair hints |
| `js/elm.js` | `ElmClient` (ELM327 command queue, init, Mode 06/09, UDS module scan, routines) and `BleElmTransport` (Web Bluetooth) |
| `js/sim.js` | Simulated car + ELM327 with 12 CAN modules, UDS, Mode 06/09, reset routines and fault scenarios |
| `js/charts.js` | SVG line charts (hover tooltips) and arc gauges |
| `js/app.js` | Polling loop, alert rules, dashboard rendering, shared context (`OBD.ctx`, `OBD.on`) and the adapter gate used by features that change CAN headers |
| `js/livedata.js`, `js/systems.js`, `js/services.js`, `js/smog.js`, `js/report.js` | One file per tab |
| `js/i18n.js` | Interface translations |

Any transport exposing `connect()`, `send(cmd) -> Promise<string ending in '>'>` and `disconnect()` can be used
(e.g. a Capacitor/Cordova BLE plugin or Bluetooth Classic SPP for the mobile app).

## Real adapter (Web Bluetooth)
Choose **Source -> Bluetooth ELM327**. You need Chrome or Edge on Android or desktop, and the page must be served over
`https://` or `http://localhost` (e.g. `python3 -m http.server`). iOS Safari has no Web Bluetooth,
and Bluetooth Classic-only dongles need a native app.
