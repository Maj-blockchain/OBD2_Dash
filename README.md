# OBD2 Mechanic Dashboard

Open `index.html` in a browser. No build step and no dependencies. It starts the built-in simulator automatically.

## Structure
| File | Role |
|---|---|
| `js/obd.js` | OBD-II protocol: PID formulas, response parsing, DTC / readiness / VIN decoding |
| `js/dtc-db.js` | Trouble-code descriptions, severity and repair hints |
| `js/elm.js` | `ElmClient` (ELM327 command queue + init) and `BleElmTransport` (Web Bluetooth) |
| `js/sim.js` | Simulated car + ELM327 that answers with real raw hex, with fault scenarios |
| `js/charts.js` | SVG line charts (hover tooltips) and arc gauges |
| `js/app.js` | Polling loop, alert rules, rendering |

Any transport exposing `connect()`, `send(cmd) -> Promise<string ending in '>'>` and `disconnect()` can be used
(e.g. a Capacitor/Cordova BLE plugin or Bluetooth Classic SPP for the mobile app).

## Real adapter (Web Bluetooth)
Choose **Source -> Bluetooth ELM327**. You need Chrome or Edge on Android or desktop, and the page must be served over
`https://` or `http://localhost` (e.g. `python3 -m http.server`). iOS Safari has no Web Bluetooth,
and Bluetooth Classic-only dongles need a native app.
