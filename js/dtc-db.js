/* Generic (SAE J2012) trouble-code descriptions with a mechanic-facing severity and hint.
   severity: critical = stop / risk of damage, serious = fix soon, warning = monitor. */
(function (OBD) {
  'use strict';
  const C = 'critical', S = 'serious', W = 'warning';
  const DB = {
    P0010: ['Camshaft position actuator circuit (Bank 1)', S, 'Check VVT solenoid wiring and oil level/condition.'],
    P0011: ['Camshaft timing over-advanced (Bank 1)', S, 'Low/dirty oil, stuck VVT solenoid, stretched timing chain.'],
    P0016: ['Crankshaft / camshaft position correlation (B1 Sensor A)', C, 'Possible timing chain jump - verify mechanical timing before driving.'],
    P0101: ['Mass air flow circuit range/performance', S, 'Dirty MAF, intake leak after MAF, clogged air filter.'],
    P0102: ['Mass air flow circuit low', S, 'Check MAF connector, wiring and 5V reference.'],
    P0113: ['Intake air temperature sensor circuit high', W, 'Open circuit / unplugged IAT sensor.'],
    P0117: ['Engine coolant temperature circuit low', S, 'Shorted ECT sensor or wiring.'],
    P0118: ['Engine coolant temperature circuit high', S, 'Open ECT circuit - fans may run constantly.'],
    P0121: ['Throttle position sensor range/performance', S, 'Worn TPS track or dirty throttle body.'],
    P0128: ['Coolant temperature below thermostat regulating temperature', W, 'Thermostat stuck open - verify warm-up curve.'],
    P0130: ['O2 sensor circuit (Bank 1 Sensor 1)', S, 'Check upstream sensor signal and wiring.'],
    P0133: ['O2 sensor slow response (Bank 1 Sensor 1)', W, 'Aged upstream O2 sensor; exhaust leak upstream.'],
    P0135: ['O2 sensor heater circuit (Bank 1 Sensor 1)', W, 'Heater element open - check fuse and resistance.'],
    P0141: ['O2 sensor heater circuit (Bank 1 Sensor 2)', W, 'Downstream heater open - check fuse and resistance.'],
    P0171: ['System too lean (Bank 1)', S, 'Vacuum leak, weak fuel pump, dirty MAF, clogged injectors.'],
    P0172: ['System too rich (Bank 1)', S, 'Leaking injector, high fuel pressure, faulty MAF/O2.'],
    P0174: ['System too lean (Bank 2)', S, 'Lean on both banks points to a common cause (MAF, fuel pressure, intake leak).'],
    P0175: ['System too rich (Bank 2)', S, 'Rich on both banks: fuel pressure regulator, MAF, purge valve.'],
    P0217: ['Engine over-temperature condition', C, 'Stop the engine. Check coolant level, fan operation, thermostat, water pump.'],
    P0218: ['Transmission fluid over-temperature', C, 'Reduce load, check ATF level and cooler.'],
    P0234: ['Turbo/supercharger overboost', C, 'Wastegate or boost control fault - limit load.'],
    P0299: ['Turbo/supercharger underboost', S, 'Boost leak, wastegate, turbo wear.'],
    P0300: ['Random/multiple cylinder misfire detected', C, 'Flashing MIL = catalyst damage risk. Check plugs, coils, fuel, compression.'],
    P0301: ['Cylinder 1 misfire detected', C, 'Swap coil/plug to another cylinder to isolate.'],
    P0302: ['Cylinder 2 misfire detected', C, 'Swap coil/plug to another cylinder to isolate.'],
    P0303: ['Cylinder 3 misfire detected', C, 'Swap coil/plug to another cylinder to isolate.'],
    P0304: ['Cylinder 4 misfire detected', C, 'Swap coil/plug to another cylinder to isolate.'],
    P0325: ['Knock sensor 1 circuit (Bank 1)', S, 'Check sensor torque and wiring.'],
    P0335: ['Crankshaft position sensor A circuit', C, 'May cause stalling / no-start.'],
    P0340: ['Camshaft position sensor A circuit (Bank 1)', S, 'Check sensor, reluctor and wiring.'],
    P0401: ['EGR flow insufficient', W, 'Carbon-blocked EGR passages or valve.'],
    P0420: ['Catalyst efficiency below threshold (Bank 1)', S, 'Compare up/downstream O2 - rule out exhaust leaks and O2 faults first.'],
    P0430: ['Catalyst efficiency below threshold (Bank 2)', S, 'Compare up/downstream O2 - rule out exhaust leaks and O2 faults first.'],
    P0440: ['Evaporative emission system malfunction', W, 'Check fuel cap, purge and vent valves.'],
    P0442: ['EVAP system small leak detected', W, 'Fuel cap seal, cracked hoses - smoke test.'],
    P0455: ['EVAP system large leak detected', W, 'Loose/missing fuel cap, disconnected EVAP hose.'],
    P0456: ['EVAP system very small leak detected', W, 'Smoke test EVAP system.'],
    P0500: ['Vehicle speed sensor malfunction', S, 'Check VSS / ABS wheel-speed inputs.'],
    P0505: ['Idle air control system malfunction', W, 'Clean throttle body / IAC valve.'],
    P0506: ['Idle speed lower than expected', W, 'Dirty throttle body, vacuum leak.'],
    P0507: ['Idle speed higher than expected', W, 'Vacuum leak or IAC fault.'],
    P0562: ['System voltage low', S, 'Test alternator output and battery; check belt and grounds.'],
    P0563: ['System voltage high', S, 'Faulty voltage regulator - risk to electronics.'],
    P0601: ['Internal control module memory checksum error', C, 'ECU fault - may require reprogramming/replacement.'],
    P0700: ['Transmission control system malfunction', S, 'Read the TCM for transmission-specific codes.'],
    P0715: ['Input/turbine speed sensor circuit', S, 'Check transmission speed sensor.'],
    P0741: ['Torque converter clutch circuit performance / stuck off', S, 'Check ATF condition and TCC solenoid.'],
    U0100: ['Lost communication with ECM/PCM', C, 'Check CAN bus wiring, ECU power and grounds.'],
    U0121: ['Lost communication with ABS control module', S, 'Check ABS module power and CAN wiring.'],
  };

  const GROUPS = { P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' };
  const P_SUBSYSTEMS = {
    '0': 'Fuel & air metering / emissions', '1': 'Fuel & air metering', '2': 'Fuel & air metering (injector)',
    '3': 'Ignition / misfire', '4': 'Auxiliary emission controls', '5': 'Vehicle speed / idle control',
    '6': 'Computer & output circuits', '7': 'Transmission', '8': 'Transmission', '9': 'Transmission', 'A': 'Hybrid propulsion',
  };

  function describeDtc(code) {
    const hit = DB[code];
    const group = GROUPS[code[0]] || 'Unknown';
    const manufacturer = code[1] === '1' || code[1] === '3';
    const system = code[0] === 'P' ? (P_SUBSYSTEMS[code[2]] || 'Powertrain') : group;
    if (hit) return { code, description: hit[0], severity: hit[1], hint: hit[2], system, manufacturer };
    return {
      code, system, manufacturer,
      description: manufacturer ? `Manufacturer-specific ${group.toLowerCase()} code` : `${group} code - ${system}`,
      severity: code[0] === 'U' ? S : W,
      hint: manufacturer ? 'Look up in the manufacturer service information.' : 'Consult a code reference for this vehicle.',
    };
  }

  OBD.describeDtc = describeDtc;
})(window.OBD = window.OBD || {});
