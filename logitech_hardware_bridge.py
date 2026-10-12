# ============================================================
# ApexShift Pro - Logitech G923 / G29 RPM-LED Bridge
#
# Verbindet die Webseite/den Server (http://localhost:5305) mit den
# echten RPM-Lichtern am Lenkrad:
#   Forza -> UDP -> server.mjs -> (diese Bridge) -> USB-HID -> Lenkrad-LEDs
#
# - Drehzahl kommt live vom Server (SSE /api/stream)
# - Einstellungen (Start-%, Schalt-%, Füllmuster, Blinktempo, An/Aus,
#   Test-Lauflicht) kommen von der Webseite (/api/config)
# - Watchdog: Pause/Menü/Datenabbruch -> LEDs sofort aus (kein Hängenbleiben)
# ============================================================

import atexit
import ctypes
import json
import math
import os
import sys
import threading
import time
import urllib.request
import winreg
from ctypes import wintypes

# Server-Adresse bestimmen (Lokal oder z. B. Raspberry Pi im Netzwerk)
server_host = os.environ.get("APEXSHIFT_SERVER", "")
for i, arg in enumerate(sys.argv):
    if arg in ("--host", "--server") and i + 1 < len(sys.argv):
        server_host = sys.argv[i + 1]
    elif arg.startswith("--host="):
        server_host = arg.split("=", 1)[1]
    elif arg.startswith("--server="):
        server_host = arg.split("=", 1)[1]

if not server_host and os.path.exists("server_host.txt"):
    try:
        with open("server_host.txt", "r") as f:
            server_host = f.read().strip()
    except Exception:
        pass

if not server_host:
    server_host = "127.0.0.1"

if not server_host.startswith("http://") and not server_host.startswith("https://"):
    if ":" in server_host:
        BASE = f"http://{server_host}"
    else:
        BASE = f"http://{server_host}:5305"
else:
    BASE = server_host

STALE_AFTER = 0.7          # Sek. ohne Telemetrie -> LEDs aus
LOOP_HZ = 90               # wie oft die LED-Logik läuft

# Unterstützte Räder (USB Product IDs): G923 PS/PC, G923 Xbox/PC, G29
WHEEL_PIDS = ("PID_C266", "PID_C267", "PID_C26D", "PID_C26E", "PID_C24F", "PID_C294")
HID_CLASS_GUID = r"{4D1E55B2-F16F-11CF-88CB-001111000030}"

GENERIC_READ, GENERIC_WRITE = 0x80000000, 0x40000000
SHARE_RW, OPEN_EXISTING = 3, 3
INVALID = ctypes.c_void_p(-1).value

kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
kernel32.CreateFileW.restype = ctypes.c_void_p
kernel32.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                 ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p]
kernel32.WriteFile.argtypes = [ctypes.c_void_p, ctypes.c_void_p, wintypes.DWORD,
                               ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
kernel32.CreateMutexW.restype = ctypes.c_void_p
kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]

hid = ctypes.WinDLL("hid")

class OVERLAPPED(ctypes.Structure):
    _fields_ = [
        ("Internal", ctypes.c_void_p),
        ("InternalHigh", ctypes.c_void_p),
        ("Offset", wintypes.DWORD),
        ("OffsetHigh", wintypes.DWORD),
        ("hEvent", wintypes.HANDLE)
    ]


def log(msg):
    try:
        print(time.strftime("[%H:%M:%S] ") + msg, flush=True)
    except Exception:
        safe_msg = msg.encode("ascii", errors="replace").decode("ascii")
        print(time.strftime("[%H:%M:%S] ") + safe_msg, flush=True)


# ------------------------------------------------------------
# Nur eine Bridge gleichzeitig
# ------------------------------------------------------------
_mutex = kernel32.CreateMutexW(None, False, "ApexShiftLogitechBridge")
if ctypes.get_last_error() == 183:   # ERROR_ALREADY_EXISTS
    log("Bridge läuft bereits - beende diese zweite Instanz.")
    sys.exit(0)


