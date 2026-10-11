// ============================================================
// APEXSHIFT PRO - MOTORSPORT CLIENT APPLICATION
// ============================================================

// Reifenmischungen mit groben Richtwerten für das Betriebsfenster (°C).
// WICHTIG: Forza sendet die Mischung NICHT per Telemetrie -> wird manuell gewählt.
const TYRES = {
  street:      { name: 'Straße',     min: 70, max: 95 },
  sport:       { name: 'Sport',      min: 75, max: 100 },
  'semi-slick':{ name: 'Semi-Slick', min: 80, max: 105 },
  slick:       { name: 'Slick',      min: 85, max: 110 },
  rally:       { name: 'Rally',      min: 60, max: 90 },
  offroad:     { name: 'Offroad',    min: 50, max: 85 },
  snow:        { name: 'Schnee',     min: 40, max: 70 },
  drift:       { name: 'Drift',      min: 80, max: 110 },
  drag:        { name: 'Drag',       min: 70, max: 100 }
};

// Profile: Dashboard-LEDs (pattern, startRpm ...) UND echte Lenkrad-LEDs (wheel*)
const PROFILES = {
  f1: {
    name: 'Formula 1 (links → rechts)',
    pattern: 'f1',
    startRpm: 60, warnRpm: 78, shiftPoint: 92,
    blinkFreq: 16, blinkStyle: 'all',
    audioEnabled: true, audioFreq: 2400, audioDuration: 60, audioVol: 80,
    ledBloom: 1.3,
    wheelFill: 'left-right', wheelStartRpm: 60, wheelShift: 92, wheelBlinkHz: 16,
    tyre: 'slick'
  },
  porsche: {
    name: 'Porsche GT3 (außen → innen)',
    pattern: 'outside-in',
    startRpm: 55, warnRpm: 75, shiftPoint: 89,
    blinkFreq: 12, blinkStyle: 'all',
    audioEnabled: true, audioFreq: 1800, audioDuration: 75, audioVol: 75,
    ledBloom: 1.1,
    wheelFill: 'outside-in', wheelStartRpm: 55, wheelShift: 89, wheelBlinkHz: 12,
    tyre: 'semi-slick'
  },
  benzin: {
    name: 'Benziner / Straße (Mitte → außen)',
    pattern: 'centre-out',
    startRpm: 50, warnRpm: 75, shiftPoint: 88,
    blinkFreq: 8, blinkStyle: 'all',
    audioEnabled: false, audioFreq: 1600, audioDuration: 80, audioVol: 60,
    ledBloom: 0.9,
    wheelFill: 'centre-out', wheelStartRpm: 50, wheelShift: 88, wheelBlinkHz: 8,
    tyre: 'street'
  },
  drift: {
    name: 'Drift (rechts → links)',
    pattern: 'left-right',
    startRpm: 45, warnRpm: 70, shiftPoint: 85,
    blinkFreq: 14, blinkStyle: 'strobe',
    audioEnabled: true, audioFreq: 1500, audioDuration: 90, audioVol: 70,
    ledBloom: 1.0,
    wheelFill: 'right-left', wheelStartRpm: 45, wheelShift: 85, wheelBlinkHz: 14,
    tyre: 'drift'
  },
  hypercar: {
    name: 'Hypercar Le Mans (Mitte → außen)',
    pattern: 'solid',
    startRpm: 65, warnRpm: 82, shiftPoint: 93,
    blinkFreq: 20, blinkStyle: 'all',
    audioEnabled: true, audioFreq: 2100, audioDuration: 50, audioVol: 85,
    ledBloom: 1.4,
    wheelFill: 'centre-out', wheelStartRpm: 65, wheelShift: 93, wheelBlinkHz: 20,
    tyre: 'slick'
  }
};
const BUILTIN_PROFILE_KEYS = Object.keys(PROFILES);
let currentProfileKey = 'porsche';
let webConfigLoaded = false;   // erst nach dem Laden vom Server automatisch speichern

// Server-Adresse Management (Für Zugriff aus anderer Stadt / lokal / Pi)
const IS_GITHUB_PAGES = window.location.hostname.includes('github.io');
let customServerBase = localStorage.getItem('apexshift_server_url') || (IS_GITHUB_PAGES ? 'http://192.168.2.124:5305' : '');

function getApiBaseUrl() {
  if (customServerBase && customServerBase !== 'auto') {
    return customServerBase.replace(/\/+$/, '');
  }
  return '';
}

function apiUrl(endpoint) {
  const base = getApiBaseUrl();
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return base ? `${base}${path}` : path;
}

// Aktiver Konfigurationszustand
let activeConfig = {
  ...PROFILES.porsche,
  limiterMultiBeep: true,
  limiterSpeed: 110,
  wheelHardwareEnabled: true
};
let speedUnit = 'kmh'; // 'kmh' | 'mph'
let tempUnit = 'c';    // 'c' | 'f'
let isSimulatorActive = false;
let simRpmPercent = 0;
let simGear = 1;
let simGasHeld = false;
let simAnimationId = null;

// Telemetrie Zustand
let telemetryState = {
  isRaceOn: 0,
  currentEngineRpm: 0,
  engineMaxRpm: 8500,
  engineIdleRpm: 900,
  rpmPercent: 0,
  speedKmh: 0,
  speedMph: 0,
  gearDisplay: 'N',
  gear: 0,
  accel: 0,
  brake: 0,
  clutch: 0,
  boostBar: 0,
  powerHp: 0,
  tireTemp: { fl: 85, fr: 85, rl: 85, rr: 85 },
  tireSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
  gForce: { lateral: 0, longitudinal: 0 },
  lastPacketTime: 0
};

// Blink- & Audio-Zustand
let isBlinkPhaseOn = true;
let lastBlinkToggle = 0;
let hasBeepedThisShift = false;
let lastLimiterBeepTime = 0;

// Launch Control & Sprint Zustand (Timer startet beim Loslassen von Kreis und stoppt erst bei der BREMSE!)
let keyboardCirclePressed = false;
let simCirclePressed = false;
let isLaunchStaging = false;     // Kreis + Gas gehalten: Staging & LEDs aktiv, Timer wartet
let isSprintRunning = false;     // Kreis losgelassen: Sprint-Timer zählt live hoch!
let sprintStartTime = 0;         // Startzeitpunkt beim Loslassen von Kreis
let sprintStartSpeed = 0;        // Geschwindigkeit beim Start
let sprintFinalTime = null;      // Gesamte Sprintzeit (bis zum Bremsen)
let sprintSplit100 = null;       // 0-100 km/h Zwischenzeit
let sprintMaxSpeed = 0;          // Höchstgeschwindigkeit während des Sprints
let launchFadeTimeout = null;

// Logitech G923 Wheel LEDs DOM Elements
const logiLed0 = document.getElementById('logiLed0');
const logiLed1 = document.getElementById('logiLed1');
const logiLed2 = document.getElementById('logiLed2');
const logiLed3 = document.getElementById('logiLed3');
const logiLed4 = document.getElementById('logiLed4');
const logiLedsCluster = document.getElementById('logiLedsCluster');
const logiWheelStatusText = document.getElementById('logiWheelStatusText');

function pollGamepadCircle() {
  try {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of gamepads) {
      if (!gp) continue;
      // Button 1 oder Button 2 ist Kreis (PlayStation) bzw. B (Xbox)
      if (gp.buttons[1]?.pressed || gp.buttons[2]?.pressed) return true;
    }
  } catch (_) {}
  return false;
}

// Web Audio API Kontext
let audioCtx = null;

function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playShiftBeep() {
  if (!activeConfig.audioEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(activeConfig.audioFreq, ctx.currentTime);

    const volume = (activeConfig.audioVol / 100) * 0.4;
    const duration = activeConfig.audioDuration / 1000;

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch (err) {
    console.warn('Audio Beep Error:', err);
  }
}

// ------------------------------------------------------------
// PROFILE & REIFEN
// ------------------------------------------------------------
let customProfiles = {};

// Sendet Lenkrad-Einstellungen, Profil und Reifen an den Server (wird dort gespeichert)
function notifyWheelConfig() {
  if (!webConfigLoaded) return Promise.resolve();
  return fetch(apiUrl('/api/config'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wheelHardware: activeConfig.wheelHardwareEnabled,
      wheelStartRpm: activeConfig.wheelStartRpm,
      wheelShift: activeConfig.wheelShift,
      wheelFill: activeConfig.wheelFill,
      wheelBlinkHz: activeConfig.wheelBlinkHz,
      tyre: activeConfig.tyre,
      profile: currentProfileKey
    })
  }).catch(() => {});
}

function rebuildProfileSelect() {
  const sel = document.getElementById('profileSelect');
  if (!sel) return;
  sel.innerHTML = '';
  for (const key of BUILTIN_PROFILE_KEYS) {
    sel.add(new Option(PROFILES[key].name, key));
  }
  const customKeys = Object.keys(customProfiles);
  if (customKeys.length) {
    const group = document.createElement('optgroup');
    group.label = 'Eigene Profile';
    for (const key of customKeys) group.appendChild(new Option(PROFILES[key].name, key));
    sel.appendChild(group);
  }
  sel.value = PROFILES[currentProfileKey] ? currentProfileKey : 'porsche';
  const del = document.getElementById('deleteProfileBtn');
  if (del) del.style.display = currentProfileKey.startsWith('custom_') ? '' : 'none';
}

