# The Hack the North badge

VENDX runs against a real attendee badge. This is what it is, what it can do,
and — importantly — what it refuses to do.

Everything here was established by probing the attached device. Nothing was
reflashed and nothing was erased.

## Hardware

| | |
| --- | --- |
| MCU | **ESP32-C3** (QFN32) rev v0.4 — RISC-V, **single core, 160MHz** |
| Radio | WiFi + BT 5 (LE), NimBLE host |
| Flash | 4MB embedded (XMC) |
| Display | **ST7789** TFT, driven by **LVGL 9** via `esp_lvgl_port` |
| LEDs | addressable strip over RMT (`led_strip`) |
| Sensors | accelerometer (100Hz / 800Hz modes, tilt + shake + tap), internal temp, battery mV |
| Other | NFC, I2C + SPI buses, USB-Serial/JTAG |
| Firmware | ESP-IDF **v5.5.3**, app `v0.1.2-392-gd3089c4`, built 2026-09-17 |

Partitions: `nvs` 16K · `phy_init` 4K · `factory` 2688K · `storage` (LittleFS) 1280K.

> **Single core, not dual.** Any design that pins BLE to core 0 and a server to
> core 1 does not apply here. Work is time-sliced on one core.

## Memory reality

```
idle:            sys_free=79652  largest=65536
BLE controller up: free_heap=28396  largest=19456
```

**~28KB free with the radio up** is the number that shapes everything. A TLS
handshake needs 40–50KB of contiguous heap. So the badge cannot be an HTTPS
endpoint, cannot call Solana RPC, and cannot hold a CA bundle. This is not a
limitation we designed around by choice — it is measured.

## The console

The badge exposes a REPL over USB serial at 115200. `help` lists it:

| Command | Use |
| --- | --- |
| `ls` `cat` `put` `rm` `mkdir` | LittleFS access |
| `apps` `reload` | list apps; rescan `/littlefs/apps` for Lua apps |
| `heap` | system + LVGL heap, per-task stack headroom |
| `radio [probe]` | BLE controller diagnostics |
| `snapshot [stats]` | dump the filesystem as JSON |
| `press <name>` | inject a button press |
| `shot` | stream the screen as RLE+base64 RGB565 |
| `uitree` | dump the LVGL widget tree |
| `card` `config` `ripple` `sponsormap` | badge app state |
| `debug` / `appmode` | admin-gated, needs the organizers' password |

`scripts/badge.py` wraps this. Two things it had to learn the hard way:

- **Frame on the prompt, not on sleeps.** Fixed delays desync the moment the
  badge is busy with an LVGL redraw or BLE work, and every later command then
  misreads. `badge.py` reads until `badge> ` reappears.
- **`ls` lies immediately after a write.** LittleFS directory metadata is not
  visible to `ls`/`cat` in the same console session that wrote it — sizes read
  back as 0 until the badge syncs. Verify after a reboot, not before.

## Lua apps — and the wall we hit

Apps live at `/littlefs/apps/<slug>/` with `manifest.cfg` (`slug=`, `name=`,
`version=`) and `main.lua` (**max 64 KiB**). Hooks: `on_enter`, `on_exit`,
`on_tick`, `on_button`, `on_recv`. Runtime is **Lua 5.5** with a memory cap and
an execution deadline.

The API surface, extracted from the firmware image:

```
badge.app.{exit,name,slug}
badge.contacts.{count,get}
badge.fs.{read,write,append,list,exists,mkdir,remove}
badge.input.{held,is_down}
badge.led.{set,set_all,clear,show,count}
badge.me.{name,badge_id,role,role_name,color,provisioned}
badge.nfc.{enable,disable,read_text,card,clear}
badge.radio.{enable,disable,send,on_recv,mac,dropped}
badge.sensor.{accel,orientation,shake,tap}
badge.store.{get,set,get_int,set_int,get_str,set_str}
badge.sys.{log,ms,uptime,heap,random,stats,version,gc_step,wake_lock}
```

**There is no network namespace.** No `badge.net`, no HTTP, no sockets.
`badge.radio` is BLE badge-to-badge only.

### Side-loading is blocked

We could not install a custom Lua app. The firmware accepts `put` for any
extension *except* `.lua`, which is created and then silently truncated to 0
bytes — verified by writing byte-identical 720-byte payloads to `a.bin`
(persisted) and `b.lua` (zeroed) in the same directory, in the same session.
`/littlefs/t.lua` outside the apps tree behaves the same way.

That is a deliberate guard, and a sensible one for a conference badge: apps are
meant to arrive through the vetted `share`/sync path or an admin unlock, not
raw serial writes. `debug` and `appmode` are gated behind an organizers'
password we do not have and did not attempt to guess beyond one try.

**Consequence:** `badge-app/` in this repo is written and ready, but it is not
installed. It becomes installable the moment there is an admin unlock, a
sharing badge, or a firmware that permits side-loading.

## So what VENDX actually does

The badge is the **sensor and the identity**; the relay is its **network face**.

```
AI agent ──HTTP 402/x402──► relay-proxy ──serial console──► badge (ESP32-C3)
```

`relay-proxy/src/badge-source.ts` reads genuine values over the console and
sells them. Live fields: chip, hashed device id, free heap, largest block, LVGL
utilisation, BLE controller state, boot count, reset-reason histogram, task
count, filesystem size. Readings are cached ~8s because one UART cannot serve a
burst of paid requests, and the relay degrades to the simulator rather than
failing a paid request if the console wedges.

This still satisfies the brief's architecture: it explicitly permits verifying
"via a lightweight validation proxy".

## Privacy

`/littlefs/identity.json` holds the attendee's name, email, phone, LinkedIn,
Discord, Instagram and X. `/littlefs/solana.json` holds a Solana **private key
in plaintext**.

**None of it is sold, logged or committed.** `badge.py telemetry` excludes both
files by construction, and the BLE MAC is published only as a SHA-256 prefix,
because a raw MAC is a stable tracking identifier.

> If you are holding one of these badges: anyone with ten seconds of USB access
> can read your contact details and that private key. Treat the badge wallet as
> disposable.