# ------------------------------------------------------------
# Lenkrad finden / öffnen
# ------------------------------------------------------------
def find_wheel_paths():
    """Liefert die HID-Gerätepfade des Rads (zuerst die Haupt-Schnittstelle MI_00)."""
    paths = []
    try:
        key = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                             r"SYSTEM\CurrentControlSet\Control\DeviceClasses\\" + HID_CLASS_GUID)
    except OSError:
        return paths
    i = 0
    while True:
        try:
            sub = winreg.EnumKey(key, i)
        except OSError:
            break
        i += 1
        up = sub.upper()
        if "VID_046D" in up and any(pid in up for pid in WHEEL_PIDS):
            # Registry-Name: "##?#HID#VID_...#{guid}"  ->  Pfad: "\\?\HID#VID_...#{guid}"
            # WICHTIG: die '#' müssen bleiben, sonst findet Windows das Gerät nicht!
            paths.append("\\\\?\\" + sub[4:])
    winreg.CloseKey(key)
    paths.sort(key=lambda p: 0 if "MI_00" in p.upper() else 1)
    return paths


class Wheel:
    def __init__(self):
        self.handle = None
        self.h_read = None
        self.pp_data = None
        self.name = ""
        self.circle_pressed = False
        self.reader_running = False

    def open(self):
        for p in find_wheel_paths():
            h = kernel32.CreateFileW(p, GENERIC_WRITE, SHARE_RW,
                                     None, OPEN_EXISTING, 0, None)
            if h and h != INVALID:
                # Test-Schreibvorgang: nur die Schnittstelle, die LED-Reports annimmt, ist die richtige
                if self._write_raw(h, 0x00):
                    self.handle = h
                    self.name = p.split("#")[1] if "#" in p else p
                    self._open_reader(p)
                    return True
                kernel32.CloseHandle(h)
        return False

    def _open_reader(self, p):
        try:
            self.h_read = kernel32.CreateFileW(p, GENERIC_READ, SHARE_RW,
                                               None, OPEN_EXISTING, 0x40000000, None) # FILE_FLAG_OVERLAPPED
            if self.h_read and self.h_read != INVALID:
                pp = ctypes.c_void_p()
                if hid.HidD_GetPreparsedData(self.h_read, ctypes.byref(pp)):
                    self.pp_data = pp
                if not self.reader_running:
                    self.reader_running = True
                    threading.Thread(target=self._read_loop, daemon=True).start()
        except Exception as e:
            log(f"Hinweis: Tasten-Reader konnte nicht initialisiert werden: {e}")

    def _read_loop(self):
        buf = (ctypes.c_ubyte * 64)()
        read_bytes = wintypes.DWORD(0)
        ov = OVERLAPPED()
        ov.hEvent = kernel32.CreateEventW(None, True, False, None)

        while True:
            if not self.h_read or self.h_read == INVALID or not self.pp_data:
                time.sleep(0.4)
                continue
            try:
                kernel32.ResetEvent(ov.hEvent)
                kernel32.ReadFile(self.h_read, buf, 64, ctypes.byref(read_bytes), ctypes.byref(ov))
                res = kernel32.WaitForSingleObject(ov.hEvent, 100)
                if res == 0:
                    kernel32.GetOverlappedResult(self.h_read, ctypes.byref(ov), ctypes.byref(read_bytes), False)
                    if read_bytes.value > 0:
                        usage_list = (ctypes.c_ushort * 32)()
                        usage_len = wintypes.ULONG(32)
                        hid.HidP_GetUsages(0, 0x0009, 0, usage_list, ctypes.byref(usage_len), self.pp_data, buf, read_bytes.value)
                        usages = [usage_list[i] for i in range(usage_len.value)]
                        # Taste 3 = Kreis (PlayStation) / B (Xbox), Taste 2 als Fallback
                        self.circle_pressed = (3 in usages or 2 in usages)
                else:
                    kernel32.CancelIo(self.h_read)
            except Exception:
                time.sleep(0.1)

    @staticmethod
    def _write_raw(handle, mask):
        # Report: [ReportID 0x00][0xF8][0x12][LED-Maske][...auf 17 Byte aufgefüllt]
        report = (ctypes.c_ubyte * 17)(0x00, 0xF8, 0x12, mask & 0x1F)
        written = wintypes.DWORD(0)
        ok = kernel32.WriteFile(handle, report, 17, ctypes.byref(written), None)
        return bool(ok) and written.value == 17

    def write(self, mask):
        if not self.handle:
            return False
        if self._write_raw(self.handle, mask):
            return True
        self.close()      # Rad abgesteckt / G HUB Neustart -> später neu verbinden
        return False

    def close(self):
        if self.handle:
            kernel32.CloseHandle(self.handle)
        if self.h_read and self.h_read != INVALID:
            kernel32.CloseHandle(self.h_read)
        if self.pp_data:
            try:
                hid.HidD_FreePreparsedData(self.pp_data)
            except Exception:
                pass
        self.handle = None
        self.h_read = None
        self.pp_data = None
        self.circle_pressed = False