// Profil anwenden: Dashboard-LEDs, Lenkrad-LEDs (Richtung/Schwellen/Blinken), Reifen, Töne
function applyProfile(key) {
  const profile = PROFILES[key];
  if (!profile) return;
  currentProfileKey = key;
  // Diese Einstellungen gehören nicht zum Profil und bleiben erhalten:
  const keep = {
    limiterMultiBeep: activeConfig.limiterMultiBeep,
    limiterSpeed: activeConfig.limiterSpeed,
    wheelHardwareEnabled: activeConfig.wheelHardwareEnabled
  };
  activeConfig = { ...keep, ...profile };
  syncSettingsToInputs();
  rebuildProfileSelect();
  renderTyreBadge();
  notifyWheelConfig();
}

async function saveCustomProfile() {
  const name = (prompt('Name für dein neues Profil (z. B. "Mein GT3"):') || '').trim();
  if (!name) return;
  const key = 'custom_' + name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, '_');
  const { wheelHardwareEnabled, ...settings } = activeConfig;   // An/Aus gehört nicht ins Profil
  PROFILES[key] = { ...settings, name };
  customProfiles[key] = PROFILES[key];
  currentProfileKey = key;
  rebuildProfileSelect();
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customProfiles, profile: key })
  }).catch(() => {});
}

async function deleteCustomProfile() {
  if (!currentProfileKey.startsWith('custom_')) return;
  if (!confirm(`Profil "${PROFILES[currentProfileKey].name}" wirklich löschen?`)) return;
  delete PROFILES[currentProfileKey];
  delete customProfiles[currentProfileKey];
  await fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customProfiles })
  }).catch(() => {});
  applyProfile('porsche');
}

// Reifen-Anzeige: gewählte Mischung + Betriebsfenster
function renderTyreBadge() {
  const tyre = TYRES[activeConfig.tyre] || TYRES.street;
  const badge = document.getElementById('tyreBadge');
  const range = document.getElementById('tyreRange');
  const headerLabel = document.getElementById('headerTyreLabel');
  const select = document.getElementById('tyreSelect');
  if (badge) badge.textContent = tyre.name;
  if (headerLabel) headerLabel.textContent = `Reifen: ${tyre.name}`;
  if (range) range.textContent = `Ideal ${tyre.min}–${tyre.max} °C`;
  if (select) select.value = activeConfig.tyre || 'street';

  // Schnellauswahl-Pills aktualisieren
  const container = document.getElementById('tyrePillsContainer');
  if (container) {
    container.querySelectorAll('.tyre-pill-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tyre === (activeConfig.tyre || 'street'));
    });
  }
}

