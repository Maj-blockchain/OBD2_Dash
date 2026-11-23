/* Multi-language interface. Static labels carry data-i18n="English text"; scripts call OBD.t('English text').
   Trouble-code explanations and alert texts stay in English. */
(function (OBD) {
  'use strict';
  const K = [
    'Language', 'Vehicle', 'Dashboard', 'Live data', 'Full system scan', 'Service resets', 'Smog / MOT check', 'Vehicle & report',
    'Source', 'Scenario', 'Connect', 'Connecting…', 'Disconnect', 'Protocol', 'Adapter', 'Check engine (MIL)', 'Run time', 'Supported PIDs',
    'Mechanic alerts', 'Primary gauges', 'Live trends', 'Export CSV', 'Fuel trims', 'Engine & sensor data', 'Since codes cleared',
    'Diagnostic trouble codes', 'Re-scan', 'Clear codes', 'Stored', 'Pending', 'Permanent', 'Readiness monitors', 'Freeze frame', 'Adapter log',
    'Custom graphs', 'Pause', 'Resume', 'Clear graphs', 'Tick “Graph” next to any sensor below to plot it here (up to 6). Graphed sensors are read every cycle.',
    'All sensors', 'Sensor', 'Value', 'Unit', 'Graph', 'Scan modules', 'Deep scan (find all modules)', 'Clear all codes',
    'AutoVIN & scan: read the VIN and scan all known modules every time you connect', 'Cancel', 'Service history', 'Clear history',
    'Emissions inspection readiness', 'Rules', 'Model year', 'Engine', 'On-board monitor test results (Mode 06)', 'Read test results',
    "Shows the ECU's own pass/fail results for the catalyst, O2 sensors, EVAP, EGR and misfire monitors, with the limits it uses. Available on CAN vehicles.",
    'Vehicle information', 'Diagnostic report', 'Refresh', 'Print / PDF', 'Download',
    'Oil service reset', 'Throttle adaptation', 'Electronic parking brake', 'Battery registration (BMS)', 'TPMS reset', 'DPF regeneration',
    'Preconditions', 'Start', 'Stop', 'Log as done', 'Not connected', 'No codes', 'No response', 'Ready', 'Not ready', 'Will fail',
  ];
  const T = {
    fr: ['Langue', 'Véhicule', 'Tableau de bord', 'Données en direct', 'Diagnostic complet', 'Réinitialisations', 'Contrôle antipollution', 'Véhicule et rapport',
      'Source', 'Scénario', 'Connecter', 'Connexion…', 'Déconnecter', 'Protocole', 'Adaptateur', 'Voyant moteur (MIL)', 'Temps de marche', 'PID pris en charge',
      'Alertes mécanicien', 'Jauges principales', 'Tendances en direct', 'Exporter CSV', 'Correction de richesse', 'Moteur et capteurs', 'Depuis l’effacement des codes',
      'Codes défaut', 'Relire', 'Effacer les codes', 'Mémorisés', 'En attente', 'Permanents', 'Moniteurs de disponibilité', 'Données figées', 'Journal adaptateur',
      'Graphiques personnalisés', 'Pause', 'Reprendre', 'Effacer les graphiques', 'Cochez « Graphique » à côté d’un capteur pour l’afficher ici (6 max.). Les capteurs affichés sont lus à chaque cycle.',
      'Tous les capteurs', 'Capteur', 'Valeur', 'Unité', 'Graphique', 'Analyser les calculateurs', 'Analyse approfondie (tous les calculateurs)', 'Effacer tous les codes',
      'AutoVIN et analyse : lire le VIN et analyser les calculateurs connus à chaque connexion', 'Annuler', 'Historique d’entretien', 'Effacer l’historique',
      'Préparation au contrôle antipollution', 'Règles', 'Année modèle', 'Moteur', 'Résultats des tests embarqués (mode 06)', 'Lire les résultats',
      'Affiche les résultats réussite/échec du calculateur pour le catalyseur, les sondes O2, l’EVAP, l’EGR et les ratés, avec ses limites. Disponible sur les véhicules CAN.',
      'Informations véhicule', 'Rapport de diagnostic', 'Actualiser', 'Imprimer / PDF', 'Télécharger',
      'Remise à zéro vidange', 'Apprentissage papillon', 'Frein de stationnement électrique', 'Enregistrement batterie (BMS)', 'Réinitialisation TPMS', 'Régénération FAP',
      'Conditions préalables', 'Démarrer', 'Arrêter', 'Noter comme fait', 'Non connecté', 'Aucun code', 'Pas de réponse', 'Prêt', 'Pas prêt', 'Échec probable'],
    de: ['Sprache', 'Fahrzeug', 'Übersicht', 'Live-Daten', 'Komplettdiagnose', 'Service-Rückstellungen', 'Abgas- / AU-Check', 'Fahrzeug & Bericht',
      'Quelle', 'Szenario', 'Verbinden', 'Verbinde…', 'Trennen', 'Protokoll', 'Adapter', 'Motorkontrollleuchte (MIL)', 'Laufzeit', 'Unterstützte PIDs',
      'Werkstatt-Hinweise', 'Hauptanzeigen', 'Live-Verläufe', 'CSV exportieren', 'Gemischadaption', 'Motor- & Sensordaten', 'Seit dem Löschen der Codes',
      'Fehlercodes', 'Neu lesen', 'Codes löschen', 'Gespeichert', 'Ausstehend', 'Permanent', 'Bereitschaftstests', 'Freeze Frame', 'Adapter-Protokoll',
      'Eigene Diagramme', 'Pause', 'Fortsetzen', 'Diagramme leeren', 'Hake „Diagramm“ neben einem Sensor an, um ihn hier anzuzeigen (max. 6). Angezeigte Sensoren werden in jedem Zyklus gelesen.',
      'Alle Sensoren', 'Sensor', 'Wert', 'Einheit', 'Diagramm', 'Steuergeräte scannen', 'Tiefenscan (alle Steuergeräte finden)', 'Alle Codes löschen',
      'AutoVIN & Scan: bei jeder Verbindung VIN lesen und alle bekannten Steuergeräte scannen', 'Abbrechen', 'Service-Historie', 'Historie löschen',
      'Bereitschaft für die Abgasuntersuchung', 'Regeln', 'Modelljahr', 'Motor', 'Ergebnisse der On-Board-Tests (Mode 06)', 'Ergebnisse lesen',
      'Zeigt die eigenen Bestanden/Nicht-bestanden-Ergebnisse des Steuergeräts für Katalysator, Lambdasonden, EVAP, AGR und Zündaussetzer samt Grenzwerten. Bei CAN-Fahrzeugen verfügbar.',
      'Fahrzeuginformationen', 'Diagnosebericht', 'Aktualisieren', 'Drucken / PDF', 'Herunterladen',
      'Ölservice zurücksetzen', 'Drosselklappen-Anlernen', 'Elektrische Parkbremse', 'Batterie anlernen (BMS)', 'RDKS zurücksetzen', 'DPF-Regeneration',
      'Voraussetzungen', 'Starten', 'Stoppen', 'Als erledigt eintragen', 'Nicht verbunden', 'Keine Codes', 'Keine Antwort', 'Bereit', 'Nicht bereit', 'Wird durchfallen'],
    es: ['Idioma', 'Vehículo', 'Panel', 'Datos en vivo', 'Diagnóstico completo', 'Reinicios de servicio', 'Control de emisiones / ITV', 'Vehículo e informe',
      'Fuente', 'Escenario', 'Conectar', 'Conectando…', 'Desconectar', 'Protocolo', 'Adaptador', 'Testigo motor (MIL)', 'Tiempo de marcha', 'PID compatibles',
      'Alertas de taller', 'Indicadores principales', 'Tendencias en vivo', 'Exportar CSV', 'Ajustes de combustible', 'Datos de motor y sensores', 'Desde el borrado de códigos',
      'Códigos de avería', 'Volver a leer', 'Borrar códigos', 'Almacenados', 'Pendientes', 'Permanentes', 'Monitores de preparación', 'Cuadro congelado', 'Registro del adaptador',
      'Gráficos personalizados', 'Pausa', 'Reanudar', 'Borrar gráficos', 'Marca «Gráfico» junto a un sensor para trazarlo aquí (máx. 6). Los sensores trazados se leen en cada ciclo.',
      'Todos los sensores', 'Sensor', 'Valor', 'Unidad', 'Gráfico', 'Escanear módulos', 'Escaneo profundo (todos los módulos)', 'Borrar todos los códigos',
      'AutoVIN y escaneo: leer el VIN y escanear los módulos conocidos en cada conexión', 'Cancelar', 'Historial de servicio', 'Borrar historial',
      'Preparación para la inspección de emisiones', 'Normas', 'Año modelo', 'Motor', 'Resultados de pruebas a bordo (modo 06)', 'Leer resultados',
      'Muestra los resultados aprobado/fallo de la propia ECU para catalizador, sondas O2, EVAP, EGR y fallos de encendido, con sus límites. Disponible en vehículos CAN.',
      'Información del vehículo', 'Informe de diagnóstico', 'Actualizar', 'Imprimir / PDF', 'Descargar',
      'Reinicio de aceite', 'Adaptación de la mariposa', 'Freno de estacionamiento eléctrico', 'Registro de batería (BMS)', 'Reinicio TPMS', 'Regeneración del FAP',
      'Condiciones previas', 'Iniciar', 'Detener', 'Registrar como hecho', 'No conectado', 'Sin códigos', 'Sin respuesta', 'Listo', 'No listo', 'Suspenderá'],
    pt: ['Idioma', 'Veículo', 'Painel', 'Dados ao vivo', 'Diagnóstico completo', 'Reinicializações', 'Inspeção de emissões', 'Veículo e relatório',
      'Fonte', 'Cenário', 'Ligar', 'A ligar…', 'Desligar', 'Protocolo', 'Adaptador', 'Luz do motor (MIL)', 'Tempo de funcionamento', 'PIDs suportados',
      'Alertas da oficina', 'Indicadores principais', 'Tendências ao vivo', 'Exportar CSV', 'Correções de combustível', 'Dados do motor e sensores', 'Desde a eliminação dos códigos',
      'Códigos de avaria', 'Ler de novo', 'Apagar códigos', 'Guardados', 'Pendentes', 'Permanentes', 'Monitores de prontidão', 'Freeze frame', 'Registo do adaptador',
      'Gráficos personalizados', 'Pausa', 'Retomar', 'Limpar gráficos', 'Marque «Gráfico» ao lado de um sensor para o mostrar aqui (máx. 6). Os sensores mostrados são lidos em cada ciclo.',
      'Todos os sensores', 'Sensor', 'Valor', 'Unidade', 'Gráfico', 'Analisar módulos', 'Análise profunda (todos os módulos)', 'Apagar todos os códigos',
      'AutoVIN e análise: ler o VIN e analisar os módulos conhecidos em cada ligação', 'Cancelar', 'Histórico de manutenção', 'Limpar histórico',
      'Prontidão para a inspeção de emissões', 'Regras', 'Ano do modelo', 'Motor', 'Resultados dos testes a bordo (modo 06)', 'Ler resultados',
      'Mostra os resultados aprovado/reprovado da própria ECU para catalisador, sondas O2, EVAP, EGR e falhas de ignição, com os limites. Disponível em veículos CAN.',
      'Informação do veículo', 'Relatório de diagnóstico', 'Atualizar', 'Imprimir / PDF', 'Transferir',
      'Reinício do óleo', 'Adaptação da borboleta', 'Travão de estacionamento elétrico', 'Registo da bateria (BMS)', 'Reinício TPMS', 'Regeneração do FAP',
      'Pré-condições', 'Iniciar', 'Parar', 'Registar como feito', 'Não ligado', 'Sem códigos', 'Sem resposta', 'Pronto', 'Não pronto', 'Vai reprovar'],
    it: ['Lingua', 'Veicolo', 'Cruscotto', 'Dati in tempo reale', 'Diagnosi completa', 'Reset di servizio', 'Controllo emissioni / revisione', 'Veicolo e rapporto',
      'Sorgente', 'Scenario', 'Connetti', 'Connessione…', 'Disconnetti', 'Protocollo', 'Adattatore', 'Spia motore (MIL)', 'Tempo di funzionamento', 'PID supportati',
      'Avvisi per l’officina', 'Strumenti principali', 'Andamenti in tempo reale', 'Esporta CSV', 'Correzioni carburante', 'Dati motore e sensori', 'Dalla cancellazione dei codici',
      'Codici di errore', 'Rileggi', 'Cancella codici', 'Memorizzati', 'In attesa', 'Permanenti', 'Monitor di prontezza', 'Freeze frame', 'Registro adattatore',
      'Grafici personalizzati', 'Pausa', 'Riprendi', 'Svuota grafici', 'Spunta «Grafico» accanto a un sensore per tracciarlo qui (max 6). I sensori tracciati vengono letti a ogni ciclo.',
      'Tutti i sensori', 'Sensore', 'Valore', 'Unità', 'Grafico', 'Scansiona centraline', 'Scansione profonda (tutte le centraline)', 'Cancella tutti i codici',
      'AutoVIN e scansione: leggi il VIN e scansiona le centraline note a ogni connessione', 'Annulla', 'Storico interventi', 'Cancella storico',
      'Prontezza per il controllo emissioni', 'Regole', 'Anno modello', 'Motore', 'Risultati dei test di bordo (modo 06)', 'Leggi risultati',
      'Mostra i risultati superato/non superato della centralina per catalizzatore, sonde O2, EVAP, EGR e mancate accensioni, con i limiti usati. Disponibile sui veicoli CAN.',
      'Informazioni veicolo', 'Rapporto diagnostico', 'Aggiorna', 'Stampa / PDF', 'Scarica',
      'Reset tagliando olio', 'Autoapprendimento farfalla', 'Freno di stazionamento elettrico', 'Registrazione batteria (BMS)', 'Reset TPMS', 'Rigenerazione DPF',
      'Prerequisiti', 'Avvia', 'Ferma', 'Registra come fatto', 'Non connesso', 'Nessun codice', 'Nessuna risposta', 'Pronto', 'Non pronto', 'Non supererà'],
  };
  const HTML = {
    sysnote: {
      en: null,
      fr: 'Lit l’ABS, l’airbag (SRS), la boîte de vitesses, la direction, le TPMS, la climatisation, l’habitacle et les autres calculateurs en UDS (ISO 14229) sur CAN. L’analyse approfondie interroge chaque adresse 11 bits une fois (environ une minute en Bluetooth) et mémorise les calculateurs trouvés pour ce VIN. Les adresses et la signification des codes varient selon le constructeur ; les véhicules sans CAN (la plupart avant 2008) n’exposent que le moteur.',
      de: 'Liest ABS, Airbag (SRS), Getriebe, Lenkung, RDKS, Klima, Komfort- und weitere Steuergeräte per UDS (ISO 14229) über CAN. Der Tiefenscan fragt jede 11-Bit-Adresse einmal ab (ca. eine Minute über Bluetooth) und merkt sich die gefundenen Steuergeräte für diese VIN. Adressen und Codebedeutungen sind herstellerabhängig; Fahrzeuge ohne CAN (meist vor 2008) zeigen nur den Motor.',
      es: 'Lee ABS, airbag (SRS), cambio, dirección, TPMS, climatización, carrocería y otros módulos mediante UDS (ISO 14229) sobre CAN. El escaneo profundo sondea cada dirección de 11 bits una vez (aprox. un minuto por Bluetooth) y recuerda los módulos encontrados para este VIN. Las direcciones y el significado de los códigos dependen del fabricante; los vehículos sin CAN (casi todos antes de 2008) solo muestran el motor.',
      pt: 'Lê ABS, airbag (SRS), caixa, direção, TPMS, climatização, carroçaria e outros módulos por UDS (ISO 14229) sobre CAN. A análise profunda testa cada endereço de 11 bits uma vez (cerca de um minuto por Bluetooth) e memoriza os módulos encontrados para este VIN. Os endereços e o significado dos códigos variam com o fabricante; veículos sem CAN (quase todos antes de 2008) só mostram o motor.',
      it: 'Legge ABS, airbag (SRS), cambio, sterzo, TPMS, clima, carrozzeria e altre centraline tramite UDS (ISO 14229) su CAN. La scansione profonda interroga ogni indirizzo a 11 bit una volta (circa un minuto via Bluetooth) e ricorda le centraline trovate per questo VIN. Indirizzi e significato dei codici dipendono dal costruttore; i veicoli senza CAN (quasi tutti prima del 2008) mostrano solo il motore.',
    },
  };

  let lang = localStorage.getItem('obd-lang') || (navigator.language || 'en').slice(0, 2);
  if (!T[lang]) lang = 'en';
  const t = (s) => { if (lang === 'en') return s; const i = K.indexOf(s); return i >= 0 && T[lang][i] ? T[lang][i] : s; };

  function apply(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      if (!el.dataset.en) el.dataset.en = el.innerHTML;
      const h = HTML[el.dataset.i18nHtml]; el.innerHTML = (h && h[lang]) || el.dataset.en;
    });
  }
  function setLang(l) { lang = T[l] ? l : 'en'; localStorage.setItem('obd-lang', lang); apply(); OBD.emitLang && OBD.emitLang(); }

  OBD.t = t;
  OBD.i18n = { apply, setLang, get lang() { return lang; }, keys: K, table: T };
  document.addEventListener('DOMContentLoaded', () => {
    const sel = document.getElementById('lang');
    if (sel) { sel.value = lang; sel.onchange = () => setLang(sel.value); }
    apply();
  });
})(window.OBD = window.OBD || {});
