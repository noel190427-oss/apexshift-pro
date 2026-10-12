// ============================================================
// ApexShift Pro - Forza Telemetry & Shift Light Server
// Zero-Dependency Node.js Backend (UDP Receiver + Web Server)
// ============================================================

import http from 'node:http';
import https from 'node:https';
import dgram from 'node:dgram';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

function getServerIps() {
  const nets = os.networkInterfaces();
  const results = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push(net.address);
      }
    }
  }
  return results.length > 0 ? results : ['127.0.0.1'];
}

// Öffentliche IP (für Spieler außerhalb des Heimnetzes, z. B. Xbox in einer anderen Stadt)
let publicIp = '';
function refreshPublicIp() {
  https.get('https://api.ipify.org', { timeout: 8000 }, (r) => {
    let d = '';
    r.on('data', c => { d += c; });
    r.on('end', () => { if (/^[0-9a-fA-F:.]{3,45}$/.test(d.trim())) publicIp = d.trim(); });
  }).on('error', () => {}).on('timeout', function () { this.destroy(); });
}
refreshPublicIp();
setInterval(refreshPublicIp, 10 * 60 * 1000);

// Konfiguration (wird in config.json gespeichert und beim Start geladen)
const CONFIG_FILE = path.join(__dirname, 'config.json');
let globalConfig = {
  port: 5300,
  wheelHardware: true,   // Lenkrad-LEDs an/aus
  wheelStartRpm: 50,     // ab wieviel % die erste LED angeht
  wheelShift: 88,        // ab wieviel % alle LEDs blinken (Schaltpunkt)
  wheelFill: 'left-right', // left-right | right-left | centre-out | outside-in
  wheelBlinkHz: 12,      // Blinkgeschwindigkeit im Begrenzer
  wheelTest: 0,          // wird vom Test-Button hochgesetzt -> Bridge spielt Lauflicht
  profile: 'porsche',    // aktives Profil
  tyre: 'semi-slick',    // vom Nutzer gewählte Reifenmischung (Forza sendet sie nicht)
  customProfiles: {},    // eigene, vom Nutzer gespeicherte Profile
  launchControlActive: false, // Launch Control Status
  launchControlEnabled: true, // Launch Control per Pedal-Kombi freigegeben (4x Kupplung = aus, 2x Kupplung+1x Bremse = an)
  launchTargetRpm: 65    // Ziel-Drehzahl % für Launch Control
};
try {
  Object.assign(globalConfig, JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')));
  if (globalConfig.launchControlEnabled === undefined) {
    globalConfig.launchControlEnabled = true;
  }
} catch (_) { /* erster Start: Standardwerte */ }

let udpPort = globalConfig.port;
const httpPort = 5305;
let bridgeStatus = { connected: false, mask: 0, circlePressed: false, launchControl: false, updatedAt: 0 };

// Aktuelle Telemetriedaten (Cache für SSE Clients)
let latestTelemetry = {
  isRaceOn: 0,
  timestampMs: 0,
  engineMaxRpm: 8000,
  engineIdleRpm: 900,
  currentEngineRpm: 0,
  rpmPercent: 0,
  speedKmh: 0,
  speedMph: 0,
  gear: 0,
  gearDisplay: 'N',
  accel: 0,
  brake: 0,
  clutch: 0,
  handbrake: 0,
  steer: 0,
  boostBar: 0,
  powerHp: 0,
  torqueNm: 0,
  tireTemp: { fl: 20, fr: 20, rl: 20, rr: 20 },
  tireSlip: { fl: 0, fr: 0, rl: 0, rr: 0 },
  gForce: { lateral: 0, longitudinal: 0 },
  packetsReceived: 0,
  lastPacketTime: 0
};

let packetCounter = 0;
let lastPacketTimestamp = 0;
const sseClients = new Set();
let webHeartbeatLastSeen = 0;
let lastBroadcastWebActive = false;

function isWebUiOpen() {
  // Eine Webseite ist NUR DANN aktiv, wenn innerhalb der letzten 2,5 Sekunden ein Heartbeat-Ping eingetroffen ist!
  // Wir verlassen uns NICHT auf alte TCP-Sockets, da Browser-Verbindungen nach Tab-Schließen oft im System hängen.
  if (webHeartbeatLastSeen === 0) return false;
  return (Date.now() - webHeartbeatLastSeen) < 2500;
}

// ------------------------------------------------------------
// 1. FORZA UDP TELEMETRY PARSER
// ------------------------------------------------------------
function parseForzaPacket(buf) {
  if (buf.length < 232) return null; // Mindestgröße (Sled)

  try {
    const isRaceOn = buf.readInt32LE(0);
    const timestampMs = buf.readUInt32LE(4);
    const engineMaxRpm = Math.max(1000, buf.readFloatLE(8));
    const engineIdleRpm = Math.max(0, buf.readFloatLE(12));
    const currentEngineRpm = Math.max(0, buf.readFloatLE(16));

    // Beschleunigung / G-Kräfte (m/s² -> g)
    const accelX = buf.readFloatLE(20) / 9.80665; // lateral (quer)
    const accelZ = buf.readFloatLE(28) / 9.80665; // longitudinal (längs)

    // Geschwindigkeit aus Vektoren berechnen (m/s)
    const vx = buf.readFloatLE(32);
    const vy = buf.readFloatLE(36);
    const vz = buf.readFloatLE(40);
    const speedMs = Math.hypot(vx, vy, vz);
    const speedKmh = Math.round(speedMs * 3.6);
    const speedMph = Math.round(speedMs * 2.23694);

    // Reifen-Schlupf (0..1+)
    const slipFL = Math.abs(buf.readFloatLE(84) || 0);
    const slipFR = Math.abs(buf.readFloatLE(88) || 0);
    const slipRL = Math.abs(buf.readFloatLE(92) || 0);
    const slipRR = Math.abs(buf.readFloatLE(96) || 0);

    let gear = 0;
    let gearDisplay = 'N';
    let accel = 0;
    let brake = 0;
    let clutch = 0;
    let handbrake = 0;
    let steer = 0;
    let boostBar = 0;
    let powerHp = 0;
    let torqueNm = 0;
    let tireTemp = { fl: 85, fr: 85, rl: 85, rr: 85 };

    // Erweiterte Dash-Felder (Forza Horizon 4/5/6: 324 Bytes, FM: 311 Bytes)
    if (buf.length >= 311) {
      // In Horizon 324-Format liegen Dash-Werte ab Offset 244
      const dashOffset = (buf.length >= 324) ? 244 : 232;

      // Power (Watts) & Torque (Nm) & Boost (PSI)
      if (dashOffset + 24 <= buf.length) {
        powerHp = Math.max(0, Math.round(buf.readFloatLE(dashOffset + 16) / 745.7));
        torqueNm = Math.max(0, Math.round(buf.readFloatLE(dashOffset + 20)));
        // Reifentemperaturen (°F -> °C)
        tireTemp = {
          fl: Math.round((buf.readFloatLE(dashOffset + 24) - 32) * 5 / 9),
          fr: Math.round((buf.readFloatLE(dashOffset + 28) - 32) * 5 / 9),
          rl: Math.round((buf.readFloatLE(dashOffset + 32) - 32) * 5 / 9),
          rr: Math.round((buf.readFloatLE(dashOffset + 36) - 32) * 5 / 9)
        };
        // Boost (PSI -> bar)
        boostBar = Math.max(0, Number((buf.readFloatLE(dashOffset + 40) * 0.0689476).toFixed(2)));
      }

      // Pedal-Inputs & Gang (am Ende des Pakets)
      if (buf.length >= 324) {
        accel = Math.round((buf.readUInt8(315) / 255) * 100);
        brake = Math.round((buf.readUInt8(316) / 255) * 100);
        clutch = Math.round((buf.readUInt8(317) / 255) * 100);
        handbrake = buf.readUInt8(318) > 0 ? 1 : 0;
        gear = buf.readUInt8(319);
        steer = buf.readInt8(320);
      } else if (buf.length >= 311) {
        accel = Math.round((buf.readUInt8(302) / 255) * 100);
        brake = Math.round((buf.readUInt8(303) / 255) * 100);
        clutch = Math.round((buf.readUInt8(304) / 255) * 100);
        handbrake = buf.readUInt8(305) > 0 ? 1 : 0;
        gear = buf.readUInt8(306);
        steer = buf.readInt8(307);
      }

      if (gear === 0) gearDisplay = 'R';
      else if (gear === 11) gearDisplay = 'N';
      else gearDisplay = String(gear);
    }

    const rpmPercent = Math.min(100, Math.max(0, (currentEngineRpm / engineMaxRpm) * 100));

    packetCounter++;
    lastPacketTimestamp = Date.now();

    return {
      isRaceOn,
      timestampMs,
      engineMaxRpm: Math.round(engineMaxRpm),
      engineIdleRpm: Math.round(engineIdleRpm),
      currentEngineRpm: Math.round(currentEngineRpm),
      rpmPercent: Number(rpmPercent.toFixed(1)),
      speedKmh,
      speedMph,
      gear,
      gearDisplay,
      accel,
      brake,
      clutch,
      handbrake,
      steer,
      boostBar,
      powerHp,
      torqueNm,
      tireTemp,
      tireSlip: {
        fl: Number(Math.min(1, slipFL).toFixed(2)),
        fr: Number(Math.min(1, slipFR).toFixed(2)),
        rl: Number(Math.min(1, slipRL).toFixed(2)),
        rr: Number(Math.min(1, slipRR).toFixed(2))
      },
      gForce: {
        lateral: Number(accelX.toFixed(2)),
        longitudinal: Number(accelZ.toFixed(2))
      },
      packetsReceived: packetCounter,
      lastPacketTime: lastPacketTimestamp
    };
  } catch (err) {
    return null;
  }
}

// ------------------------------------------------------------
// PEDAL-KOMBINATIONEN FÜR LAUNCH CONTROL
// - 4x Kupplung schnell hintereinander -> Launch Control SPERREN / DEAKTIVIEREN
// - 2x Kupplung + 1x Bremse schnell -> Launch Control FREIGEBEN / AKTIVIEREN
// ------------------------------------------------------------
let pedalHistory = [];
let lastClutchState = false;
let lastBrakeState = false;

function processPedalPatterns(clutch, brake) {
  const now = Date.now();
  // Veraltete Pedal-Eingaben (> 2800 ms) verwerfen
  pedalHistory = pedalHistory.filter(entry => now - entry.time < 2800);

  // Kupplung Flankenerkennung (> 35% gedrückt, < 15% losgelassen)
  const clutchDown = (clutch || 0) > 35;
  if (clutchDown && !lastClutchState) {
    pedalHistory.push({ type: 'clutch', time: now });
    checkPedalCombos(now);
  } else if (!clutchDown && (clutch || 0) < 15) {
    lastClutchState = false;
  }
  if (clutchDown) lastClutchState = true;

  // Bremse Flankenerkennung (> 35% gedrückt, < 15% losgelassen)
  const brakeDown = (brake || 0) > 35;
  if (brakeDown && !lastBrakeState) {
    pedalHistory.push({ type: 'brake', time: now });
    checkPedalCombos(now);
  } else if (!brakeDown && (brake || 0) < 15) {
    lastBrakeState = false;
  }
  if (brakeDown) lastBrakeState = true;
}

function checkPedalCombos(now) {
  const types = pedalHistory.map(p => p.type);
  const n = types.length;

  // 1. "2x Kupplung + 1x Bremse" -> Launch Control AKTIVIEREN
  if (n >= 3 &&
      types[n - 3] === 'clutch' &&
      types[n - 2] === 'clutch' &&
      types[n - 1] === 'brake') {
    globalConfig.launchControlEnabled = true;
    pedalHistory = [];
    fs.writeFile(CONFIG_FILE, JSON.stringify(globalConfig, null, 2), () => {});
    console.log('⚡ [Launch Control] Freigegeben per Pedal-Kombi: 2x Kupplung + 1x Bremse!');
    latestTelemetry.launchControlEnabled = true;
    broadcastTelemetry({
      ...latestTelemetry,
      launchControlEnabled: true,
      lcNotification: 'enabled',
      lcNotificationTime: now
    });
    return;
  }

  // 2. "4x Kupplung" -> Launch Control SPERREN / DEAKTIVIEREN
  if (n >= 4 &&
      types[n - 4] === 'clutch' &&
      types[n - 3] === 'clutch' &&
      types[n - 2] === 'clutch' &&
      types[n - 1] === 'clutch') {
    globalConfig.launchControlEnabled = false;
    pedalHistory = [];
    fs.writeFile(CONFIG_FILE, JSON.stringify(globalConfig, null, 2), () => {});
    console.log('🚫 [Launch Control] Gesperrt per Pedal-Kombi: 4x Kupplung!');
    latestTelemetry.launchControlEnabled = false;
    broadcastTelemetry({
      ...latestTelemetry,
      launchControlEnabled: false,
      lcNotification: 'disabled',
      lcNotificationTime: now
    });
    return;
  }
}

// ------------------------------------------------------------
// 2. UDP SOCKET SETUP
// ------------------------------------------------------------
let udpSocket = null;

function setupUdp(port) {
  if (udpSocket) {
    try { udpSocket.close(); } catch (_) {}
  }

  udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  udpSocket.on('message', (msg) => {
    const data = parseForzaPacket(msg);
    if (data) {
      processPedalPatterns(data.clutch, data.brake);
      latestTelemetry = {
        ...data,
        launchControlEnabled: globalConfig.launchControlEnabled !== false
      };
      broadcastTelemetry(latestTelemetry);
    }
  });

  udpSocket.on('error', (err) => {
    console.error(`[UDP Error] Port ${port}:`, err.message);
  });

  udpSocket.bind(port, '0.0.0.0', () => {
    console.log(`[UDP Ready] Hört auf 0.0.0.0:${port} für Forza Telemetriedaten`);
  });
}

function broadcastTelemetry(data) {
  if (sseClients.size === 0) return;
  const enriched = {
    ...data,
    webActive: isWebUiOpen(),
    launchControlEnabled: globalConfig.launchControlEnabled !== false,
    bridge: {
      circlePressed: !!bridgeStatus.circlePressed,
      launchControl: !!bridgeStatus.launchControl,
      connected: !!bridgeStatus.connected,
      wheel: bridgeStatus.wheel || ''
    }
  };
  const payload = `data: ${JSON.stringify(enriched)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (_) {
      sseClients.delete(client);
    }
  }
}

// ------------------------------------------------------------
// 3. HTTP SERVER & SSE STREAMING
// ------------------------------------------------------------
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  // CORS Preflight für Web-Zugriffe von GitHub Pages / externen Domains
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  // SSE Telemetry Stream
  if (url.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    const initial = {
      ...latestTelemetry,
      bridge: {
        circlePressed: !!bridgeStatus.circlePressed,
        launchControl: !!bridgeStatus.launchControl,
        connected: !!bridgeStatus.connected,
        wheel: bridgeStatus.wheel || ''
      }
    };
    res.write(`data: ${JSON.stringify(initial)}\n\n`);
    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });
    return;
  }

  // Heartbeat / Ping wenn Webseite offen ist oder geschlossen wird
  if (url.pathname === '/api/web-ping') {
    const wasActive = isWebUiOpen();
    webHeartbeatLastSeen = Date.now();
    if (!wasActive) {
      lastBroadcastWebActive = true;
      latestTelemetry.webActive = true;
      broadcastTelemetry(latestTelemetry);
      console.log('[Web Präsenz] Webseite geöffnet -> LEDs aktiviert');
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"ok":true,"webActive":true}');
    return;
  }

  if (url.pathname === '/api/web-close') {
    webHeartbeatLastSeen = 0; // Sofort als geschlossen markieren
    lastBroadcastWebActive = false;
    latestTelemetry.webActive = false;
    broadcastTelemetry(latestTelemetry);
    console.log('[Web Präsenz] Webseite geschlossen -> LEDs ausgeschaltet');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end('{"ok":true,"webActive":false}');
    return;
  }

  // Server-Info: Liefert IP-Adresse und Port, die man in Forza Horizon eingeben muss
  if (url.pathname === '/api/server-info') {
    const ips = getServerIps();
    const hostHeader = (req.headers.host || '').split(':')[0];
    const bestIp = ips.includes(hostHeader) ? hostHeader : ips[0];
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      primaryIp: bestIp,
      publicIp: publicIp,
      allIps: ips,
      udpPort: udpPort,
      httpPort: httpPort,
      forzaSettings: {
        dataOut: 'EIN',
        ipAddress: bestIp,
        port: udpPort
      }
    }));
    return;
  }

  // Status & Telemetry Snapshot
  if (url.pathname === '/api/telemetry') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ...latestTelemetry,
      webActive: isWebUiOpen(),
      bridge: {
        circlePressed: !!bridgeStatus.circlePressed,
        launchControl: !!bridgeStatus.launchControl,
        connected: !!bridgeStatus.connected,
        wheel: bridgeStatus.wheel || ''
      }
    }));
    return;
  }

  // Globale Konfiguration (auch für Logitech Bridge)
  if (url.pathname === '/api/config' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
      ...globalConfig,
      webActive: isWebUiOpen(),
      sseClientsCount: sseClients.size,
      heartbeatAgeMs: webHeartbeatLastSeen === 0 ? -1 : (Date.now() - webHeartbeatLastSeen)
    }));
    return;
  }

  // Konfiguration ändern (z. B. UDP Port, Lenkrad Schwellenwerte) - wird dauerhaft gespeichert
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const config = JSON.parse(body);
        for (const key of Object.keys(config)) {
          if (key in globalConfig) globalConfig[key] = config[key];
        }
        if (config.port && parseInt(config.port, 10) !== udpPort) {
          udpPort = parseInt(config.port, 10);
          globalConfig.port = udpPort;
          setupUdp(udpPort);
        }
        fs.writeFile(CONFIG_FILE, JSON.stringify(globalConfig, null, 2), () => {});
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        res.end(JSON.stringify({ success: true, ...globalConfig }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Simulator-Telemetrie vom Web-Frontend direkt einspeisen (damit auch im Test-Modus die Lenkrad-LEDs reagieren!)
  if (url.pathname === '/api/sim-telemetry' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const simData = JSON.parse(body);
        if (simData.clutch !== undefined || simData.brake !== undefined) {
          processPedalPatterns(simData.clutch, simData.brake);
        }
        latestTelemetry = {
          ...latestTelemetry,
          ...simData,
          launchControlEnabled: globalConfig.launchControlEnabled !== false
        };
        broadcastTelemetry(latestTelemetry);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (_) {
        res.writeHead(400);
        res.end('{"ok":false}');
      }
    });
    return;
  }

  // Status der Lenkrad-Bridge (die Bridge meldet sich hier regelmäßig)
  if (url.pathname === '/api/bridge-status' && req.method === 'GET') {
    const alive = Date.now() - bridgeStatus.updatedAt < 5000;
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({ ...bridgeStatus, bridgeRunning: alive }));
    return;
  }

  if (url.pathname === '/api/bridge-status' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        bridgeStatus = { ...JSON.parse(body), updatedAt: Date.now() };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      } catch (e) {
        res.writeHead(400);
        res.end('{"ok":false}');
      }
    });
    return;
  }

  // Statische Dateien servieren
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        // Fallback zu index.html
        fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e, fallback) => {
          if (e) {
            res.writeHead(404);
            res.end('Not Found');
          } else {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(fallback);
          }
        });
      } else {
        res.writeHead(500);
        res.end('Internal Server Error');
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    }
  });
});

// Regelmäßiger Prüf-Takt: Sobald der Heartbeat länger als 2,5s ausbleibt, LEDs per Broadcast ausschalten
setInterval(() => {
  const currentActive = isWebUiOpen();
  if (currentActive !== lastBroadcastWebActive) {
    lastBroadcastWebActive = currentActive;
    latestTelemetry.webActive = currentActive;
    broadcastTelemetry(latestTelemetry);
    if (!currentActive) {
      console.log('[Web Präsenz] Heartbeat abgelaufen (Webseite geschlossen) -> webActive: false');
    }
  }
}, 400);

// Starten
setupUdp(udpPort);

server.listen(httpPort, () => {
  console.log(`====================================================`);
  console.log(`  🏎️  ApexShift Pro - Forza Telemetry Dashboard`);
  console.log(`====================================================`);
  console.log(`  Web-Oberfläche : http://localhost:${httpPort}`);
  console.log(`  Forza UDP Port : ${udpPort}`);
  console.log(`====================================================`);
});

