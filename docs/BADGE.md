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
| `radio [probe]` | BLE controller diagnostics — **see warning below** |
| `snapshot [stats]` | dump the filesystem as JSON |
| `press <name>` | inject a button press |
| `shot` | stream the screen as RLE+base64 RGB565 |
| `uitree` | dump the LVGL widget tree |
| `card <name|email|url|tag>` | badge app state (requires subcommand) |
| `config` `ripple` `sponsormap` | badge app state |
| `debug` / `appmode` | admin-gated, needs the organizers' password |

`scripts/badge.py` wraps this. Three things it had to learn the hard way:

- **Frame on the prompt, not on sleeps.** Fixed delays desync the moment the
  badge is busy with an LVGL redraw or BLE work, and every later command then
  misreads. `badge.py` reads until `badge> ` reappears.
- **`ls` lies immediately after a write.** LittleFS directory metadata is not
  visible to `ls`/`cat` in the same console session that wrote it — sizes read
  back as 0 until the badge syncs. Verify after a reboot, not before.
- **`radio probe` triggers a USB_UART_CHIP_RESET.** On firmware v0.1.2-392-gd3089c4
  this command resets the chip (`rst:0x15`, `boot:0x5 DOWNLOAD(USB/UART0/1)`),
  which briefly puts the badge in ROM download mode. The badge then boots normally
  (~8 s). `badge.py` survives this because `_read_until_prompt` with a 15 s
  timeout catches the `badge>` prompt that appears after the reboot. The BLE
  diagnostic keys (`controller_state`, `running`, etc.) are absent from the telemetry
  on this firmware because the reset output does not include them; `telemetry()`
  in `badge.py` silently skips missing keys.

## The `shot` screen format (reverse-engineered)

The firmware documents this only as "Stream the screen as RLE+base64 RGB565".
Decoded and verified against the live device; `scripts/badge_shot.py` implements it.

```
SHOT <w> <h> rgb565le rle1
S <x0> <y0> <x1> <y1>        one stripe, 30 rows tall (8 stripes for 320x240)
<base64>                      RLE payload, 76-char lines
...
END bytes=<b64 chars> raw=<w*h*2> crc32=<hex> stripes=<n> covered=<px> elapsed_ms=<n>
```

`rle1` is byte-oriented over the little-endian RGB565 stream:

| Control byte | Meaning |
| --- | --- |
| `n & 0x80` | **run** — repeat the next 2-byte pixel `(n & 0x7f) + 2` times |
| else | **literal** — copy the next `n + 1` pixels verbatim |

The run bias is **+2**, not the usual +1: a run of one pixel would cost the same
three bytes as a literal, so the encoder never emits one and the extra count is
reclaimed. That one-off is the whole trick — with +1 the decode lands 98.4%
correct and silently short, which is exactly the kind of bug that looks like
noise. With +2 all eight stripes decode to exactly `320*30*2` bytes.

Note `bytes=` in the END line counts **base64 characters**, not decoded bytes.

```sh
./.venv-pio/bin/python scripts/badge_shot.py out.png     # capture live
```

**This is why `/api/screen` is disabled by default.** The home screen renders the
attendee's name, badge ID and an identity QR code. The endpoint 404s unless
`VENDX_ALLOW_SCREEN=1`, captures are gitignored, and none are committed.

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
utilisation, BLE controller state (absent when `radio probe` resets), boot count,
reset-reason histogram, task count (7 tasks observed idle, more with BLE active),
filesystem size. Readings are cached ~8 s because one UART cannot serve a burst
of paid requests, and the relay degrades to the simulator rather than failing a
paid request if the console wedges.

This still satisfies the brief's architecture: it explicitly permits verifying
"via a lightweight validation proxy".

### Serial never sits in the request path

A full console read takes 6–10s on a healthy badge and ~45s on one whose
`/dev` node exists but whose chip is asleep — the node survives a power-down,
so "is the device file there" says nothing about whether the badge will answer.
Pages fetch with a 5s timeout. The first version of `badge-source.ts` awaited
serial inside the request and stalled every device endpoint for 45s the moment
the badge dozed.

It now keeps a last-known reading, refreshes it on a background loop, and backs
off a badge that fails to answer for 60s. `readBadge()` returns immediately.
Provenance stays honest: the payload carries `readAt`, `ageSeconds` and
`badgeState` (`ok` / `unresponsive` / `absent`), and before the first good read
it is plainly the simulator. `/api/devices` answers in ~3ms with a dead badge.

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