function initTyrePills() {
  const container = document.getElementById('tyrePillsContainer');
  if (!container) return;
  container.innerHTML = '';
  const icons = {
    street: '🚗', sport: '🏎️', 'semi-slick': '🏁', slick: '⚡',
    rally: '🌲', offroad: '🏜️', drift: '💨', snow: '❄️', drag: '🚀'
  };
  Object.entries(TYRES).forEach(([key, info]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tyre-pill-btn ${key === (activeConfig.tyre || 'street') ? 'active' : ''}`;
    btn.dataset.tyre = key;
    btn.innerHTML = `<span class="icon">${icons[key] || '🛞'}</span> ${info.name}`;
    btn.title = `${info.name} (Optimales Betriebsfenster: ${info.min}–${info.max} °C)`;
    btn.addEventListener('click', () => {
      activeConfig.tyre = key;
      renderTyreBadge();
      notifyWheelConfig();
    });
    container.appendChild(btn);
  });
}

// Bewertet eine Reifentemperatur gegen das Fenster der gewählten Mischung
function tyreTempState(tempC) {
  const tyre = TYRES[activeConfig.tyre] || TYRES.street;
  if (tempC < tyre.min) return 'cold';
  if (tempC > tyre.max) return 'hot';
  return 'ok';
}

function updateTyreSummary(temps) {
  const el = document.getElementById('tyreStatus');
  if (!el || !temps) return;
  const avg = (temps.fl + temps.fr + temps.rl + temps.rr) / 4;
  const state = tyreTempState(avg);
  const label = { cold: 'ZU KALT', ok: 'OPTIMAL', hot: 'ZU HEISS' }[state];
  const shown = tempUnit === 'c' ? `${Math.round(avg)} °C` : `${Math.round(avg * 9 / 5 + 32)} °F`;
  el.textContent = `Ø ${shown} · ${label}`;
  el.className = `tyre-status tyre-${state}`;
}

// ------------------------------------------------------------
// DOM ELEMENTE
// ------------------------------------------------------------
const shiftLightBar = document.getElementById('shiftLightBar');
const liveRpmDisplay = document.getElementById('liveRpmDisplay');
const idleRpmDisplay = document.getElementById('idleRpmDisplay');
const maxRpmDisplay = document.getElementById('maxRpmDisplay');
const shiftActionHint = document.getElementById('shiftActionHint');

const gearDisplay = document.getElementById('gearDisplay');
const gearHub = document.getElementById('gearHub');
const gearIndicatorSub = document.getElementById('gearIndicatorSub');
const speedValue = document.getElementById('speedValue');
const speedUnitLabel = document.getElementById('speedUnit');
const radialRpmProgress = document.getElementById('radialRpmProgress');

const throttleBar = document.getElementById('throttleBar');
const throttleVal = document.getElementById('throttleVal');
const brakeBar = document.getElementById('brakeBar');
const brakeVal = document.getElementById('brakeVal');
const clutchBar = document.getElementById('clutchBar');
const clutchVal = document.getElementById('clutchVal');

const boostDisplay = document.getElementById('boostDisplay');
const powerDisplay = document.getElementById('powerDisplay');

const tireNodeFL = document.getElementById('tireNodeFL');
const tireNodeFR = document.getElementById('tireNodeFR');
const tireNodeRL = document.getElementById('tireNodeRL');
const tireNodeRR = document.getElementById('tireNodeRR');
const tireTempFL = document.getElementById('tireTempFL');
const tireTempFR = document.getElementById('tireTempFR');
const tireTempRL = document.getElementById('tireTempRL');
const tireTempRR = document.getElementById('tireTempRR');
const tireSlipFL = document.getElementById('tireSlipFL');
const tireSlipFR = document.getElementById('tireSlipFR');
const tireSlipRL = document.getElementById('tireSlipRL');
const tireSlipRR = document.getElementById('tireSlipRR');

const gBall = document.getElementById('gBall');
const gLatVal = document.getElementById('gLatVal');
const gLongVal = document.getElementById('gLongVal');

const connectionPill = document.getElementById('connectionPill');
const connectionText = document.getElementById('connectionText');
const packetRate = document.getElementById('packetRate');
const udpPortDisplay = document.getElementById('udpPortDisplay');

const launchControlWidget = document.getElementById('launchControlWidget');
const launchTimerVal = document.getElementById('launchTimerVal');
const launchStatusSub = document.getElementById('launchStatusSub');
const simCircleBtn = document.getElementById('simCircleBtn');
const simClutchBtn = document.getElementById('simClutchBtn');
const simBrakeBtn = document.getElementById('simBrakeBtn');

const lcToggleBtn = document.getElementById('lcToggleBtn');
const lcStatusPillText = document.getElementById('lcStatusPillText');
const lcPillDot = document.getElementById('lcPillDot');
const lcToastBanner = document.getElementById('lcToastBanner');
const lcToastIcon = document.getElementById('lcToastIcon');
const lcToastTitle = document.getElementById('lcToastTitle');
const lcToastSub = document.getElementById('lcToastSub');

let lcToastTimeout = null;
let lastHandledLcNotificationTime = 0;

function showLcToast(enabled, reason) {
  if (!lcToastBanner) return;
  if (lcToastTimeout) clearTimeout(lcToastTimeout);

  lcToastBanner.classList.toggle('toast-disabled', !enabled);
  if (lcToastIcon) lcToastIcon.textContent = enabled ? '⚡' : '🚫';
  if (lcToastTitle) lcToastTitle.textContent = enabled ? 'LAUNCH CONTROL BEREIT' : 'LAUNCH CONTROL GESPERRT';
  if (lcToastSub) lcToastSub.textContent = reason ? `Ausgelöst: ${reason}` : '';
  lcToastBanner.style.display = 'flex';

  playLcTone(enabled);

  lcToastTimeout = setTimeout(() => {
    lcToastBanner.style.display = 'none';
    lcToastTimeout = null;
  }, 2600);
}

function updateLcStatusPill(enabled) {
  if (!lcToggleBtn || !lcStatusPillText) return;
  if (enabled) {
    lcToggleBtn.className = 'lc-status-pill lc-enabled';
    lcStatusPillText.textContent = '⚡ LAUNCH CONTROL: BEREIT';
  } else {
    lcToggleBtn.className = 'lc-status-pill lc-disabled';
    lcStatusPillText.textContent = '🚫 LAUNCH CONTROL: GESPERRT';
  }
}

function playLcTone(enabled) {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (enabled) {
      // Zwei fröhliche aufsteigende Töne (520Hz -> 780Hz)
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(780, now + 0.12);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.25);
    } else {
      // Zwei dumpfere absteigende Warntöne (440Hz -> 220Hz)
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(220, now + 0.18);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    }
  } catch (_) {}
}

function setLaunchControlState(enabled, reason) {
  activeConfig.launchControlEnabled = enabled;
  updateLcStatusPill(enabled);
  showLcToast(enabled, reason);

  if (!enabled && isLaunchStaging) {
    isLaunchStaging = false;
    if (launchControlWidget) launchControlWidget.style.display = 'none';
  }

  fetch('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ launchControlEnabled: enabled })
  }).catch(() => {});
}

// PEDAL-KOMBI ERKENNUNG:
// 4x Kupplung schnell -> Launch Control sperren
// 2x Kupplung + 1x Bremse schnell -> Launch Control freigeben
let pedalComboHistory = [];
let lastAppClutchDown = false;
let lastAppBrakeDown = false;

function checkAppPedalCombos(clutchVal, brakeVal) {
  const now = performance.now();
  pedalComboHistory = pedalComboHistory.filter(e => now - e.time < 2800);

  const clutchDown = (clutchVal || 0) > 35;
  if (clutchDown && !lastAppClutchDown) {
    pedalComboHistory.push({ type: 'clutch', time: now });
    evaluatePedalCombos();
  } else if (!clutchDown && (clutchVal || 0) < 15) {
    lastAppClutchDown = false;
  }
  if (clutchDown) lastAppClutchDown = true;

  const brakeDown = (brakeVal || 0) > 35;
  if (brakeDown && !lastAppBrakeDown) {
    pedalComboHistory.push({ type: 'brake', time: now });
    evaluatePedalCombos();
  } else if (!brakeDown && (brakeVal || 0) < 15) {
    lastAppBrakeDown = false;
  }
  if (brakeDown) lastAppBrakeDown = true;
}

function evaluatePedalCombos() {
  const types = pedalComboHistory.map(p => p.type);
  const n = types.length;

  // 1. "2x Kupplung + 1x Bremse" -> LAUNCH CONTROL AKTIVIEREN
  if (n >= 3 &&
      types[n - 3] === 'clutch' &&
      types[n - 2] === 'clutch' &&
      types[n - 1] === 'brake') {
    pedalComboHistory = [];
    setLaunchControlState(true, '2x Kupplung + 1x Bremse');
    return;
  }

  // 2. "4x Kupplung" -> LAUNCH CONTROL SPERREN / DEAKTIVIEREN
  if (n >= 4 &&
      types[n - 4] === 'clutch' &&
      types[n - 3] === 'clutch' &&
      types[n - 2] === 'clutch' &&
      types[n - 1] === 'clutch') {
    pedalComboHistory = [];
    setLaunchControlState(false, '4x Kupplung schnell');
    return;
  }
}

// ------------------------------------------------------------
// 1. INITIALISIERUNG DER 16 LEDS
// ------------------------------------------------------------
function initShiftLightLeds() {
  shiftLightBar.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const led = document.createElement('div');
    led.className = 'led-unit';
    led.dataset.index = i;
    shiftLightBar.appendChild(led);
  }
}

// ------------------------------------------------------------
// 2. RENDERING DER SHIFT LIGHTS
// ------------------------------------------------------------
function updateShiftLights(rpmPct) {
  const leds = shiftLightBar.children;
  const numLeds = leds.length; // 16

  const startPct = activeConfig.startRpm;
  const warnPct = activeConfig.warnRpm;
  const shiftPct = activeConfig.shiftPoint;

  // Blinktaktung berechnen
  const now = performance.now();
  const blinkInterval = 1000 / (activeConfig.blinkFreq * 2);
  if (now - lastBlinkToggle > blinkInterval) {
    isBlinkPhaseOn = !isBlinkPhaseOn;
    lastBlinkToggle = now;
  }

  const isShiftZone = rpmPct >= shiftPct;

  // Audio Beep auslösen (im Begrenzer wiederholt, sonst einmalig)
  if (isShiftZone) {
    if (activeConfig.limiterMultiBeep) {
      if (now - lastLimiterBeepTime > activeConfig.limiterSpeed) {
        playShiftBeep();
        lastLimiterBeepTime = now;
      }
    } else {
      if (!hasBeepedThisShift) {
        playShiftBeep();
        hasBeepedThisShift = true;
      }
    }
  } else {
    hasBeepedThisShift = false;
    lastLimiterBeepTime = 0;
  }

  // Gear Hub Hervorhebung & Hinweis
  if (isShiftZone && isBlinkPhaseOn) {
    gearHub.classList.add('shift-flash');
    shiftActionHint.textContent = '⚡ SCHALTEN! ⚡';
    shiftActionHint.classList.add('flash-now');
  } else {
    gearHub.classList.remove('shift-flash');
    shiftActionHint.classList.remove('flash-now');
    if (rpmPct > warnPct) {
      shiftActionHint.textContent = 'DREHZAHL HOCH';
    } else if (rpmPct > startPct) {
      shiftActionHint.textContent = 'BESCHLEUNIGUNG';
    } else {
      shiftActionHint.textContent = 'BEREIT';
    }
  }

  // LAUNCH CONTROL MODUS: LEDs an Drehzahl anpassen (nur wenn freigegeben!)
  if (isLaunchStaging && activeConfig.launchControlEnabled !== false) {
    const targetRpmPct = activeConfig.launchTargetRpm || 65;
    const lcProgress = Math.min(1, Math.max(0, rpmPct / targetRpmPct));
    const isStaged = lcProgress >= 0.95;

    for (let i = 0; i < numLeds; i++) {
      const led = leds[i];
      led.className = 'led-unit';
      let isLit = false;
      let colorClass = 'lit-blue';

      if (activeConfig.pattern === 'centre-out') {
        const distFromCenter = i < 8 ? (7 - i) : (i - 8);
        const activeCount = Math.round(lcProgress * 8);
        isLit = distFromCenter < activeCount;
        if (distFromCenter >= 6) colorClass = 'lit-red';
        else if (distFromCenter >= 3) colorClass = 'lit-yellow';
        else colorClass = 'lit-blue'; // Mitte fängt bei Blau an!
      } else {
        const activeCount = Math.round(lcProgress * 16);
        isLit = i < activeCount;
        if (i >= 12) colorClass = 'lit-red';
        else if (i >= 7) colorClass = 'lit-yellow';
        else colorClass = 'lit-blue';
      }

      if (isStaged && !isBlinkPhaseOn && (i % 2 === 0)) {
        isLit = false;
      }

      if (isLit) led.classList.add(colorClass);
    }
    return;
  }

  // Fortschritt zwischen startPct und shiftPct (0..1)
  let progress = 0;
  if (rpmPct > startPct) {
    progress = Math.min(1, (rpmPct - startPct) / (shiftPct - startPct));
  }

  // Muster-Berechnung
  for (let i = 0; i < numLeds; i++) {
    const led = leds[i];
    led.className = 'led-unit'; // Reset

    let isLit = false;
    let colorClass = 'lit-green';

    if (activeConfig.pattern === 'outside-in') {
      // 8 LEDs von links nach Mitte (0..7), 8 LEDs von rechts nach Mitte (15..8)
      const distFromEdge = i < 8 ? i : 15 - i; // 0 bis 7
      const activeCount = Math.round(progress * 8);
      isLit = distFromEdge < activeCount;

      if (distFromEdge >= 6) colorClass = 'lit-red';
      else if (distFromEdge >= 4) colorClass = 'lit-yellow';
      else colorClass = 'lit-green';

    } else if (activeConfig.pattern === 'centre-out') {
      // Mitte nach außen (Benzin): Die Mitte fängt bei BLAU an und geht nach außen
      const distFromCenter = i < 8 ? (7 - i) : (i - 8); // 0 bis 7
      const activeCount = Math.round(progress * 8);
      isLit = distFromCenter < activeCount;

      if (distFromCenter >= 6) colorClass = 'lit-red';
      else if (distFromCenter >= 3) colorClass = 'lit-yellow';
      else colorClass = 'lit-blue'; // Mitte fängt bei BLAU an!

    } else if (activeConfig.pattern === 'f1') {
      // 16 LEDs: 5x Grün, 5x Rot, 6x Blau/Violett
      const activeCount = Math.round(progress * 16);
      isLit = i < activeCount;

      if (i >= 10) colorClass = 'lit-blue';
      else if (i >= 5) colorClass = 'lit-red';
      else colorClass = 'lit-green';

    } else if (activeConfig.pattern === 'left-right') {
      // Klassisch links nach rechts
      const activeCount = Math.round(progress * 16);
      isLit = i < activeCount;

      const pctLed = i / 16;
      if (pctLed >= 0.75) colorClass = 'lit-red';
      else if (pctLed >= 0.5) colorClass = 'lit-yellow';
      else colorClass = 'lit-green';

    } else if (activeConfig.pattern === 'solid') {
      // Alle füllen sich auf und blinken als ganzer Balken
      const activeCount = Math.round(progress * 16);
      isLit = i < activeCount;
      colorClass = progress > 0.8 ? 'lit-red' : (progress > 0.5 ? 'lit-yellow' : 'lit-green');
    }

    // Blinken anwenden, wenn im Shift-Bereich
    if (isShiftZone) {
      if (activeConfig.blinkStyle === 'all') {
        if (!isBlinkPhaseOn) isLit = false;
        colorClass = 'lit-red';
      } else if (activeConfig.blinkStyle === 'redline-only') {
        if (colorClass === 'lit-red' && !isBlinkPhaseOn) isLit = false;
      } else if (activeConfig.blinkStyle === 'strobe') {
        if ((i % 2 === 0 && isBlinkPhaseOn) || (i % 2 !== 0 && !isBlinkPhaseOn)) {
          isLit = false;
        }
        colorClass = 'lit-blue';
      }
    }

    if (isLit) {
      led.classList.add(colorClass);
    }
  }

  // Physische Logitech G 5-LED Replika aktualisieren
  updateLogitechWheelLeds(rpmPct, isShiftZone);
}

// ------------------------------------------------------------
// 2b. LOGITECH G LENKRAD 5-LED STANDARD-MODUS ANZEIGE
// ------------------------------------------------------------
// Simuliert & spiegelt die 5 physischen LEDs des Logitech G923 / G29:
// LED 0 & 1: Grün | LED 2 & 3: Gelb/Amber | LED 4: Rot
const LOGI_FILL_STEPS = {
  'left-right': [0b00001, 0b00011, 0b00111, 0b01111, 0b11111],
  'right-left': [0b10000, 0b11000, 0b11100, 0b11110, 0b11111],
  'centre-out': [0b00100, 0b01110, 0b11111],
  'outside-in': [0b10001, 0b11011, 0b11111],
  'f1':         [0b00001, 0b00011, 0b00111, 0b01111, 0b11111],
  'solid':      [0b00001, 0b00011, 0b00111, 0b01111, 0b11111]
};

function updateLogitechWheelLeds(rpmPct, isShiftZone) {
  if (!logiLed0 || !logiLed1 || !logiLed2 || !logiLed3 || !logiLed4) return;
  const leds = [logiLed0, logiLed1, logiLed2, logiLed3, logiLed4];

  let mask = 0;
  const wheelStart = Number(activeConfig.wheelStartRpm) || 50;
  const wheelShift = Math.max(wheelStart + 1, Number(activeConfig.wheelShift) || 88);
  const fillMode = activeConfig.wheelFill || 'left-right';

  // 1. Launch Control Modus (Staging - nur wenn freigegeben!)
  if (isLaunchStaging && activeConfig.launchControlEnabled !== false) {
    const targetRpm = 65;
    const lcProg = Math.min(1.0, Math.max(0.0, rpmPct / targetRpm));
    const steps = LOGI_FILL_STEPS[fillMode] || LOGI_FILL_STEPS['left-right'];
    const idx = Math.min(steps.length - 1, Math.floor(lcProg * steps.length));
    if (lcProg >= 0.95) {
      mask = isBlinkPhaseOn ? 0b11111 : 0b00000;
    } else {
      mask = steps[idx];
    }
    if (logiWheelStatusText) logiWheelStatusText.textContent = 'LAUNCH STAGING';
    if (logiLedsCluster) logiLedsCluster.classList.toggle('redline-flash', lcProg >= 0.95 && isBlinkPhaseOn);

  // 2. Begrenzer / Shift-Zone -> Alle 5 LEDs blinken (Authentischer Logitech Redline Flash)
  } else if (rpmPct >= wheelShift) {
    mask = isBlinkPhaseOn ? 0b11111 : 0b00000;
    if (logiWheelStatusText) logiWheelStatusText.textContent = 'SCHALTBLITZ / BEGRENZER';
    if (logiLedsCluster) logiLedsCluster.classList.add('redline-flash');

  // 3. Normales RPM Füllen
  } else if (rpmPct >= wheelStart) {
    const progress = Math.min(1.0, Math.max(0.0, (rpmPct - wheelStart) / (wheelShift - wheelStart)));
    const steps = LOGI_FILL_STEPS[fillMode] || LOGI_FILL_STEPS['left-right'];
    const idx = Math.min(steps.length - 1, Math.floor(progress * steps.length));
    mask = steps[idx];
    if (logiWheelStatusText) logiWheelStatusText.textContent = 'STANDARD-MODUS';
    if (logiLedsCluster) logiLedsCluster.classList.remove('redline-flash');

  // 4. Unterhalb Startdrehzahl
  } else {
    mask = 0;
    if (logiWheelStatusText) logiWheelStatusText.textContent = 'BEREIT';
    if (logiLedsCluster) logiLedsCluster.classList.remove('redline-flash');
  }

  // Masken-Bits (Bit 0 = LED0 links ... Bit 4 = LED4 rechts) auf DOM anwenden
  for (let i = 0; i < 5; i++) {
    const isLit = (mask & (1 << i)) !== 0;
    leds[i].classList.toggle('lit', isLit);
  }
}

// ------------------------------------------------------------
// 3. INSTRUMENTE & DASHBOARD RENDERING
// ------------------------------------------------------------
function updateDashboardUI(t) {
  // Pedal-Kombis aus Telemetrie prüfen
  checkAppPedalCombos(t.clutch || 0, t.brake || 0);

  // Synchronisation vom Server falls per UDP / API geändert
  if (t.launchControlEnabled !== undefined && t.launchControlEnabled !== activeConfig.launchControlEnabled) {
    activeConfig.launchControlEnabled = t.launchControlEnabled;
    updateLcStatusPill(activeConfig.launchControlEnabled);
  }
  if (t.lcNotification && t.lcNotificationTime && t.lcNotificationTime !== lastHandledLcNotificationTime) {
    lastHandledLcNotificationTime = t.lcNotificationTime;
    showLcToast(t.lcNotification === 'enabled', t.lcNotification === 'enabled' ? '2x Kupplung + 1x Bremse' : '4x Kupplung schnell');
  }

  const lcEnabled = activeConfig.launchControlEnabled !== false;

  // Launch Control Check: Knopf Kreis (Lenkrad / Gamepad / Bridge / Taste 'C') + Gas
  const circleHeld = pollGamepadCircle() || keyboardCirclePressed || simCirclePressed || (t.bridge && t.bridge.circlePressed);
  const gasHeld = (t.accel > 25) || (isSimulatorActive && simGasHeld && simRpmPercent > 20);
  const brakePressed = (t.brake > 12) || (!gasHeld && isSimulatorActive && simRpmPercent < 5);

  // WENN LAUNCH CONTROL GESPERRT IST (4x Kupplung):
  if (!lcEnabled) {
    if (isLaunchStaging) {
      isLaunchStaging = false;
      if (launchControlWidget) launchControlWidget.style.display = 'none';
    }
    if (circleHeld && gasHeld) {
      shiftActionHint.textContent = '🚫 LAUNCH CONTROL GESPERRT (4x KUPPLUNG)';
      shiftActionHint.classList.add('flash-now');
    }
  } else {
    // 1. PHASE: STAGING (Kreis + Gas gehalten -> Timer wartet auf 0.000, LEDs adaptiv)
    if (circleHeld && gasHeld) {
      if (!isLaunchStaging) {
        isLaunchStaging = true;
        isSprintRunning = false;
        sprintFinalTime = null;
        sprintSplit100 = null;
        sprintMaxSpeed = 0;
        if (launchFadeTimeout) { clearTimeout(launchFadeTimeout); launchFadeTimeout = null; }
        if (webConfigLoaded) {
          fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ launchControlActive: true })
          }).catch(() => {});
        }
      }
      // Timer fängt erst beim Loslassen von Kreis an -> steht während des Haltens auf 0.000 s
      if (launchControlWidget) launchControlWidget.style.display = 'flex';
      if (launchTimerVal) launchTimerVal.textContent = '0.000';
      if (launchStatusSub) {
        launchStatusSub.textContent = t.rpmPercent > 45 ? '⚡ BEREIT ZUM START · KREIS LOSLASSEN!' : 'STAGING · DREHZAHL HALTEN';
      }
      shiftActionHint.textContent = '⚡ LAUNCH BEREIT · KREIS LOSLASSEN ⚡';
      shiftActionHint.classList.add('flash-now');

    // 2. PHASE: KREIS WURDE LOSGELASSEN -> TIMER STARTET JETZT!
    } else if (isLaunchStaging && !circleHeld) {
      isLaunchStaging = false;
      isSprintRunning = true;
      sprintStartTime = performance.now();
      sprintStartSpeed = t.speedKmh || 0;
      sprintFinalTime = null;
      sprintSplit100 = null;
      sprintMaxSpeed = t.speedKmh || 0;
      if (launchControlWidget) launchControlWidget.style.display = 'flex';
      if (launchStatusSub) launchStatusSub.textContent = '🚀 START! VOLLGAS... STOPPT ERST BEI DER BREMSE!';
      if (webConfigLoaded) {
        fetch('/api/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ launchControlActive: false })
        }).catch(() => {});
      }
    }
  }

  // 3. PHASE: SPRINT LÄUFT (Timer zählt live ab Loslassen, STOPPT ERST WENN DER FAHRER BREMST!)
  if (isSprintRunning) {
    const elapsed = (performance.now() - sprintStartTime) / 1000;
    const currentSpeed = t.speedKmh || 0;
    if (currentSpeed > sprintMaxSpeed) {
      sprintMaxSpeed = currentSpeed;
    }

    // 0-100 km/h Zwischenzeit festhalten (aber Timer läuft bis zum Bremsen weiter!)
    if (currentSpeed >= 100 && sprintSplit100 === null && sprintStartSpeed < 50) {
      sprintSplit100 = elapsed;
    }

    if (launchControlWidget) launchControlWidget.style.display = 'flex';
    if (launchTimerVal) launchTimerVal.textContent = elapsed.toFixed(3);

    // BREMSE WURDE BETÄTIGT -> ZEITMESSUNG STOPPT ERST JETZT!
    if (brakePressed && elapsed > 0.4) {
      isSprintRunning = false;
      sprintFinalTime = elapsed;
      if (launchTimerVal) launchTimerVal.textContent = sprintFinalTime.toFixed(3);
      
      let statusMsg = `🛑 GEBREMST! Sprintzeit: ${sprintFinalTime.toFixed(3)} s | Top-Speed: ${Math.round(sprintMaxSpeed)} km/h`;
      if (sprintSplit100 !== null) {
        statusMsg += ` (0-100: ${sprintSplit100.toFixed(3)} s)`;
      }
      if (launchStatusSub) launchStatusSub.textContent = statusMsg;

      if (gearHub) gearHub.classList.remove('launch-staging-hub');
      if (launchFadeTimeout) clearTimeout(launchFadeTimeout);
      launchFadeTimeout = setTimeout(() => {
        if (!isLaunchStaging && !isSprintRunning && launchControlWidget) {
          launchControlWidget.style.display = 'none';
        }
      }, 9000);

    } else {
      // Während des Sprints Live-Status anzeigen
      if (launchStatusSub) {
        if (sprintSplit100 !== null) {
          launchStatusSub.textContent = `🚀 SPRINT! ${Math.round(currentSpeed)} km/h (0-100: ${sprintSplit100.toFixed(3)} s) · STOPPT BEI BREMSE`;
        } else {
          launchStatusSub.textContent = `🚀 SPRINT! ${Math.round(currentSpeed)} km/h · STOPPT ERST BEI BREMSE`;
        }
      }
    }
  }

  // Live RPM Anzeige
  liveRpmDisplay.textContent = `${t.currentEngineRpm.toLocaleString()} RPM (${Math.round(t.rpmPercent)}%)`;
  idleRpmDisplay.textContent = `IDLE: ${t.engineIdleRpm}`;
  maxRpmDisplay.textContent = `MAX: ${t.engineMaxRpm}`;

  // Shift Lights
  updateShiftLights(t.rpmPercent);

  // Radial RPM Gauge (Umfang = 2 * PI * 120 ≈ 753.98)
  const circumference = 753.98;
  const sweepPercent = Math.min(1, Math.max(0, t.rpmPercent / 100));
  const offset = circumference - (sweepPercent * circumference);
  radialRpmProgress.style.strokeDashoffset = offset;
  if (t.rpmPercent >= activeConfig.shiftPoint) {
    radialRpmProgress.classList.add('redline');
  } else {
    radialRpmProgress.classList.remove('redline');
  }

  // Gear & Speed
  if (isLaunchStaging) {
    gearDisplay.textContent = 'LC';
    gearIndicatorSub.textContent = 'LAUNCH STAGING';
    gearHub.classList.add('launch-staging-hub');
  } else {
    gearHub.classList.remove('launch-staging-hub');
    gearDisplay.textContent = t.gearDisplay;
    if (t.gearDisplay === 'R') {
      gearIndicatorSub.textContent = 'RÜCKWÄRTS';
    } else if (t.gearDisplay === 'N') {
      gearIndicatorSub.textContent = 'LEERLAUF';
    } else {
      gearIndicatorSub.textContent = `GANG ${t.gearDisplay}`;
    }
  }

  const speed = speedUnit === 'kmh' ? t.speedKmh : t.speedMph;
  speedValue.textContent = speed;
  speedUnitLabel.textContent = speedUnit.toUpperCase();

  // Pedale
  throttleBar.style.height = `${t.accel}%`;
  throttleVal.textContent = `${t.accel}%`;
  brakeBar.style.height = `${t.brake}%`;
  brakeVal.textContent = `${t.brake}%`;
  clutchBar.style.height = `${t.clutch}%`;
  clutchVal.textContent = `${t.clutch}%`;

  // Boost & Power
  boostDisplay.innerHTML = `${t.boostBar.toFixed(2)} <small>BAR</small>`;
  powerDisplay.innerHTML = `${t.powerHp} <small>PS</small>`;

  // Reifen (Temperaturen & Schlupf)
  updateTireNode(tireNodeFL, tireTempFL, tireSlipFL, t.tireTemp.fl, t.tireSlip.fl);
  updateTireNode(tireNodeFR, tireTempFR, tireSlipFR, t.tireTemp.fr, t.tireSlip.fr);
  updateTireNode(tireNodeRL, tireTempRL, tireSlipRL, t.tireTemp.rl, t.tireSlip.rl);
  updateTireNode(tireNodeRR, tireTempRR, tireSlipRR, t.tireTemp.rr, t.tireSlip.rr);
  updateTyreSummary(t.tireTemp);

  // G-Meter
  const latG = t.gForce.lateral;
  const longG = t.gForce.longitudinal;
  gLatVal.textContent = `${latG > 0 ? '+' : ''}${latG.toFixed(2)} G`;
  gLongVal.textContent = `${longG > 0 ? '+' : ''}${longG.toFixed(2)} G`;

  // Ball bewegen (-1.5G bis +1.5G auf Radius von 25px abbilden)
  const ballX = Math.max(-25, Math.min(25, latG * 16));
  const ballY = Math.max(-25, Math.min(25, -longG * 16));
  gBall.style.transform = `translate(calc(-50% + ${ballX}px), calc(-50% + ${ballY}px))`;
}

function updateTireNode(node, tempEl, slipEl, tempC, slipVal) {
  const displayTemp = tempUnit === 'c' ? `${tempC}°C` : `${Math.round(tempC * 9/5 + 32)}°F`;
  tempEl.textContent = displayTemp;

  node.classList.remove('slip-warning', 'slip-danger', 'temp-cold', 'temp-ok', 'temp-hot');
  node.classList.add(`temp-${tyreTempState(tempC)}`);
  if (slipVal > 0.4) {
    node.classList.add('slip-danger');
    slipEl.textContent = 'SCHLUPF!';
  } else if (slipVal > 0.15) {
    node.classList.add('slip-warning');
    slipEl.textContent = 'GRENZE';
  } else {
    slipEl.textContent = 'GRIP';
  }
}

// ------------------------------------------------------------
// 4. SSE TELEMETRIE STREAM VERBINDUNG
// ------------------------------------------------------------
let packetCountInWindow = 0;
let lastPacketCountReset = performance.now();
let eventSource = null;

function connectTelemetryStream() {
  if (eventSource) {
    try { eventSource.close(); } catch (_) {}
    eventSource = null;
  }

  try {
    const streamUrl = apiUrl('/api/stream');
    eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (!isSimulatorActive) {
          telemetryState = data;
          updateDashboardUI(telemetryState);

          // Status aktualisieren
          connectionPill.className = 'status-pill connected';
          connectionText.textContent = 'Forza verbunden (Live)';
        }

        // Paket-Rate messen
        packetCountInWindow++;
        const now = performance.now();
        if (now - lastPacketCountReset >= 1000) {
          packetRate.textContent = `${packetCountInWindow} Hz`;
          packetCountInWindow = 0;
          lastPacketCountReset = now;
        }
      } catch (e) {
        console.error('Telemetrie Parse Fehler:', e);
      }
    };

    eventSource.onerror = () => {
      if (!isSimulatorActive) {
        connectionPill.className = 'status-pill waiting';
        connectionText.textContent = 'Warte auf Forza...';
        packetRate.textContent = '0 Hz';
      }
    };
  } catch (err) {
    console.warn('EventSource Fehler:', err);
  }
}

// ------------------------------------------------------------
// 5. TEST-SIMULATOR MODUS
// ------------------------------------------------------------
const simModeBtn = document.getElementById('simModeBtn');
const simBar = document.getElementById('simBar');
const simRpmSlider = document.getElementById('simRpmSlider');
const simRpmLabel = document.getElementById('simRpmLabel');
const simGasBtn = document.getElementById('simGasBtn');
const gearBtns = document.querySelectorAll('.gear-btn');

function toggleSimulator() {
  isSimulatorActive = !isSimulatorActive;
  if (isSimulatorActive) {
    simModeBtn.classList.add('active');
    simBar.classList.remove('hidden');
    connectionPill.className = 'status-pill connected';
    connectionText.textContent = 'Simulator aktiv';
    startSimLoop();
  } else {
    simModeBtn.classList.remove('active');
    simBar.classList.add('hidden');
    cancelAnimationFrame(simAnimationId);
  }
}

function startSimLoop() {
  function loop() {
    if (!isSimulatorActive) return;

    if (simGasHeld) {
      simRpmPercent = Math.min(100, simRpmPercent + 1.2);
      simRpmSlider.value = simRpmPercent;
    } else {
      simRpmPercent = parseFloat(simRpmSlider.value);
    }

    const maxRpm = 8500;
    const currentRpm = Math.round((simRpmPercent / 100) * maxRpm);
    simRpmLabel.textContent = `${Math.round(simRpmPercent)} % (${currentRpm} RPM)`;

    // Synthetische Telemetriedaten erstellen
    const simTelemetry = {
      isRaceOn: 1,
      engineMaxRpm: maxRpm,
      engineIdleRpm: 900,
      currentEngineRpm: currentRpm,
      rpmPercent: simRpmPercent,
      speedKmh: Math.round((simRpmPercent / 100) * (simGear * 48)),
      speedMph: Math.round((simRpmPercent / 100) * (simGear * 30)),
      gearDisplay: String(simGear),
      gear: simGear,
      accel: simGasHeld ? 100 : Math.round(simRpmPercent),
      brake: 0,
      clutch: 0,
      boostBar: Number(((simRpmPercent / 100) * 1.6).toFixed(2)),
      powerHp: Math.round((simRpmPercent / 100) * 580),
      tireTemp: { fl: 88, fr: 89, rl: 92, rr: 91 },
      tireSlip: {
        fl: Number(((simRpmPercent / 100) * 0.1).toFixed(2)),
        fr: Number(((simRpmPercent / 100) * 0.1).toFixed(2)),
        rl: Number(((simRpmPercent / 100) * 0.25).toFixed(2)),
        rr: Number(((simRpmPercent / 100) * 0.25).toFixed(2))
      },
      gForce: {
        lateral: Number((Math.sin(Date.now() / 1000) * 0.6).toFixed(2)),
        longitudinal: Number(((simRpmPercent / 100) * 0.8).toFixed(2))
      }
    };

    updateDashboardUI(simTelemetry);

    // Simulator-Telemetrie ca. alle 35ms an den Server senden -> ECHTE Lenkrad-LEDs reagieren auch im Test-Modus!
    const nowSim = performance.now();
    if (!loop.lastServerPush || nowSim - loop.lastServerPush > 35) {
      loop.lastServerPush = nowSim;
      fetch('/api/sim-telemetry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simTelemetry)
      }).catch(() => {});
    }

    simAnimationId = requestAnimationFrame(loop);
  }
  loop();
}

// ------------------------------------------------------------
// 6. EVENT LISTENER & EINSTELLUNGEN
// ------------------------------------------------------------
function setupEventListeners() {
  // In-Game Always-on-Top HUD Overlay
  const inGameOverlayBtn = document.getElementById('inGameOverlayBtn');
  if (inGameOverlayBtn) {
    inGameOverlayBtn.addEventListener('click', async () => {
      if ('documentPictureInPicture' in window) {
        try {
          const pipWindow = await window.documentPictureInPicture.requestWindow({
            width: 480,
            height: 140
          });
          const res = await fetch('/overlay.html');
          const html = await res.text();
          pipWindow.document.open();
          pipWindow.document.write(html);
          pipWindow.document.close();
          return;
        } catch (e) {
          console.warn('PiP window failed, using popup fallback', e);
        }
      }
      window.open('/overlay.html', 'ApexShiftHUD', 'width=480,height=140,top=40,left=100,menubar=no,toolbar=no,status=no,resizable=yes');
    });
  }

  // Simulator Buttons
  simModeBtn.addEventListener('click', toggleSimulator);

  simGasBtn.addEventListener('mousedown', () => { simGasHeld = true; });
  window.addEventListener('mouseup', () => { simGasHeld = false; });
  simGasBtn.addEventListener('touchstart', (e) => { e.preventDefault(); simGasHeld = true; });
  window.addEventListener('touchend', () => { simGasHeld = false; });

  // Tastatursteuerung für Simulator (Leertaste = Vollgas)
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && isSimulatorActive && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      simGasHeld = true;
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && isSimulatorActive) {
      simGasHeld = false;
    }
  });

  gearBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      gearBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      simGear = parseInt(btn.dataset.gear, 10);
    });
  });

  // Sound Toggle
  const soundToggleBtn = document.getElementById('soundToggleBtn');
  const soundIcon = document.getElementById('soundIcon');
  soundToggleBtn.addEventListener('click', () => {
    activeConfig.audioEnabled = !activeConfig.audioEnabled;
    soundToggleBtn.classList.toggle('active', activeConfig.audioEnabled);
    soundIcon.textContent = activeConfig.audioEnabled ? '🔊' : '🔇';
    document.getElementById('audioBeepEnabled').checked = activeConfig.audioEnabled;
  });

  // View Toggle (Dashboard vs. Settings)
  const viewToggleBtn = document.getElementById('viewToggleBtn');
  const dashboardView = document.getElementById('dashboardView');
  const settingsView = document.getElementById('settingsView');
  viewToggleBtn.addEventListener('click', () => {
    const isDashboard = dashboardView.classList.contains('active-view');
    if (isDashboard) {
      dashboardView.classList.remove('active-view');
      settingsView.classList.add('active-view');
      viewToggleBtn.innerHTML = '<span class="icon">🏎️</span> Dashboard';
    } else {
      settingsView.classList.remove('active-view');
      dashboardView.classList.add('active-view');
      viewToggleBtn.innerHTML = '<span class="icon">⚙️</span> Einstellungen';
    }
  });

  // Fullscreen
  document.getElementById('fullscreenBtn').addEventListener('click', () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen();
    }
  });

  // Test Audio Beep
  document.getElementById('testAudioBtn').addEventListener('click', () => {
    playShiftBeep();
  });

  // Profil-Auswahl (Dashboard- UND Lenkrad-LEDs, Reifen, Töne)
  const profileSelect = document.getElementById('profileSelect');
  profileSelect.addEventListener('change', (e) => applyProfile(e.target.value));

  document.getElementById('saveProfileBtn').addEventListener('click', saveCustomProfile);
  document.getElementById('resetProfileBtn').addEventListener('click', () => applyProfile(currentProfileKey));
  const deleteProfileBtn = document.getElementById('deleteProfileBtn');
  if (deleteProfileBtn) deleteProfileBtn.addEventListener('click', deleteCustomProfile);

  // Reifenmischung (manuell - Forza sendet sie nicht per Telemetrie)
  const tyreSelect = document.getElementById('tyreSelect');
  if (tyreSelect) {
    tyreSelect.innerHTML = Object.entries(TYRES)
      .map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('');
    tyreSelect.value = activeConfig.tyre || 'street';
    tyreSelect.addEventListener('change', (e) => {
      activeConfig.tyre = e.target.value;
      renderTyreBadge();
      notifyWheelConfig();
    });
  }
  rebuildProfileSelect();
  renderTyreBadge();

  // Launch Control Toggle Button
  if (lcToggleBtn) {
    lcToggleBtn.addEventListener('click', () => {
      const next = !(activeConfig.launchControlEnabled !== false);
      setLaunchControlState(next, next ? 'Manuell freigegeben' : 'Manuell gesperrt');
    });
  }

  // Launch Control: Taste 'C' für Kreis, Taste 'X' für Kupplung, Taste 'S' für Bremse
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.key === 'c' || e.key === 'C') && !e.repeat) {
      keyboardCirclePressed = true;
    }
    if ((e.key === 'x' || e.key === 'X') && !e.repeat) {
      checkAppPedalCombos(100, 0);
    }
    if ((e.key === 's' || e.key === 'S') && !e.repeat) {
      checkAppPedalCombos(0, 100);
    }
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'c' || e.key === 'C') {
      keyboardCirclePressed = false;
    }
    if (e.key === 'x' || e.key === 'X') {
      checkAppPedalCombos(0, 0);
    }
    if (e.key === 's' || e.key === 'S') {
      checkAppPedalCombos(0, 0);
    }
  });

  // Simulator-Buttons
  if (simCircleBtn) {
    const press = (e) => { e.preventDefault(); simCirclePressed = true; };
    const release = (e) => { e.preventDefault(); simCirclePressed = false; };
    simCircleBtn.addEventListener('mousedown', press);
    window.addEventListener('mouseup', release);
    simCircleBtn.addEventListener('touchstart', press, { passive: false });
    window.addEventListener('touchend', release);
  }
  if (simClutchBtn) {
    simClutchBtn.addEventListener('click', () => {
      checkAppPedalCombos(100, 0);
      setTimeout(() => checkAppPedalCombos(0, 0), 120);
    });
  }
  if (simBrakeBtn) {
    simBrakeBtn.addEventListener('click', () => {
      checkAppPedalCombos(0, 100);
      setTimeout(() => checkAppPedalCombos(0, 0), 120);
    });
  }

  // Einstellungen Slider & Inputs verknüpfen
  setupSettingInputs();
}

function setupSettingInputs() {
  const fillPatternSelect = document.getElementById('fillPatternSelect');
  const startRpmSlider = document.getElementById('startRpmSlider');
  const startRpmVal = document.getElementById('startRpmVal');
  const warnRpmSlider = document.getElementById('warnRpmSlider');
  const warnRpmVal = document.getElementById('warnRpmVal');
  const shiftPointSlider = document.getElementById('shiftPointSlider');
  const shiftPointVal = document.getElementById('shiftPointVal');
  const blinkFreqSlider = document.getElementById('blinkFreqSlider');
  const blinkFreqVal = document.getElementById('blinkFreqVal');
  const blinkStyleSelect = document.getElementById('blinkStyleSelect');

  const audioBeepEnabled = document.getElementById('audioBeepEnabled');
  const audioFreqSlider = document.getElementById('audioFreqSlider');
  const audioFreqVal = document.getElementById('audioFreqVal');
  const audioDurationSlider = document.getElementById('audioDurationSlider');
  const audioDurationVal = document.getElementById('audioDurationVal');
  const audioVolSlider = document.getElementById('audioVolSlider');
  const audioVolVal = document.getElementById('audioVolVal');

  const ledBrightnessSlider = document.getElementById('ledBrightnessSlider');
  const ledBrightnessVal = document.getElementById('ledBrightnessVal');

  // Input Listeners
  fillPatternSelect.addEventListener('change', (e) => { activeConfig.pattern = e.target.value; });
  
  startRpmSlider.addEventListener('input', (e) => {
    activeConfig.startRpm = parseInt(e.target.value, 10);
    startRpmVal.textContent = `${activeConfig.startRpm} %`;
  });

  warnRpmSlider.addEventListener('input', (e) => {
    activeConfig.warnRpm = parseInt(e.target.value, 10);
    warnRpmVal.textContent = `${activeConfig.warnRpm} %`;
  });

  shiftPointSlider.addEventListener('input', (e) => {
    activeConfig.shiftPoint = parseInt(e.target.value, 10);
    shiftPointVal.textContent = `${activeConfig.shiftPoint} %`;
  });

  blinkFreqSlider.addEventListener('input', (e) => {
    activeConfig.blinkFreq = parseInt(e.target.value, 10);
    blinkFreqVal.textContent = `${activeConfig.blinkFreq} Hz`;
  });

  blinkStyleSelect.addEventListener('change', (e) => { activeConfig.blinkStyle = e.target.value; });

  audioBeepEnabled.addEventListener('change', (e) => {
    activeConfig.audioEnabled = e.target.checked;
    document.getElementById('soundToggleBtn').classList.toggle('active', e.target.checked);
    document.getElementById('soundIcon').textContent = e.target.checked ? '🔊' : '🔇';
  });

  audioFreqSlider.addEventListener('input', (e) => {
    activeConfig.audioFreq = parseInt(e.target.value, 10);
    audioFreqVal.textContent = `${activeConfig.audioFreq} Hz`;
  });

  audioDurationSlider.addEventListener('input', (e) => {
    activeConfig.audioDuration = parseInt(e.target.value, 10);
    audioDurationVal.textContent = `${activeConfig.audioDuration} ms`;
  });

  audioVolSlider.addEventListener('input', (e) => {
    activeConfig.audioVol = parseInt(e.target.value, 10);
    audioVolVal.textContent = `${activeConfig.audioVol} %`;
  });

  ledBrightnessSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    ledBrightnessVal.textContent = `${val} %`;
    document.documentElement.style.setProperty('--led-bloom', val / 100);
  });

  // Einheiten
  document.querySelectorAll('input[name="speedUnitRadio"]').forEach(r => {
    r.addEventListener('change', (e) => { speedUnit = e.target.value; });
  });

  document.querySelectorAll('input[name="tempUnitRadio"]').forEach(r => {
    r.addEventListener('change', (e) => { tempUnit = e.target.value; });
  });

  // Limiter Multi-Beep
  const limiterMultiBeep = document.getElementById('limiterMultiBeep');
  const limiterSpeedSlider = document.getElementById('limiterSpeedSlider');
  const limiterSpeedVal = document.getElementById('limiterSpeedVal');
  if (limiterMultiBeep) {
    limiterMultiBeep.addEventListener('change', (e) => { activeConfig.limiterMultiBeep = e.target.checked; });
  }
  if (limiterSpeedSlider) {
    limiterSpeedSlider.addEventListener('input', (e) => {
      activeConfig.limiterSpeed = parseInt(e.target.value, 10);
      limiterSpeedVal.textContent = `${activeConfig.limiterSpeed} ms`;
    });
  }

  // Logitech Wheel Hardware Settings
  const wheelHardwareEnabled = document.getElementById('wheelHardwareEnabled');
  const wheelStartRpmSlider = document.getElementById('wheelStartRpmSlider');
  const wheelStartRpmVal = document.getElementById('wheelStartRpmVal');
  const wheelShiftSlider = document.getElementById('wheelShiftSlider');
  const wheelShiftVal = document.getElementById('wheelShiftVal');

  // notifyWheelConfig() ist jetzt global definiert (siehe oben bei den Profil-Funktionen)

  if (wheelHardwareEnabled) {
    wheelHardwareEnabled.addEventListener('change', (e) => {
      activeConfig.wheelHardwareEnabled = e.target.checked;
      notifyWheelConfig();
    });
  }
  if (wheelStartRpmSlider) {
    wheelStartRpmSlider.addEventListener('input', (e) => {
      activeConfig.wheelStartRpm = parseInt(e.target.value, 10);
      wheelStartRpmVal.textContent = `${activeConfig.wheelStartRpm} %`;
      notifyWheelConfig();
    });
  }
  if (wheelShiftSlider) {
    wheelShiftSlider.addEventListener('input', (e) => {
      activeConfig.wheelShift = parseInt(e.target.value, 10);
      wheelShiftVal.textContent = `${activeConfig.wheelShift} %`;
      notifyWheelConfig();
    });
  }

  const wheelFillSelect = document.getElementById('wheelFillSelect');
  if (wheelFillSelect) {
    wheelFillSelect.addEventListener('change', (e) => {
      activeConfig.wheelFill = e.target.value;
      notifyWheelConfig();
    });
  }

  const wheelBlinkSlider = document.getElementById('wheelBlinkSlider');
  const wheelBlinkVal = document.getElementById('wheelBlinkVal');
  if (wheelBlinkSlider) {
    wheelBlinkSlider.addEventListener('input', (e) => {
      activeConfig.wheelBlinkHz = parseInt(e.target.value, 10);
      wheelBlinkVal.textContent = `${activeConfig.wheelBlinkHz} Hz`;
      notifyWheelConfig();
    });
  }

  // LED-Test: Server zählt wheelTest hoch -> die Bridge spielt ein Lauflicht am Lenkrad
  const wheelTestBtn = document.getElementById('wheelTestBtn');
  if (wheelTestBtn) {
    wheelTestBtn.addEventListener('click', () => {
      fetch(apiUrl('/api/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wheelTest: Date.now() })
      }).catch(() => {});
    });
  }
  // UDP Port speichern
  document.getElementById('savePortBtn').addEventListener('click', async () => {
    const port = parseInt(document.getElementById('udpPortInput').value, 10);
    if (!port || port < 1000 || port > 65535) {
      alert('Bitte einen gültigen Port zwischen 1000 und 65535 eingeben.');
      return;
    }
    try {
      const res = await fetch(apiUrl('/api/config'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ port })
      });
      const data = await res.json();
      if (data.success) {
        udpPortDisplay.textContent = `UDP: ${port}`;
        alert(`Forza UDP Port erfolgreich auf ${port} geändert!`);
      }
    } catch (err) {
      alert('Fehler beim Ändern des Ports: ' + err.message);
    }
  });
}

// ------------------------------------------------------------
// Lenkrad: gespeicherte Einstellungen laden + Bridge-Status anzeigen
// ------------------------------------------------------------
async function loadWheelConfigFromServer() {
  try {
    const cfg = await (await fetch(apiUrl('/api/config'))).json();

    // Eigene Profile + zuletzt aktives Profil wiederherstellen
    customProfiles = cfg.customProfiles || {};
    Object.assign(PROFILES, customProfiles);
    if (cfg.profile && PROFILES[cfg.profile]) currentProfileKey = cfg.profile;
    const keep = {
      limiterMultiBeep: activeConfig.limiterMultiBeep,
      limiterSpeed: activeConfig.limiterSpeed
    };
    activeConfig = { ...keep, ...PROFILES[currentProfileKey] };

    // Gespeicherte Lenkrad-Werte haben Vorrang vor den Profil-Vorgaben
    activeConfig.wheelHardwareEnabled = cfg.wheelHardware !== false;
    activeConfig.wheelStartRpm = cfg.wheelStartRpm ?? activeConfig.wheelStartRpm ?? 50;
    activeConfig.wheelShift = cfg.wheelShift ?? activeConfig.wheelShift ?? 88;
    activeConfig.wheelFill = cfg.wheelFill || activeConfig.wheelFill || 'left-right';
    activeConfig.wheelBlinkHz = cfg.wheelBlinkHz ?? activeConfig.wheelBlinkHz ?? 12;
    activeConfig.tyre = cfg.tyre || activeConfig.tyre || 'street';
    activeConfig.launchControlEnabled = cfg.launchControlEnabled !== false;
    updateLcStatusPill(activeConfig.launchControlEnabled);
    document.getElementById('udpPortInput').value = cfg.port || 5300;
    udpPortDisplay.textContent = `UDP: ${cfg.port || 5300}`;

    syncSettingsToInputs();
    rebuildProfileSelect();
    renderTyreBadge();
    webConfigLoaded = true;
  } catch (_) { /* Server noch nicht bereit */ }
}

function startBridgeStatusPolling() {
  const pill = document.getElementById('wheelStatusPill');
  const text = document.getElementById('wheelStatusText');
  if (!pill || !text) return;

  const update = async () => {
    try {
      const s = await (await fetch(apiUrl('/api/bridge-status'))).json();
      if (!s.bridgeRunning) {
        pill.className = 'status-pill waiting';
        text.textContent = 'Lenkrad-Bridge nicht gestartet (Start_ApexShift.bat)';
      } else if (!s.connected) {
        pill.className = 'status-pill waiting';
        text.textContent = 'Bridge läuft, aber kein Lenkrad gefunden';
      } else {
        pill.className = 'status-pill connected';
        text.textContent = 'Lenkrad verbunden – LEDs aktiv';
      }
    } catch (_) {
      pill.className = 'status-pill waiting';
      text.textContent = 'Server nicht erreichbar';
    }
  };
  update();
  setInterval(update, 1500);
}

function syncSettingsToInputs() {
  document.getElementById('fillPatternSelect').value = activeConfig.pattern;
  document.getElementById('startRpmSlider').value = activeConfig.startRpm;
  document.getElementById('startRpmVal').textContent = `${activeConfig.startRpm} %`;
  document.getElementById('warnRpmSlider').value = activeConfig.warnRpm;
  document.getElementById('warnRpmVal').textContent = `${activeConfig.warnRpm} %`;
  document.getElementById('shiftPointSlider').value = activeConfig.shiftPoint;
  document.getElementById('shiftPointVal').textContent = `${activeConfig.shiftPoint} %`;
  document.getElementById('blinkFreqSlider').value = activeConfig.blinkFreq;
  document.getElementById('blinkFreqVal').textContent = `${activeConfig.blinkFreq} Hz`;
  document.getElementById('blinkStyleSelect').value = activeConfig.blinkStyle;

  document.getElementById('audioBeepEnabled').checked = activeConfig.audioEnabled;
  document.getElementById('audioFreqSlider').value = activeConfig.audioFreq;
  document.getElementById('audioFreqVal').textContent = `${activeConfig.audioFreq} Hz`;
  document.getElementById('audioDurationSlider').value = activeConfig.audioDuration;
  document.getElementById('audioDurationVal').textContent = `${activeConfig.audioDuration} ms`;
  document.getElementById('audioVolSlider').value = activeConfig.audioVol;
  document.getElementById('audioVolVal').textContent = `${activeConfig.audioVol} %`;

  if (document.getElementById('limiterMultiBeep')) {
    document.getElementById('limiterMultiBeep').checked = activeConfig.limiterMultiBeep !== false;
    document.getElementById('limiterSpeedSlider').value = activeConfig.limiterSpeed || 110;
    document.getElementById('limiterSpeedVal').textContent = `${activeConfig.limiterSpeed || 110} ms`;
  }

  if (document.getElementById('wheelHardwareEnabled')) {
    document.getElementById('wheelHardwareEnabled').checked = activeConfig.wheelHardwareEnabled !== false;
    document.getElementById('wheelStartRpmSlider').value = activeConfig.wheelStartRpm || 50;
    document.getElementById('wheelStartRpmVal').textContent = `${activeConfig.wheelStartRpm || 50} %`;
    document.getElementById('wheelShiftSlider').value = activeConfig.wheelShift || 88;
    document.getElementById('wheelShiftVal').textContent = `${activeConfig.wheelShift || 88} %`;
    const fillSel = document.getElementById('wheelFillSelect');
    if (fillSel) fillSel.value = activeConfig.wheelFill || 'left-right';
    const blinkSl = document.getElementById('wheelBlinkSlider');
    if (blinkSl) {
      blinkSl.value = activeConfig.wheelBlinkHz ?? 12;
      document.getElementById('wheelBlinkVal').textContent = `${activeConfig.wheelBlinkHz ?? 12} Hz`;
    }
  }
  const tyreSel = document.getElementById('tyreSelect');
  if (tyreSel) tyreSel.value = activeConfig.tyre || 'street';

  document.documentElement.style.setProperty('--led-bloom', activeConfig.ledBloom || 1);
}

// ------------------------------------------------------------
// 7. WEB CLIENT PRÄSENZ (LEDs am Lenkrad an/aus beim Öffnen/Schließen)
// ------------------------------------------------------------
function startWebPresence() {
  // Sofort beim Öffnen anmelden
  fetch(apiUrl('/api/web-ping')).catch(() => {});

  // Alle 800ms Heartbeat senden, solange der Tab geöffnet ist
  const pingInterval = setInterval(() => {
    fetch(apiUrl('/api/web-ping')).catch(() => {});
  }, 800);

  // Sobald der Tab / das Fenster geschlossen wird -> Sofort dem Server Bescheid geben
  const notifyClose = () => {
    try {
      clearInterval(pingInterval);
      if (eventSource) {
        try { eventSource.close(); } catch (_) {}
      }
      const closeEndpoint = apiUrl('/api/web-close');
      if (navigator.sendBeacon) {
        navigator.sendBeacon(closeEndpoint);
      } else {
        fetch(closeEndpoint, { method: 'POST', keepalive: true }).catch(() => {});
      }
    } catch (_) {}
  };

  window.addEventListener('beforeunload', notifyClose);
  window.addEventListener('pagehide', notifyClose);

  // Wenn der Tab wieder sichtbar wird (z. B. nach Wechsel) sofort pingen
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      fetch(apiUrl('/api/web-ping')).catch(() => {});
    }
  });
}

// ------------------------------------------------------------
// 8. SERVER-INFO & FORZA-SETUP (IP & Port automatisch ermitteln)
// ------------------------------------------------------------
async function loadServerInfo() {
  const ipEl = document.getElementById('forzaServerIp');
  const portEl = document.getElementById('forzaServerPort');
  const udpDisplay = document.getElementById('udpPortDisplay');

  // Falls auf GitHub Pages gehostet: Vorschlag oder lokale IP anzeigen
  const isGitHubPages = window.location.hostname.includes('github.io');

  try {
    const res = await fetch(apiUrl('/api/server-info'));
    if (!res.ok) throw new Error('Not available');
    const info = await res.json();

    if (ipEl && info.primaryIp) {
      ipEl.textContent = info.primaryIp;
    }
    if (portEl && info.udpPort) {
      portEl.textContent = info.udpPort;
    }
    if (udpDisplay && info.udpPort) {
      udpDisplay.textContent = `UDP: ${info.udpPort}`;
    }

    setupCopyButtons(info.primaryIp, info.udpPort);
  } catch (_) {
    // Fallback wenn kein Backend direkt auf dieser Domain läuft (z.B. GitHub Pages)
    const fallbackIp = isGitHubPages ? '192.168.2.124' : (window.location.hostname || '127.0.0.1');
    const fallbackPort = 5300;
    if (ipEl) ipEl.textContent = fallbackIp;
    if (portEl) portEl.textContent = fallbackPort;
    if (udpDisplay) udpDisplay.textContent = `UDP: ${fallbackPort}`;
    setupCopyButtons(fallbackIp, fallbackPort);
  }
}

function setupCopyButtons(primaryIp, udpPort) {
  const showCopyFeedback = (el) => {
    if (!el) return;
    el.classList.add('copied');
    setTimeout(() => el.classList.remove('copied'), 1500);
  };

  const ipBox = document.getElementById('forzaIpBox');
  const portBox = document.getElementById('forzaPortBox');
  const copyBtn = document.getElementById('copyForzaBtn');

  if (ipBox) {
    ipBox.onclick = () => {
      if (!primaryIp) return;
      navigator.clipboard.writeText(primaryIp).then(() => showCopyFeedback(ipBox)).catch(() => {});
    };
  }

  if (portBox) {
    portBox.onclick = () => {
      if (!udpPort) return;
      navigator.clipboard.writeText(String(udpPort)).then(() => showCopyFeedback(portBox)).catch(() => {});
    };
  }

  if (copyBtn) {
    copyBtn.onclick = () => {
      const text = `Forza Horizon Einstellungen:\nDatenweitergabe: EIN\nIP-Adresse: ${primaryIp}\nPort: ${udpPort}`;
      navigator.clipboard.writeText(text).then(() => showCopyFeedback(copyBtn)).catch(() => {});
    };
  }
}

// ------------------------------------------------------------
// 9. SERVER PICKER UI (Für andere Städte, Pi oder Lokal)
// ------------------------------------------------------------
function setupServerPicker() {
  const wrap = document.getElementById('serverPickerWrap');
  const btn = document.getElementById('serverPickerBtn');
  const dropdown = document.getElementById('serverPickerDropdown');
  const closeBtn = document.getElementById('serverPickerClose');
  const label = document.getElementById('serverPickerLabel');
  const customInput = document.getElementById('customServerUrlInput');
  const applyBtn = document.getElementById('applyServerUrlBtn');

  if (!btn || !dropdown) return;

  const updateLabel = () => {
    if (!customServerBase || customServerBase === 'auto') {
      label.textContent = 'Server: Auto';
    } else if (customServerBase.includes('192.168.2.124')) {
      label.textContent = 'Server: Pi (192.168.2.124)';
    } else if (customServerBase.includes('localhost') || customServerBase.includes('127.0.0.1')) {
      label.textContent = 'Server: Lokal (PC)';
    } else {
      try {
        const u = new URL(customServerBase);
        label.textContent = `Server: ${u.hostname}`;
      } catch (_) {
        label.textContent = `Server: Eigene IP`;
      }
    }

    // Presets optisch hervorheben
    document.querySelectorAll('.btn-preset').forEach(p => {
      const u = p.dataset.url;
      if ((u === 'auto' && (!customServerBase || customServerBase === 'auto')) || u === customServerBase) {
        p.classList.add('active');
      } else {
        p.classList.remove('active');
      }
    });

    if (customInput && customServerBase && customServerBase !== 'auto') {
      customInput.value = customServerBase;
    }
  };

  updateLabel();

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('hidden');
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', () => dropdown.classList.add('hidden'));
  }

  document.addEventListener('click', (e) => {
    if (wrap && !wrap.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  // Klick auf Preset-Buttons
  document.querySelectorAll('.btn-preset').forEach(preset => {
    preset.addEventListener('click', () => {
      const targetUrl = preset.dataset.url;
      customServerBase = targetUrl;
      localStorage.setItem('apexshift_server_url', targetUrl);
      updateLabel();
      dropdown.classList.add('hidden');
      reconnectAll();
    });
  });

  // Klick auf "Verbinden" bei eigenem Server
  if (applyBtn && customInput) {
    applyBtn.addEventListener('click', () => {
      let val = customInput.value.trim();
      if (!val) return;
      if (!val.startsWith('http://') && !val.startsWith('https://')) {
        val = `http://${val}`;
      }
      customServerBase = val;
      localStorage.setItem('apexshift_server_url', val);
      updateLabel();
      dropdown.classList.add('hidden');
      reconnectAll();
    });
  }
}

function reconnectAll() {
  console.log('[ApexShift] Verbinde neu mit Server:', getApiBaseUrl() || 'Lokaler Ursprung');
  connectTelemetryStream();
  loadWheelConfigFromServer();
  loadServerInfo();
  fetch(apiUrl('/api/web-ping')).catch(() => {});
}

// ------------------------------------------------------------
// 10. STARTUP
// ------------------------------------------------------------
window.addEventListener('DOMContentLoaded', () => {
  initShiftLightLeds();
  initTyrePills();
  setupEventListeners();
  setupServerPicker();
  syncSettingsToInputs();
  connectTelemetryStream();
  loadWheelConfigFromServer();
  startBridgeStatusPolling();
  startWebPresence();
  loadServerInfo();
});