wheel = Wheel()


@atexit.register
def _leds_off_on_exit():
    try:
        wheel.write(0)
    except Exception:
        pass


# ------------------------------------------------------------
# Server-Anbindung (Telemetrie + Einstellungen + Status)
# ------------------------------------------------------------
telemetry = {"data": None, "time": 0.0}
config = {"wheelHardware": True, "wheelStartRpm": 50, "wheelShift": 88,
          "wheelFill": "left-right", "wheelBlinkHz": 12, "wheelTest": 0}
state = {"mask": 0}


def telemetry_thread():
    while True:
        try:
            req = urllib.request.Request(BASE + "/api/stream", headers={"User-Agent": "ApexShift-Bridge"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                for raw in resp:
                    line = raw.decode("utf-8", "ignore").strip()
                    if line.startswith("data:"):
                        try:
                            telemetry["data"] = json.loads(line[5:])
                            telemetry["time"] = time.time()
                        except ValueError:
                            pass
        except Exception:
            telemetry["data"] = None
            time.sleep(1)


def config_thread():
    while True:
        try:
            with urllib.request.urlopen(BASE + "/api/config", timeout=3) as resp:
                config.update(json.loads(resp.read().decode("utf-8")))
        except Exception:
            pass
        try:
            body = json.dumps({
                "connected": wheel.handle is not None,
                "wheel": wheel.name,
                "mask": state["mask"],
                "circlePressed": wheel.circle_pressed,
                "launchControl": state.get("launchControl", False)
            }).encode()
            req = urllib.request.Request(BASE + "/api/bridge-status", data=body, method="POST",
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=3).read()
        except Exception:
            pass
        time.sleep(0.5)


# ------------------------------------------------------------
# LED-Logik
# ------------------------------------------------------------
# Schritte, in denen sich die LEDs füllen (Bit0 = aeusseres Paar ... Bit4 = mittleres Paar (10 LEDs, gespiegelt))
FILL_STEPS = {
    "left-right":  [0b00001, 0b00011, 0b00111, 0b01111, 0b11111],
    "right-left":  [0b10000, 0b11000, 0b11100, 0b11110, 0b11111],
    "centre-out":  [0b10000, 0b11000, 0b11100, 0b11110, 0b11111],
    "outside-in":  [0b00001, 0b00011, 0b00111, 0b01111, 0b11111],
}
FULL = 0b11111


def compute_mask(now):
    if not config.get("wheelHardware", True):
        return 0

    # BEDIENUNG: LEDs gehen NUR AN, wenn die Webseite geöffnet ist!
    # Wenn die Webseite geschlossen wird, gehen alle LEDs am Lenkrad sofort aus (mask = 0).
    t = telemetry["data"]
    web_active = config.get("webActive", False) or (t and t.get("webActive", False))
    if not web_active:
        return 0

    if t is None or now - telemetry["time"] > STALE_AFTER:
        return 0                              # Watchdog: keine Daten -> aus
    if not t.get("isRaceOn"):
        return 0                              # Pause / Menü -> aus

    pct = float(t.get("rpmPercent", 0.0))
    accel = float(t.get("accel", 0.0))

    # Launch-Control: Knopf Kreis + Gas (NUR wenn freigegeben; 4x Kupplung sperrt es!)
    lc_enabled = config.get("launchControlEnabled", True)
    if t and "launchControlEnabled" in t:
        lc_enabled = bool(t["launchControlEnabled"])

    is_lc = lc_enabled and (wheel.circle_pressed or config.get("launchControlActive", False)) and accel > 25
    state["launchControl"] = is_lc
    if is_lc:
        target_rpm = float(config.get("launchTargetRpm", 65))
        lc_progress = min(1.0, max(0.0, pct / max(10.0, target_rpm)))
        steps = FILL_STEPS.get(config.get("wheelFill"), FILL_STEPS["left-right"])
        idx = min(len(steps) - 1, int(lc_progress * len(steps)))
        if lc_progress >= 0.95:
            # Staging-Blinken sobald Launch-Drehzahl gehalten wird
            return FULL if int(now * 14 * 2) % 2 == 0 else (steps[-2] if len(steps) > 1 else 0)
        return steps[idx]

    start = float(config.get("wheelStartRpm", 50))
    shift = max(start + 1.0, float(config.get("wheelShift", 88)))

    if pct < start:
        return 0
    if pct >= shift:                          # Schaltblitz / Begrenzer
        hz = max(2.0, float(config.get("wheelBlinkHz", 12)))
        return FULL if int(now * hz * 2) % 2 == 0 else 0

    steps = FILL_STEPS.get(config.get("wheelFill"), FILL_STEPS["left-right"])
    progress = (pct - start) / (shift - start)
    idx = min(len(steps) - 1, int(progress * len(steps)))
    return steps[idx]


def run_test_sweep():
    """Lauflicht + Blinken, damit man sofort sieht, dass das Lenkrad reagiert."""
    log("LED-Test: Lauflicht")
    for mask in [1, 3, 7, 15, 31]:
        wheel.write(mask)
        time.sleep(0.15)
    for _ in range(4):
        wheel.write(FULL)
        time.sleep(0.09)
        wheel.write(0)
        time.sleep(0.09)


# ------------------------------------------------------------
# Hauptschleife
# ------------------------------------------------------------
def main():
    log("ApexShift Lenkrad-Bridge gestartet.")
    threading.Thread(target=telemetry_thread, daemon=True).start()
    threading.Thread(target=config_thread, daemon=True).start()

    time.sleep(0.8)  # erste Config abwarten
    last_test = config.get("wheelTest", 0)
    last_mask = None
    next_retry = 0.0
    announced = False
    was_web_active = False

    while True:
        now = time.time()

        if not wheel.handle and now >= next_retry:
            next_retry = now + 2.0
            if wheel.open():
                log(f"Lenkrad verbunden: {wheel.name}")
                announced = True
                last_mask = None
            elif not announced:
                log("Kein Logitech-Lenkrad gefunden - suche weiter ...")
                announced = True

        if wheel.handle:
            if config.get("wheelTest", 0) != last_test:
                last_test = config.get("wheelTest", 0)
                run_test_sweep()
                last_mask = None

            t = telemetry["data"]
            current_web_active = bool(config.get("webActive", False) or (t and t.get("webActive", False)))

            # Wenn die Webseite NICHT geöffnet/aktiv ist -> LEDs am Lenkrad SOFORT AUS
            if not current_web_active:
                if was_web_active or last_mask != 0:
                    wheel.write(0)
                    last_mask = 0
                    state["mask"] = 0
                    log("Webseite nicht aktiv -> Lenkrad RPM-Lichter AUS (mask=0)")
                was_web_active = False
                time.sleep(1.0 / LOOP_HZ)
                continue

            # Webseite ist aktiv:
            if not was_web_active:
                log("Webseite geoeffnet -> Lenkrad RPM-Lichter aktiviert!")
                run_test_sweep()
                last_mask = None
                was_web_active = True

            mask = compute_mask(now)
            blinking = mask in (0, FULL) and telemetry["data"] and \
                float(telemetry["data"].get("rpmPercent", 0)) >= float(config.get("wheelShift", 88))
            if mask != last_mask or blinking:
                if wheel.write(mask):
                    last_mask = mask
                    state["mask"] = mask
                else:
                    log("Verbindung zum Lenkrad verloren - verbinde neu ...")
                    announced = False
        time.sleep(1.0 / LOOP_HZ)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    finally:
        wheel.write(0)
        wheel.close()
        log("Bridge beendet, LEDs aus.")
