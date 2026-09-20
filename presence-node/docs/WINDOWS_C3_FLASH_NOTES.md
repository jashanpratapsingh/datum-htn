# Building and flashing ESPectre on Windows (ESP32-C3)

Practical notes from getting a from-scratch Windows 11 machine to a flashed,
provisioned, working ESP32-C3 running the Native frontend. `docs/CLI.md` and
`docs/SETUP.md` are the general references; this file is only the
Windows-specific gotchas that aren't obvious from them.

## One-time setup

```powershell
cd espectre
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Do this and everything below **in native PowerShell or cmd, not Git Bash**.
ESP-IDF's tools installer explicitly refuses to run under MSYS/MinGW
(`ERROR: MSys/Mingw is not supported`), and Git Bash on Windows is MSYS. The
`.venv` itself is fine to create from anywhere; it's the ESP-IDF toolchain
provisioning and build steps that need a real Windows shell.

Two environment variables are worth setting for the whole session before
building anything:

```powershell
$env:PYTHONUTF8 = "1"
$env:ESPHOME_ESP_IDF_PREFIX = "C:\ESPHome\idf"
```

- `PYTHONUTF8`: without it, the CLI's colored/emoji status output
  (`❌`, checkmarks) crashes with `UnicodeEncodeError` on Windows' default
  console codepage.
- `ESPHOME_ESP_IDF_PREFIX`: **set this before the first build, not after.**
  See below.

## Provisioning the ESP-IDF toolchain

Neither Docker nor a local ESP-IDF install is required. Running any ESPHome
build once (`.\espectre.cmd esphome build --chip c3`) makes ESPHome download
and manage ESP-IDF 5.5.5 itself, and Native/Matter builds then reuse that same
toolchain automatically (`docs/CLI.md`, "local-build-prerequisites").

**Path length is the only real obstacle.** ESPHome's default toolchain cache
lives at `%LOCALAPPDATA%\esphome\Cache\idf`, and the ESP-IDF compiler's own
internal relative paths (`bin/../lib/...`) add ~250 more characters on top of
that. Combined, this blows past Windows' 260-character `MAX_PATH` and produces
cryptic failures like `fatal error: bits/c++config.h: No such file or
directory`. ESPHome detects this itself and prints the fix — set
`ESPHOME_ESP_IDF_PREFIX` to something short (`C:\ESPHome\idf`) *before* the
toolchain downloads, not after; if you hit the warning first, delete the
partially-installed cache dir it names and re-run.

## Building (the second path-length trap)

Even with a short toolchain prefix, **the build *output* directory** also hits
the 260-character limit if the repo itself lives somewhere deep (e.g. under
OneDrive: `C:\Users\<user>\OneDrive\Desktop\Github\espectre\...`). This shows
up as a `CMake Warning` about `CMAKE_OBJECT_PATH_MAX` during configure, which
is easy to dismiss as a warning — but ESP-IDF's bootloader subproject build
(a second, nested CMake project one level deeper) actually fails on it:

```
FAILED: esp-idf/bootloader_support/.../bootloader_flash_config_esp32c3.c.obj
fatal error: opening dependency file ...: No such file or directory
```

A `subst` drive does **not** fix this — the CLI resolves it back to the real
long path internally. The actual fix is `ESPECTRE_IDF_BUILD_DIR`, which
redirects just the *build output* to a short path while source stays where it
is (`docs/CLI.md`, `flash` section):

```powershell
New-Item -ItemType Directory -Force -Path "C:\ESPBuild" | Out-Null
$env:ESPECTRE_IDF_BUILD_DIR = "C:\ESPBuild\espectre-c3"
.\espectre.cmd native build --chip c3
```

## "ESPHome sensing schema does not match this SDK"

If `native build` (or `esphome build`) fails at configure time with this
`CMake Error`, the checked-in `sensing_schema.py` is stale relative to the SDK
headers in this checkout. Regenerate it and rebuild — this is a generated
file, not something to hand-edit:

```powershell
python .github/scripts/generate_esphome_schema.py
```

## Flashing and provisioning

```powershell
.\espectre.cmd native flash --chip c3 --port COM4
.\espectre.cmd provision --chip c3 --frontend native --port COM4 --ssid "YourNetwork"
```

`flash` doesn't need ESP-IDF at all — just esptool and the port — so it's fast
and doesn't care about any of the above. `provision` prompts for the WiFi
password (or reads `ESPECTRE_WIFI_PASSWORD`); it's never accepted as a CLI
argument. On success it prints the device's Direct HTTP endpoint
(`http://<device-ip>:62587`).

**Console monitor may look completely silent** (`.\espectre.cmd monitor ...`
prints nothing at all) even on a healthy device — this build's log level is
quiet by default. Don't take silence as a failure signal; confirm liveness via
the Direct HTTP API instead (`espectre direct get health --endpoint ...`).

## Calibration in an RF-noisy spot

The Lightweight detector's startup auto-calibration can converge to a
threshold near `1.0` (effectively "never trigger") when run close to
Bluetooth-active devices (e.g. testing over a phone's personal hotspot, right
next to the phone) — occupancy hovers near the 70% readiness floor and the
"quiet room" baseline it calibrates against isn't actually quiet on the radio
side. This is documented behavior (`docs/TROUBLESHOOTING.md`, "Calibration
stalls or startup quality is poor" / "Bluetooth reduces CSI occupancy"), not a
build problem. Confirm via `csi_occupancy` in diagnostics; if it's fluctuating
near 70%, either move to a normal WiFi router network away from
Bluetooth-heavy devices, or set a manual threshold that stays until reboot:

```powershell
.\espectre.cmd direct patch sensing --data '{\"threshold\":0.6}' --endpoint http://<device-ip>:62587
```

## Iterating after this initial setup

None of the toolchain provisioning above needs repeating. For a plain
firmware/code change on the *same* chip:

```powershell
$env:PATH = "$PWD\.venv\Scripts;" + $env:PATH
$env:PYTHONUTF8 = "1"
$env:ESPECTRE_IDF_BUILD_DIR = "C:\ESPBuild\espectre-c3"
.\espectre.cmd native build --chip c3
.\espectre.cmd native flash --chip c3 --port COM4
```

ccache and the already-provisioned ESP-IDF toolchain make the rebuild much
faster than the first one. Re-provisioning WiFi is only needed if credentials
changed or the device was erased.

For a **different board/chip**, repeat the "Provisioning the ESP-IDF
toolchain" step once for that chip target (`--chip <target>`), then follow the
same build/flash steps with `ESPECTRE_IDF_BUILD_DIR` pointed at a
chip-specific short path (e.g. `C:\ESPBuild\espectre-s3`).
