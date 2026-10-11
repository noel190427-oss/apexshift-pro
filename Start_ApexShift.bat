@echo off
title ApexShift Pro - Launcher
cd /d "%~dp0"
echo ====================================================================
echo   ApexShift Pro - Forza Horizon 4 / 5 / Motorsport Live Suite
echo ====================================================================
echo.
echo Waehle deinen Modus:
echo   [1] Raspberry Pi Server (Empfohlen - Pi laeuft im Netzwerk)
echo   [2] Lokaler Server (Server + Web-Dashboard direkt auf diesem PC)
echo.
set /p MODE="Auswahl (1 oder 2, Standard ist 1): "

if "%MODE%"=="2" goto LOCAL_MODE

:PI_MODE
set SERVER_IP=192.168.2.124
if exist server_host.txt (
  set /p SERVER_IP=<server_host.txt
)
echo.
echo ====================================================================
echo [Pi Modus] Verbinde mit Server auf %SERVER_IP% ...
echo ====================================================================
echo [1] Starte Logitech Lenkrad-Bridge (verbindet zu http://%SERVER_IP%:5305) ...
start "ApexShift Lenkrad-Bridge" /min python -u logitech_hardware_bridge.py --host=%SERVER_IP%
echo [2] Oeffne Web-Dashboard im Browser (http://%SERVER_IP%:5305) ...
start "" "http://%SERVER_IP%:5305"
echo.
echo Fertig! In Forza Horizon eingeben:
echo   IP:   %SERVER_IP%
echo   Port: 5300
echo.
echo Lenkrad-Bridge laeuft im Hintergrund. Zum Beenden druecke eine Taste.
pause >nul
exit /b

:LOCAL_MODE
echo.
echo ====================================================================
echo [Lokaler Modus] Starte Server lokal auf diesem PC ...
echo ====================================================================
echo [1] Starte Logitech Lenkrad-Bridge ...
start "ApexShift Lenkrad-Bridge" /min python -u logitech_hardware_bridge.py --host=127.0.0.1
echo [2] Oeffne Web-Dashboard (http://localhost:5305) ...
start "" "http://localhost:5305"
echo [3] Starte Node.js Server ...
node server.mjs
pause
