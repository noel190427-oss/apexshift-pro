# 🏎️ ApexShift Pro — Forza Horizon & Motorsport Telemetry Suite

[![Platform: Windows & Linux](https://img.shields.io/badge/Platform-Windows%20%7C%20Linux%20%7C%20Raspberry%20Pi-blue.svg)](#)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero%20(Pure%20Node.js)-success.svg)](#)
[![Hardware](https://img.shields.io/badge/Hardware-Logitech%20G923%20%2F%20G29-orange.svg)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

**ApexShift Pro** ist ein professionelles, browserbasiertes Telemetrie-Dashboard mit digitaler Schaltblitz-Anzeige (authentischer Logitech G923 / G29 Replica), Launch Control Suite, Reifenmanagement und nativer USB-HID Hardware-Ansteuerung der echten RPM-Lichter am Logitech-Lenkrad.

Konzipiert für **jeden Sim-Racer**: Kann entweder **komplett autark auf einem Raspberry Pi im Heimnetzwerk** laufen (Server) oder direkt lokal auf dem Gaming-PC.

---

## ✨ Features

- **🌐 Null Abhängigkeiten (Zero-Dependency)**: Server läuft mit reinem Node.js ohne `npm install` oder fremde Packages.
- **📡 Automatische IP & Port Erkennung**: Das Dashboard zeigt oben sofort im Motorsport-Banner an, welche IP und welcher Port im Spiel eingetragen werden müssen.
- **🚨 Logitech G923 & G29 Hardware LED Support**:
  - Steuert die echten physischen RPM-LEDs am Lenkrad per direktem USB-HID an.
  - **Auto-Power-Off**: Die LEDs gehen sofort an, wenn die Webseite geöffnet wird, und schalten sich automatisch ab, sobald der Browser geschlossen wird!
- **⏱️ Launch Control & Timer Suite**:
  - Timer startet präzise beim Loslassen des KREIS-Knopfs (oder Kupplung) und stoppt automatisch bei der ersten Bremsung.
  - **Pedal-Kombinationen zum Entsperren & Sperren**:
    - **4x Kupplung schnell hintereinander**: Launch Control wird gesperrt (deaktiviert).
    - **2x Kupplung + 1x Bremse schnell hintereinander**: Launch Control wird wieder entsperrt/aktiviert.
- **🛞 Reifentemperatur & Reifenmischungen**: 
  - Separates, schwebendes Reifenfenster mit Live-Druck und Temperatur (FL, FR, RL, RR).
  - Unterstützt Semi-Slick, Drag-Slick, Drift, Regenreifen und Street.
- **🎨 Voll anpassbar**:
  - Eigene Profile speichern (Porsche GT3, Formula, BMW M, etc.).
  - Einstellbare Schwellenwerte, Füllmuster (links-rechts, Mitte-außen, etc.) und Drehzahlbegrenzer-Blinken.

---

## 🎮 Forza Horizon Einrichtung (Im Spiel)

Öffne in **Forza Horizon 4 / 5** oder **Forza Motorsport**:
1. **Einstellungen** ➔ **HUD und Gameplay**
2. Scrolle ganz nach unten zu **Daten-Ausgabe (Data Out)**:
   - **Daten-Ausgabe**: `EIN`
   - **Daten-Ausgabe IP-Adresse**: Die IP, die oben auf dem ApexShift-Dashboard angezeigt wird (z. B. `192.168.2.124` für den Pi oder `127.0.0.1` lokal)
   - **Daten-Ausgabe IP-Port**: `5300`

---

## 🚀 Installation & Start

### Option A: Raspberry Pi Server (Empfohlen)

Der Server läuft 24/7 autark auf deinem Raspberry Pi im Netzwerk. Jedes Handy, Tablet oder PC kann das Dashboard über `http://<PI-IP>:5305` öffnen!

1. **Repository auf den Pi klonen**:
   ```bash
   git clone https://github.com/DEIN-NUTZERNAME/apexshift-pro.git
   cd apexshift-pro
   ```
2. **Server starten**:
   ```bash
   node server.mjs
   ```
3. **Als System-Dienst (Autostart beim Booten)**:
   ```bash
   sudo cp apexshift.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable apexshift
   sudo systemctl start apexshift
   ```

### Option B: Direkt auf dem Gaming-PC (Windows)

1. **Voraussetzungen**:
   - [Node.js](https://nodejs.org/) (Version 18 oder neuer)
   - [Python 3](https://www.python.org/) (für die Logitech Hardware-LEDs)
2. **Starten**:
   - Doppelklick auf `Start_ApexShift.bat`.
   - Modus `[1]` für Verbindung zum Pi-Server oder `[2]` für lokalen Server wählen.

---

## 🔌 Logitech Hardware-Bridge

Wenn du am PC ein Logitech G923 oder G29 Lenkrad nutzt:
- Starte `python -u logitech_hardware_bridge.py`.
- Die Bridge findet die Server-Adresse automatisch über `server_host.txt`, `--host=<IP>` oder `APEXSHIFT_SERVER=<IP>`.

---

## 📄 Lizenz

Dieses Projekt ist unter der [MIT-Lizenz](LICENSE) veröffentlicht.
