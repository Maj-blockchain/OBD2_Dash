/* Trouble-code knowledge base: plain-English meaning, urgency, symptoms, ranked causes and
   recommended repair steps. Families (misfire, lean/rich, catalyst, O2 heater) are generated
   from templates. `live` names a live-data check in app.js that helps confirm the fault. */
(function (OBD) {
  'use strict';
  // drive: stop = stop / risk of damage, soon = drive gently & repair soon, ok = safe, fix when convenient
  const DB = {};
  const add = (code, o) => { DB[code] = o; };

  // ---------- Families ----------
  const misfire = (n) => ({
    title: n ? `Cylinder ${n} misfire detected` : 'Random / multiple cylinder misfire detected',
    severity: 'critical', drive: 'stop', diy: n ? 'Easy – moderate' : 'Moderate', live: 'misfire',
    meaning: n
      ? `Cylinder ${n} is not burning its fuel properly. The ECU sees the crankshaft slow down each time that cylinder should fire.`
      : 'Misfires are happening on more than one cylinder or moving between cylinders. This usually points to a cause shared by the whole engine rather than one coil or plug.',
    symptoms: ['Rough or shaking idle', 'Hesitation or jerking under load', 'Flashing check-engine light', 'Smell of fuel from the exhaust'],
    causes: n
      ? ['Worn or fouled spark plug', `Failing ignition coil (or plug lead) on cylinder ${n}`, `Clogged or failed fuel injector on cylinder ${n}`, 'Vacuum leak near that cylinder\'s intake runner', 'Low compression (burnt valve, head gasket, worn rings)']
      : ['Lean condition / vacuum leak (check fuel trims)', 'Low fuel pressure or contaminated fuel', 'Worn spark plugs or weak coils across the engine', 'EGR valve stuck open', 'Cam / crank timing out (stretched chain or jumped belt)'],
    steps: n ? [
      `Swap the ignition coil from cylinder ${n} with a neighbouring cylinder, clear codes and drive. If the misfire follows the coil, replace the coil.`,
      'Remove and inspect the spark plug: check the gap, wear, oil fouling or carbon. Replace plugs as a set if they are due.',
      `If plug and coil are good, test the injector (resistance, noid light or swap test).`,
      'Check for oil in the plug well (valve-cover / tube seal leak) and for vacuum leaks near the intake runner.',
      'If ignition and fuel check out, run a compression or leak-down test.',
    ] : [
      'Check the fuel trims first: a lean engine misfires randomly. Fix any lean condition (vacuum leak, MAF, fuel pressure) before replacing parts.',
      'Read live data or Mode 06 misfire counters to see which cylinders misfire most.',
      'Inspect the spark plugs and coils; replace worn plugs as a set.',
      'Test fuel pressure and check for an EGR valve stuck open.',
      'If misfires persist with good ignition and fuel, verify cam/crank timing and compression.',
    ],
    note: 'If the check-engine light is flashing, stop driving: unburnt fuel overheats and destroys the catalytic converter.',
  });
  for (let n = 1; n <= 8; n++) add('P030' + n, misfire(n));
  add('P0300', misfire(0));

  const lean = (b) => ({
    title: `System too lean (Bank ${b})`, severity: 'serious', drive: 'soon', diy: 'Moderate', live: 'trims', bank: b,
    meaning: `The ECU is having to add a lot more fuel than expected on bank ${b} to keep the air-fuel mixture correct. Either air is getting in without being measured, or not enough fuel is reaching the engine.`,
    symptoms: ['Rough or hunting idle', 'Hesitation when accelerating', 'Reduced power or poor fuel economy', 'Often no obvious symptoms'],
    causes: [
      'Vacuum leak: cracked or disconnected hose, PCV valve or hose, intake gasket, brake-booster hose',
      'Dirty or failing mass air flow (MAF) sensor that under-reads airflow',
      'Weak fuel pump, clogged fuel filter or faulty pressure regulator',
      'Clogged fuel injectors',
      'Exhaust leak before the upstream O2 sensor (pulls in air and fakes a lean reading)',
    ],
    steps: [
      'Compare the fuel trims at idle and at a steady 2,500 rpm (see live data). Lean at idle that improves at 2,500 rpm points to a vacuum leak. Lean that gets worse with load points to fuel delivery or the MAF.',
      'With the engine idling, listen for hissing. Inspect the vacuum hoses, the PCV hose and the intake boot after the MAF for cracks. A smoke test finds leaks fastest.',
      'Clean the MAF sensor with dedicated MAF cleaner (never touch the element) and check the air filter.',
      'Test fuel pressure with a gauge against the manufacturer\'s spec, both key-on and running.',
      'Check for exhaust leaks ahead of the upstream O2 sensor.',
      'After the repair, clear codes and confirm long-term fuel trim settles within ±5%.',
    ],
  });
  const rich = (b) => ({
    title: `System too rich (Bank ${b})`, severity: 'serious', drive: 'soon', diy: 'Moderate', live: 'trims', bank: b,
    meaning: `The ECU is having to remove a lot of fuel on bank ${b}: more fuel is arriving than the measured air needs.`,
    symptoms: ['Smell of fuel or black smoke from the exhaust', 'Poor fuel economy', 'Rough idle, sooty spark plugs'],
    causes: [
      'Leaking or sticking fuel injector',
      'Fuel pressure too high (faulty regulator or blocked return line)',
      'EVAP purge valve stuck open, feeding fuel vapour into the intake',
      'Faulty coolant temperature sensor that reads cold, so the ECU adds fuel',
      'Faulty MAF or upstream O2 sensor; badly blocked air filter',
    ],
    steps: [
      'Check the coolant temperature in live data. It should read 85–105 °C when warm. A cold reading on a warm engine means a faulty ECT sensor.',
      'Pinch or unplug the EVAP purge line at idle. If the trims return to normal, replace the purge valve.',
      'Test fuel pressure and check that it drops when vacuum is applied to the regulator. Check for leak-down after shutting off.',
      'Pull the spark plugs: one wet or sooty plug points to a leaking injector on that cylinder.',
      'Check the air filter and MAF; inspect the O2 sensor for contamination (oil or coolant).',
    ],
  });
  add('P0171', lean(1)); add('P0174', lean(2)); add('P0172', rich(1)); add('P0175', rich(2));

  const cat = (b) => ({
    title: `Catalyst efficiency below threshold (Bank ${b})`, severity: 'serious', drive: 'ok', diy: 'Moderate – advanced', live: 'cat',
    meaning: `The downstream O2 sensor on bank ${b} is switching almost like the upstream one. That means the catalytic converter is no longer storing oxygen and cleaning the exhaust properly.`,
    symptoms: ['Usually none', 'Failed emissions test', 'Rotten-egg smell or rattling from the converter in some cases'],
    causes: [
      'Worn or poisoned catalytic converter (age, oil burning, coolant leak, past misfires)',
      'Exhaust leak near the downstream O2 sensor',
      'Faulty downstream (or upstream) O2 sensor',
      'Engine running rich or lean, or misfiring. These damage the converter and can mimic this code.',
    ],
    steps: [
      'Fix any misfire, fuel-trim or O2 sensor codes first. They cause this code, and a new converter will fail again if they remain.',
      'Compare the O2 sensor graphs. A healthy downstream sensor holds fairly steady around 0.6–0.7 V. If it mirrors the upstream sensor, the converter is worn.',
      'Inspect the exhaust for leaks (soot marks, ticking noise) between the engine and the downstream sensor.',
      'After a full warm-up, the converter outlet should be hotter than the inlet; check with an infrared thermometer.',
      'Replace with a quality OEM-grade converter. Cheap universal converters often bring the code back.',
    ],
  });
  add('P0420', cat(1)); add('P0430', cat(2));

  const heater = (b, s) => ({
    title: `O2 sensor heater circuit (Bank ${b} Sensor ${s})`, severity: 'warning', drive: 'ok', diy: 'Easy',
    meaning: `The heater inside the ${s === 1 ? 'upstream' : 'downstream'} oxygen sensor is not drawing the expected current. Without it, the sensor is slow to warm up and emissions rise after a cold start.`,
    symptoms: ['Usually none', 'Slightly higher fuel consumption after cold start', 'Readiness monitor "O2 heater" incomplete'],
    causes: ['Open circuit in the sensor\'s heater element (most common)', 'Blown fuse for the O2 heater circuit', 'Wiring melted or chafed near the exhaust', 'Corroded connector'],
    steps: ['Check the O2 heater fuse.', 'Unplug the sensor and measure heater resistance (usually a few ohms; check the spec). Open circuit means replace the sensor.', 'Check for 12 V supply on the heater feed with the key on.', 'Inspect the wiring along the exhaust for heat damage.', 'Replace the sensor with the correct type; apply anti-seize to the threads only.'],
  });
  add('P0135', heater(1, 1)); add('P0141', heater(1, 2)); add('P0155', heater(2, 1)); add('P0161', heater(2, 2));

  // ---------- Individual codes ----------
  add('P0010', { title: 'Camshaft position actuator circuit (Bank 1)', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The ECU detected an electrical fault in the variable valve timing (VVT) solenoid circuit.',
    symptoms: ['Rough idle', 'Reduced power', 'Poor fuel economy'],
    causes: ['Faulty VVT (oil control) solenoid', 'Damaged wiring or connector', 'ECU driver fault (rare)'],
    steps: ['Inspect the solenoid connector and wiring.', 'Measure solenoid resistance against spec (often 6–12 Ω).', 'Apply 12 V briefly to check the solenoid clicks.', 'Replace the solenoid if out of spec.'] });
  add('P0011', { title: 'Camshaft timing over-advanced (Bank 1)', severity: 'serious', drive: 'soon', diy: 'Moderate – advanced',
    meaning: 'The intake camshaft is more advanced than the ECU is commanding.',
    symptoms: ['Rough idle or stalling', 'Rattle on start-up', 'Reduced power'],
    causes: ['Low, old or wrong-grade engine oil', 'Sticking VVT solenoid or blocked solenoid screen', 'Worn VVT phaser', 'Stretched timing chain'],
    steps: ['Check the oil level and condition; change it with the correct grade if in doubt. This fixes many cases.', 'Remove and clean the VVT solenoid and its screen.', 'Compare actual vs desired cam angle with a scan tool.', 'If it returns, inspect the timing chain, guides and phaser.'] });
  add('P0014', { title: 'Exhaust camshaft timing over-advanced (Bank 1)', severity: 'serious', drive: 'soon', diy: 'Moderate – advanced',
    meaning: 'The exhaust camshaft position is not following the ECU\'s command.',
    symptoms: ['Rough idle', 'Hard starting', 'Reduced power'],
    causes: ['Low or dirty oil', 'Sticking exhaust VVT solenoid', 'Worn phaser or stretched timing chain'],
    steps: ['Check the oil level and grade; change the oil.', 'Clean or replace the exhaust VVT solenoid.', 'Inspect the timing chain if the code returns.'] });
  add('P0016', { title: 'Crankshaft / camshaft position correlation (Bank 1)', severity: 'critical', drive: 'stop', diy: 'Advanced',
    meaning: 'The crankshaft and camshaft signals are out of their normal relationship, so the timing may have jumped.',
    symptoms: ['Hard starting', 'Rattling from the timing cover', 'Misfires, low power'],
    causes: ['Stretched timing chain or jumped belt', 'Failed chain tensioner or guides', 'Faulty cam or crank sensor', 'Faulty VVT phaser'],
    steps: ['Stop driving if there is rattling: a jumped chain can bend valves (interference engines).', 'Check the cam and crank sensor wiring and signals.', 'Verify the mechanical timing marks.', 'Replace the timing chain kit (chain, tensioner, guides) if stretched.'],
    note: 'Do not keep driving with this code until the timing is verified.' });
  add('P0087', { title: 'Fuel rail / system pressure too low', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'Fuel pressure is below what the ECU expects.',
    symptoms: ['Hesitation, loss of power under load', 'Long cranking', 'Stalling'],
    causes: ['Weak fuel pump', 'Clogged fuel filter', 'Faulty pressure regulator or sensor', 'High-pressure pump wear (direct injection)'],
    steps: ['Measure fuel pressure with a gauge or scan tool against spec.', 'Replace the fuel filter if serviceable.', 'Check pump supply voltage and ground.', 'Replace the pump or regulator as indicated.'] });
  add('P0101', { title: 'Mass air flow (MAF) sensor range / performance', severity: 'serious', drive: 'soon', diy: 'Easy', live: 'maf',
    meaning: 'The MAF reading does not agree with what the ECU expects from engine speed, throttle and manifold pressure.',
    symptoms: ['Hesitation or stalling', 'Poor fuel economy', 'Often accompanied by lean codes'],
    causes: ['Dirty MAF element (oil from aftermarket air filters, dust)', 'Air leak between the MAF and the throttle body', 'Clogged air filter', 'Failing MAF sensor'],
    steps: ['Inspect the intake boot after the MAF for cracks or loose clamps.', 'Clean the MAF with dedicated MAF cleaner and let it dry.', 'Replace the air filter if dirty.', 'Compare MAF g/s at idle: roughly 1–1.5 g/s per litre of engine size when warm.', 'Replace the MAF if readings stay wrong.'] });
  add('P0102', { title: 'Mass air flow (MAF) circuit low', severity: 'serious', drive: 'soon', diy: 'Easy', live: 'maf',
    meaning: 'The MAF signal voltage is below the expected range: an electrical fault rather than a dirty sensor.',
    symptoms: ['Stalling or very poor running', 'Limp mode in some cars'],
    causes: ['Unplugged or corroded MAF connector', 'Broken signal, power or ground wire', 'Failed MAF sensor'],
    steps: ['Check that the connector is fully seated and not corroded.', 'Check the MAF supply voltage and ground with a multimeter.', 'Back-probe the signal wire at idle and compare with the spec.', 'Replace the sensor if supply and ground are good.'] });
  add('P0113', { title: 'Intake air temperature sensor circuit high', severity: 'warning', drive: 'ok', diy: 'Easy',
    meaning: 'The IAT sensor reports an implausibly cold value, usually an open circuit.',
    symptoms: ['Usually none', 'Slight change in fuel economy'],
    causes: ['Unplugged connector', 'Broken wire', 'Failed IAT sensor (often built into the MAF)'],
    steps: ['Check the IAT reading in live data: about −40 °C means an open circuit.', 'Inspect the connector and wiring.', 'Replace the sensor (or the MAF assembly if integrated).'] });
  add('P0117', { title: 'Engine coolant temperature sensor circuit low', severity: 'serious', drive: 'soon', diy: 'Easy', live: 'coolant',
    meaning: 'The coolant temperature sensor reports an impossibly hot value (short circuit).',
    symptoms: ['Radiator fans run constantly', 'Rich running, hard starting'],
    causes: ['Shorted ECT sensor', 'Wiring shorted to ground'],
    steps: ['Compare the live coolant reading with the actual engine temperature.', 'Unplug the sensor: the reading should jump to very cold.', 'Replace the sensor; bleed the cooling system after.'] });
  add('P0118', { title: 'Engine coolant temperature sensor circuit high', severity: 'serious', drive: 'soon', diy: 'Easy', live: 'coolant',
    meaning: 'The coolant temperature sensor reports an impossibly cold value (open circuit).',
    symptoms: ['Fans run constantly', 'Temperature gauge reads cold', 'Rich running, poor economy'],
    causes: ['Unplugged or corroded connector', 'Broken wire', 'Failed ECT sensor'],
    steps: ['Check the live coolant reading: about −40 °C means an open circuit.', 'Inspect the connector and wiring.', 'Replace the sensor and top up the coolant.'] });
  add('P0121', { title: 'Throttle position sensor range / performance', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The throttle position signal does not match what the ECU expects for the airflow.',
    symptoms: ['Hesitation, surging', 'Erratic idle', 'Limp mode on drive-by-wire cars'],
    causes: ['Worn TPS track', 'Dirty throttle body', 'Wiring or connector fault'],
    steps: ['Clean the throttle body.', 'Watch the throttle % in live data while slowly pressing the pedal (key on, engine off). It should rise smoothly with no drop-outs.', 'Check the connector; replace the TPS or throttle body if the signal is erratic.', 'Run a throttle relearn if your car requires one.'] });
  add('P0128', { title: 'Coolant temperature below thermostat regulating temperature', severity: 'warning', drive: 'ok', diy: 'Easy – moderate', live: 'warmup',
    meaning: 'The engine is taking too long to reach its normal operating temperature.',
    symptoms: ['Temperature gauge reads low', 'Weak cabin heater', 'Higher fuel consumption'],
    causes: ['Thermostat stuck open (most common)', 'Faulty coolant temperature sensor', 'Radiator fan running constantly', 'Low coolant level'],
    steps: ['Watch the coolant temperature from a cold start: it should reach about 85–95 °C within 10–15 minutes of driving.', 'If it climbs slowly or drops on the highway, replace the thermostat.', 'Check that the fans are not running on a cold engine.', 'Check the coolant level.'] });
  add('P0130', { title: 'O2 sensor circuit (Bank 1 Sensor 1)', severity: 'serious', drive: 'soon', diy: 'Easy', live: 'o2',
    meaning: 'The upstream oxygen sensor signal is out of range or not responding.',
    symptoms: ['Poor fuel economy', 'Rough running', 'Failed emissions test'],
    causes: ['Failed O2 sensor', 'Damaged wiring near the exhaust', 'Exhaust leak near the sensor'],
    steps: ['Watch the upstream O2 voltage. When warm, it should switch quickly between about 0.1 and 0.9 V.', 'Inspect the wiring and connector.', 'Check for exhaust leaks.', 'Replace the sensor if it is flat or slow.'] });
  add('P0133', { title: 'O2 sensor slow response (Bank 1 Sensor 1)', severity: 'warning', drive: 'ok', diy: 'Easy', live: 'o2',
    meaning: 'The upstream oxygen sensor is switching too slowly, which is typical of an ageing sensor.',
    symptoms: ['Slightly worse fuel economy', 'Usually no driveability issues'],
    causes: ['Aged or contaminated O2 sensor', 'Exhaust leak upstream', 'Engine burning oil or coolant'],
    steps: ['Check that the sensor switches at least several times per 10 seconds when warm at 2,500 rpm.', 'Check for exhaust leaks.', 'Replace the sensor; if a new one fails quickly, look for oil or coolant consumption.'] });
  add('P0217', { title: 'Engine over-temperature condition', severity: 'critical', drive: 'stop', diy: 'Moderate', live: 'coolant',
    meaning: 'The engine has overheated beyond its safe limit.',
    symptoms: ['Temperature gauge in the red', 'Steam, coolant smell', 'Loss of power (protection mode)'],
    causes: ['Low coolant or a leak', 'Radiator fan not working (fan, relay, fuse)', 'Thermostat stuck closed', 'Failed water pump', 'Blocked radiator; possible head gasket failure'],
    steps: ['Stop and switch off. Do not open the radiator cap when hot.', 'When cool, check the coolant level and look for leaks.', 'Start the engine and confirm the fan switches on at about 95–105 °C. Test the fan, relay and fuse if it does not.', 'Check the upper and lower radiator hoses both get hot (thermostat opening) and that the coolant circulates.', 'If coolant is lost with no visible leak, pressure-test it and check for combustion gases (head gasket).'],
    note: 'Driving an overheating engine can warp the cylinder head in minutes.' });
  add('P0218', { title: 'Transmission fluid over-temperature', severity: 'critical', drive: 'stop', diy: 'Moderate',
    meaning: 'The automatic transmission fluid is too hot.',
    symptoms: ['Harsh or slipping shifts', 'Burning smell'],
    causes: ['Low or degraded fluid', 'Blocked transmission cooler', 'Towing or heavy load', 'Slipping clutches or torque converter'],
    steps: ['Pull over and let it cool.', 'Check the fluid level and condition (burnt smell, dark colour).', 'Inspect the cooler lines and radiator for blockage.', 'Service the fluid; investigate slipping if it returns.'] });
  add('P0234', { title: 'Turbo / supercharger overboost', severity: 'critical', drive: 'stop', diy: 'Moderate – advanced',
    meaning: 'Boost pressure exceeded the safe limit.',
    symptoms: ['Sudden power cut (limp mode)', 'Surging'],
    causes: ['Wastegate stuck closed', 'Faulty boost control solenoid', 'Leaking or cracked wastegate vacuum line', 'Faulty boost sensor'],
    steps: ['Avoid full throttle until it is fixed.', 'Check the wastegate actuator moves freely.', 'Inspect the boost control solenoid and hoses.', 'Compare the boost sensor reading with a gauge.'] });
  add('P0299', { title: 'Turbo / supercharger underboost', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The engine is not reaching the boost pressure the ECU requests.',
    symptoms: ['Low power', 'Whistling or hissing under load'],
    causes: ['Boost leak (split intercooler hose, loose clamp)', 'Wastegate stuck open', 'Faulty boost control solenoid', 'Worn turbo'],
    steps: ['Inspect all intercooler pipes and clamps; a pressure/smoke test finds leaks.', 'Check the wastegate and its actuator.', 'Test the boost control solenoid.', 'Check turbo shaft play and for oil in the intake.'] });
  add('P0325', { title: 'Knock sensor 1 circuit (Bank 1)', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The knock sensor signal is missing or out of range, so the ECU retards ignition timing as a precaution.',
    symptoms: ['Reduced power and economy', 'Possible audible pinging'],
    causes: ['Damaged wiring or connector', 'Failed knock sensor', 'Incorrect sensor torque'],
    steps: ['Inspect the wiring (often under the intake manifold).', 'Measure the sensor resistance / signal.', 'Replace it and tighten to the specified torque.'] });
  add('P0335', { title: 'Crankshaft position sensor A circuit', severity: 'critical', drive: 'stop', diy: 'Moderate',
    meaning: 'The ECU is not getting a valid crankshaft position signal.',
    symptoms: ['Cranks but will not start', 'Stalls when warm', 'Tachometer drops to zero'],
    causes: ['Failed crank sensor', 'Damaged wiring or connector', 'Damaged reluctor ring'],
    steps: ['Watch RPM while cranking: 0 rpm means no signal.', 'Inspect the sensor and connector for oil or damage.', 'Test the sensor output (AC voltage or Hall signal).', 'Replace the sensor.'],
    note: 'The engine may stall without warning.' });
  add('P0340', { title: 'Camshaft position sensor A circuit (Bank 1)', severity: 'serious', drive: 'soon', diy: 'Easy – moderate',
    meaning: 'The camshaft position signal is missing or invalid.',
    symptoms: ['Long cranking', 'Stalling', 'Rough running'],
    causes: ['Failed cam sensor', 'Wiring fault', 'Timing chain/belt issue'],
    steps: ['Inspect the sensor and connector.', 'Check the supply and signal with a multimeter or scope.', 'Replace the sensor; verify the timing if the code returns.'] });
  add('P0401', { title: 'EGR flow insufficient', severity: 'warning', drive: 'ok', diy: 'Moderate',
    meaning: 'The ECU commanded exhaust gas recirculation but did not see the expected effect.',
    symptoms: ['Pinging under load', 'Higher NOx emissions'],
    causes: ['Carbon-blocked EGR passages', 'Sticking EGR valve', 'Faulty EGR vacuum solenoid or hose', 'Faulty DPFE / position sensor'],
    steps: ['Remove the EGR valve and clean the carbon from the valve and passages.', 'Check the vacuum supply and hoses.', 'Test the EGR position or DPFE sensor.', 'Replace the valve if it sticks.'] });
  add('P0440', { title: 'EVAP system malfunction', severity: 'warning', drive: 'ok', diy: 'Easy', live: 'evap',
    meaning: 'The fuel vapour recovery system failed its self-test.',
    symptoms: ['Fuel smell', 'Usually none'],
    causes: ['Loose or worn fuel cap', 'Faulty purge or vent valve', 'Cracked EVAP hoses or charcoal canister'],
    steps: ['Tighten the fuel cap until it clicks; replace it if the seal is cracked.', 'Inspect the EVAP hoses and canister.', 'Test the purge and vent valves.', 'Smoke-test the system.'] });
  add('P0442', { title: 'EVAP system small leak detected', severity: 'warning', drive: 'ok', diy: 'Easy', live: 'evap',
    meaning: 'A small leak (around 1 mm) was found in the fuel vapour system.',
    symptoms: ['Faint fuel smell', 'Usually none'],
    causes: ['Fuel cap seal', 'Cracked hose', 'Leaking purge/vent valve', 'Filler neck corrosion'],
    steps: ['Replace the fuel cap (cheap and the most common fix).', 'Smoke-test the EVAP system.', 'Inspect the hoses near the tank and canister.'] });
  add('P0455', { title: 'EVAP system large leak detected', severity: 'warning', drive: 'ok', diy: 'Easy', live: 'evap',
    meaning: 'A large leak, or no seal at all, was found in the fuel vapour system.',
    symptoms: ['Fuel smell', 'Usually none'],
    causes: ['Fuel cap missing or loose', 'Disconnected EVAP hose', 'Vent valve stuck open', 'Cracked canister'],
    steps: ['Check that the fuel cap is present and tight.', 'Look for disconnected hoses at the purge valve and canister.', 'Test that the vent valve closes.', 'Smoke-test the system.'] });
  add('P0456', { title: 'EVAP system very small leak detected', severity: 'warning', drive: 'ok', diy: 'Easy', live: 'evap',
    meaning: 'A very small leak (around 0.5 mm) was found in the fuel vapour system.',
    symptoms: ['Usually none'],
    causes: ['Fuel cap seal', 'Tiny crack in a hose or canister', 'Purge/vent valve seal'],
    steps: ['Replace the fuel cap.', 'Smoke-test the system; very small leaks are hard to see without one.', 'Check the purge and vent valve seals.'] });
  add('P0500', { title: 'Vehicle speed sensor malfunction', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The vehicle speed signal is missing or implausible.',
    symptoms: ['Speedometer not working', 'Erratic shifting (automatic)', 'ABS / traction warning lights'],
    causes: ['Failed speed sensor', 'Damaged wiring', 'ABS wheel-speed sensor fault (on cars that use ABS for speed)'],
    steps: ['Compare the live vehicle speed with the actual speed.', 'Check the ABS module for wheel-speed codes.', 'Inspect the sensor and wiring; replace the sensor.'] });
  add('P0505', { title: 'Idle air control system malfunction', severity: 'warning', drive: 'ok', diy: 'Easy',
    meaning: 'The ECU cannot hold the target idle speed.',
    symptoms: ['High, low or hunting idle', 'Stalling when stopping'],
    causes: ['Dirty throttle body or IAC valve', 'Vacuum leak', 'Failed IAC motor'],
    steps: ['Clean the throttle body and IAC passages.', 'Check for vacuum leaks.', 'Do an idle relearn; replace the IAC valve if it is still faulty.'] });
  add('P0506', { title: 'Idle speed lower than expected', severity: 'warning', drive: 'ok', diy: 'Easy',
    meaning: 'The idle speed is below the ECU\'s target.',
    symptoms: ['Low, rough idle', 'Stalling with A/C on'],
    causes: ['Dirty throttle body', 'Clogged PCV', 'Weak IAC valve'],
    steps: ['Clean the throttle body.', 'Check the PCV valve.', 'Run an idle relearn procedure.'] });
  add('P0507', { title: 'Idle speed higher than expected', severity: 'warning', drive: 'ok', diy: 'Easy',
    meaning: 'The idle speed is above the ECU\'s target.',
    symptoms: ['High idle', 'Car creeps strongly in gear'],
    causes: ['Vacuum leak', 'Sticking IAC valve', 'Dirty or sticking throttle plate'],
    steps: ['Check for vacuum leaks.', 'Clean the throttle body and IAC.', 'Run an idle relearn procedure.'] });
  add('P0562', { title: 'System voltage low', severity: 'serious', drive: 'soon', diy: 'Easy – moderate', live: 'voltage',
    meaning: 'The ECU supply voltage dropped below its normal range. The charging system is not keeping up.',
    symptoms: ['Battery or charge warning light', 'Dim lights, slow cranking', 'Random electrical faults and other codes'],
    causes: ['Failing alternator or voltage regulator', 'Loose or worn drive belt', 'Corroded battery terminals or engine-earth strap', 'Weak battery'],
    steps: ['With the engine running, measure the voltage at the battery: expect about 13.5–14.7 V.', 'Check the drive belt tension and condition.', 'Clean and tighten the battery terminals and earth straps.', 'Load-test the battery and alternator; replace the failing part.'],
    note: 'Low voltage can set misleading codes in other modules. Fix the charging problem first.' });
  add('P0563', { title: 'System voltage high', severity: 'serious', drive: 'soon', diy: 'Moderate', live: 'voltage',
    meaning: 'The ECU supply voltage is above its normal range: usually overcharging.',
    symptoms: ['Bulbs failing early', 'Battery smelling or swelling', 'Electrical glitches'],
    causes: ['Faulty alternator voltage regulator', 'Poor sense-wire or earth connection'],
    steps: ['Measure the battery voltage at 2,000 rpm: above about 15 V means overcharging.', 'Check the alternator earth and sense wire.', 'Replace the regulator or alternator.'],
    note: 'Prolonged overcharging damages the battery and electronics.' });
  add('P0601', { title: 'Control module memory checksum error', severity: 'critical', drive: 'soon', diy: 'Advanced',
    meaning: 'The engine computer found corrupted data in its own memory.',
    symptoms: ['Stalling, no-start or limp mode'],
    causes: ['Corrupted ECU software (failed update, voltage spike)', 'Internal ECU failure'],
    steps: ['Check the battery and charging voltage first.', 'Have the ECU reflashed with the latest software (dealer or specialist).', 'Replace and program the ECU if reflashing fails.'] });
  add('P0700', { title: 'Transmission control system malfunction', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The transmission computer has stored its own fault and is asking the engine ECU to light the check-engine lamp.',
    symptoms: ['Harsh shifting', 'Stuck in one gear (limp mode)'],
    causes: ['Any transmission fault; the details are stored in the transmission module'],
    steps: ['Read the transmission module (TCM) codes with a scan tool that supports it; generic OBD2 only shows this summary code.', 'Check the fluid level and condition.', 'Diagnose according to the TCM codes.'] });
  add('P0715', { title: 'Input / turbine speed sensor circuit', severity: 'serious', drive: 'soon', diy: 'Moderate',
    meaning: 'The transmission input-speed signal is missing or invalid.',
    symptoms: ['Harsh or erratic shifts', 'Speedometer issues', 'Limp mode'],
    causes: ['Failed speed sensor', 'Wiring or connector fault', 'Low fluid'],
    steps: ['Check the fluid level.', 'Inspect the sensor connector.', 'Test the sensor output and replace it if faulty.'] });
  add('P0741', { title: 'Torque converter clutch stuck off', severity: 'serious', drive: 'soon', diy: 'Advanced',
    meaning: 'The torque converter lock-up clutch is not engaging when commanded.',
    symptoms: ['Higher rpm at cruise', 'Worse fuel economy', 'Transmission running hot'],
    causes: ['Worn or degraded fluid', 'Faulty TCC solenoid', 'Worn torque converter clutch'],
    steps: ['Check the fluid level and condition; service it.', 'Test the TCC solenoid.', 'Have the torque converter inspected if the code persists.'] });
  add('U0100', { title: 'Lost communication with ECM / PCM', severity: 'critical', drive: 'stop', diy: 'Advanced',
    meaning: 'Another module stopped hearing from the engine computer on the CAN network.',
    symptoms: ['No-start or stalling', 'Many warning lights', 'Gauges dropping out'],
    causes: ['ECU power or ground fault (blown fuse, bad earth)', 'Damaged CAN bus wiring', 'Low battery voltage', 'Failed ECU'],
    steps: ['Check the battery voltage and ECU fuses.', 'Check the ECU earth connections.', 'Measure the CAN bus resistance at the OBD port (about 60 Ω between pins 6 and 14).', 'Inspect the wiring for water or rodent damage.'] });
  add('U0121', { title: 'Lost communication with ABS module', severity: 'serious', drive: 'soon', diy: 'Moderate – advanced',
    meaning: 'The ABS module is not responding on the network.',
    symptoms: ['ABS and traction warning lights', 'Speedometer may fail'],
    causes: ['ABS module fuse or power fault', 'Corroded ABS connector', 'CAN wiring damage', 'Failed ABS module'],
    steps: ['Check the ABS fuses and relays.', 'Inspect the ABS module connector for corrosion.', 'Check the CAN wiring to the module.', 'Repair or replace the module (often a rebuild service exists).'],
    note: 'ABS may be disabled: normal brakes still work, but drive carefully.' });

  // ---------- Fallbacks for codes not in the list ----------
  const GROUPS = { P: 'Powertrain', C: 'Chassis', B: 'Body', U: 'Network' };
  const P_SUBSYSTEMS = {
    '0': 'Fuel & air metering / emissions', '1': 'Fuel & air metering', '2': 'Fuel & air metering (injectors)',
    '3': 'Ignition / misfire', '4': 'Auxiliary emission controls', '5': 'Vehicle speed / idle control',
    '6': 'Computer & output circuits', '7': 'Transmission', '8': 'Transmission', '9': 'Transmission', 'A': 'Hybrid propulsion',
  };
  const GENERIC_STEPS = {
    'Fuel & air metering': ['Check the fuel trims and the sensor readings in live data.', 'Inspect the related sensor\'s connector and wiring.', 'Check for vacuum or intake leaks.'],
    'Ignition / misfire': ['Inspect the spark plugs and coils.', 'Check for misfire counts per cylinder.', 'Inspect the ignition wiring.'],
    'Auxiliary emission controls': ['Check the EVAP, EGR and catalyst related hoses and valves.', 'Fix any fuel or misfire codes first.'],
    'Transmission': ['Check the transmission fluid level and condition.', 'Read the transmission module with a capable scan tool.'],
    Network: ['Check the battery voltage and module fuses.', 'Inspect the CAN wiring and connectors.', 'Read every module to see which one is not communicating.'],
  };

  function describeDtc(code) {
    const group = GROUPS[code[0]] || 'Unknown';
    const manufacturer = code[1] === '1' || code[1] === '3';
    const system = code[0] === 'P' ? (P_SUBSYSTEMS[code[2]] || 'Powertrain') : group;
    const hit = !manufacturer && DB[code];
    if (hit) return { code, system, manufacturer, known: true, ...hit };
    const key = Object.keys(GENERIC_STEPS).find((k) => system.startsWith(k) || system === k);
    return {
      code, system, manufacturer, known: false,
      title: manufacturer ? `Manufacturer-specific ${group.toLowerCase()} code` : `${group} code: ${system.toLowerCase()}`,
      severity: code[0] === 'U' ? 'serious' : 'warning', drive: 'soon', diy: 'Varies',
      meaning: manufacturer
        ? 'This code is defined by the vehicle manufacturer, so its exact meaning depends on the make and model.'
        : 'This code is not in the built-in library yet.',
      symptoms: [],
      causes: [],
      steps: [
        'Note the freeze-frame data and whether the code is stored or pending.',
        ...(GENERIC_STEPS[key] || ['Inspect the wiring and connectors for the related system.']),
        'Look the code up for your exact make, model and year. Manufacturer service bulletins (TSBs) often name a known fix.',
      ],
    };
  }

  /** Cross-code reasoning: which code to tackle first and why. Returns [{level, text}]. */
  function relatedInsights(codes) {
    const has = (c) => codes.includes(c);
    const any = (re) => codes.some((c) => re.test(c));
    const out = [];
    if (has('P0217')) out.push({ level: 'critical', text: '<b>P0217 overheating comes first.</b> Stop driving and fix the cooling system before anything else; overheating can damage the engine and cause other codes.' });
    if (has('P0016') || has('P0335')) out.push({ level: 'critical', text: '<b>Timing / crank signal fault.</b> Verify timing and crank sensor before chasing misfire or fuel codes: they often follow from it.' });
    if (has('P0562') || has('P0563')) out.push({ level: 'serious', text: '<b>Fix the charging voltage first.</b> Abnormal voltage makes sensors and modules misbehave and can set misleading codes.' });
    if (has('P0171') && has('P0174')) out.push({ level: 'serious', text: '<b>Both banks lean (P0171 + P0174):</b> look for a cause shared by the whole engine: a large vacuum leak, the MAF sensor or low fuel pressure. Single-bank parts such as one injector or O2 sensor are unlikely.' });
    else if (has('P0171') || has('P0174')) out.push({ level: 'warning', text: `<b>Lean on one bank only:</b> on a V-engine, suspect something on that bank (intake gasket, injector, exhaust leak before the O2 sensor). On a 4- or inline-6-cylinder engine, Bank 1 is the whole engine, so treat it as a general lean condition.` });
    if (has('P0172') && has('P0175')) out.push({ level: 'serious', text: '<b>Both banks rich:</b> check fuel pressure, the EVAP purge valve and the coolant temperature sensor: shared causes.' });
    if (any(/^P030\d$/) && any(/^P017[14]$/)) out.push({ level: 'serious', text: '<b>Misfire + lean:</b> the lean condition may be causing the misfire. Fix the lean condition first, then re-check.' });
    if (has('P0300') && any(/^P030[1-8]$/)) out.push({ level: 'warning', text: '<b>Random + specific cylinder misfire:</b> start with the cylinder named in the specific code.' });
    if (any(/^P04[23]0$/) && (any(/^P030\d$/) || any(/^P01(3|4|5|6)\d$/) || any(/^P017[1245]$/))) out.push({ level: 'warning', text: '<b>Fix the other codes before replacing the catalytic converter.</b> Misfires, fuel-trim and O2 sensor faults can trigger catalyst codes and will damage a new converter.' });
    if (any(/^P044\d|P045\d$/)) out.push({ level: 'good', text: '<b>EVAP codes:</b> check the fuel cap first. It is the cheapest and most common fix.' });
    return out;
  }

  /** Suggested repair order: urgency first, then root causes before the codes they trigger. */
  function repairOrder(codes) {
    const has = (re) => codes.some((c) => re.test(c));
    const misfire = has(/^P030\d$/), others = codes.some((c) => !/^P04[23]0$/.test(c));
    const rank = { stop: 0, soon: 10, ok: 20 }, sev = { critical: 0, serious: 1, warning: 2 };
    return codes.map(describeDtc).map((d) => {
      let score = rank[d.drive] + sev[d.severity], root = false;
      if (/^(P0217|P0016|P0335)$/.test(d.code)) { score -= 30; root = true; }
      else if (/^P056[23]$/.test(d.code)) { score -= 25; root = true; }
      else if (/^P017[1245]$/.test(d.code) && misfire) { score -= 12; root = true; } // lean/rich can cause the misfire
      else if (/^P04[23]0$/.test(d.code) && others) score += 30;                    // catalyst last
      return { ...d, score, root };
    }).sort((a, b) => a.score - b.score);
  }

  OBD.repairOrder = repairOrder;
  OBD.describeDtc = describeDtc;
  OBD.relatedInsights = relatedInsights;
  OBD.DRIVE_ADVICE = {
    stop: { level: 'critical', label: 'Stop driving soon', text: 'Risk of engine or component damage. Repair before further driving.' },
    soon: { level: 'serious', label: 'Repair soon', text: 'Safe for short, gentle trips; book a repair.' },
    ok:   { level: 'good', label: 'Safe to drive', text: 'No immediate risk. Fix at your next service or before an inspection.' },
  };
})(window.OBD = window.OBD || {});
