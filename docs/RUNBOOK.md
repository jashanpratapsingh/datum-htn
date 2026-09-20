# VENDX runbook

Operational reference: local dev, demo arc, and deploy.

## Prerequisites

| Tool | Version | Notes |
| --- | --- | --- |
| Node.js | 22.23.2 | via nvm — see below |
| nvm | any | manages node |
| tmux | any | required for the build fleet |
| Supabase CLI | any | local DB only (`supabase start`) |
| PlatformIO CLI | any | firmware builds only (`pio run`) |

No ESP32 hardware is required for the demo — `relay-proxy` ships a device
simulator.

## Node version

Homebrew's system `node` is broken on this machine (`dyld: libicui18n.77.dylib
not found`). **Every** node/npm/npx command in this project must be prefixed:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

Or, if you have a `.nvmrc` at the repo root:

```bash
nvm use   # pins 22.23.2
```

The fleet script (`scripts/fleet.sh`) does this automatically for each session.

## Building

```bash
# from repo root, after setting PATH above
npm install          # workspace-level install (all packages)
npm run build        # builds packages/vendx-protocol (other services: in progress)
npm run typecheck    # type-check all workspaces
```

`packages/vendx-protocol` (`@vendx/protocol`), `agent-buyer`, `relay-proxy`,
and `web` all build cleanly. See [docs/ARCHITECTURE.md](ARCHITECTURE.md) for the
full build status table.

## Demo arc

```bash
npm run demo
```

The demo runs:
1. `relay-proxy` in simulator mode (fake ESP32, no hardware required)
2. `agent-buyer` against the simulator
3. Full 402 → settle → verify → 200 arc, logged to stdout

Expected output:
```
[relay-proxy] facilitator pubkey loaded
[relay-proxy] listening on :3402
[agent-buyer] wallet: <addr>…
[agent-buyer] daily budget remaining: $5.0000
[agent-buyer] → GET http://localhost:3402/api/telemetry
[agent-buyer] ← 402  nonce=<hex>…
[agent-buyer] ✓ policy  amount=100 µUSDC  to=FHcgXc3Y…
[agent-buyer] → execute  txSig=<sig>… (simulator)
[agent-buyer] → POST http://localhost:3402/settle
[agent-buyer] ← receipt  <body>.<sig>…
[agent-buyer] → GET http://localhost:3402/api/telemetry  (with receipt)
[agent-buyer] ← 200 OK — telemetry: { source: 'simulator', … }
```

## Build fleet

The fleet runs four parallel Claude Code sessions in tmux. Each session owns an
exclusive directory slice and writes only there.

```bash
./scripts/fleet.sh up               # launch all four sessions
./scripts/fleet.sh status           # per-session state + STATUS.md tail
./scripts/fleet.sh attach backend   # watch one session (ctrl-b d to detach)
./scripts/fleet.sh logs frontend    # tail that session's log file
./scripts/fleet.sh down             # kill all four
```

See [`docs/FLEET.md`](FLEET.md) for ownership rules and coordination protocol.
Session logs land in `.fleet/<session>.log`. Live build state is in
`docs/STATUS.md`:

```bash
tail -f docs/STATUS.md
```

## Environment variables

No `.env` file is committed. Create `.env.local` (git-ignored) at the repo root:

```bash
# Solana
SOLANA_RPC_URL=https://api.devnet.solana.com
VENDX_NETWORK=solana-devnet

# Facilitator key (relay-proxy)
FACILITATOR_SECRET_KEY=<base58 64-byte Ed25519 secret key>
FACILITATOR_PUBLIC_KEY=<base58 32-byte Ed25519 public key>

# Buyer wallet
BUYER_SECRET_KEY=<base58 64-byte Ed25519 secret key>

# Supabase (local dev — from `supabase status` output)
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_ANON_KEY=<from supabase status>
SUPABASE_SERVICE_KEY=<from supabase status>

# Vercel (web frontend deploy)
NEXT_PUBLIC_RELAY_URL=https://<your-relay-proxy-url>
# Several relays (vendors) side by side: comma-separated label=url. Takes
# precedence over NEXT_PUBLIC_RELAY_URL. Each relay keeps its own nonces, sales
# and facilitator key, so the site shows them as separate vendors and pins every
# payment to the relay that issued the 402 (web/lib/relays.ts).
NEXT_PUBLIC_RELAYS=jashan=https://relay.vendx.biz,teammate=https://<their-relay>
NEXT_PUBLIC_SUPABASE_URL=<production Supabase URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<production anon key>
```

The facilitator public key must match what is compiled into the firmware. Changing
it requires a firmware rebuild and re-flash.

## Supabase local dev

```bash
supabase start           # starts Postgres, Studio, Realtime on local ports
supabase status          # prints API URL, anon/service keys
supabase db reset        # re-runs migrations + seed
supabase stop            # shut down
```

Studio runs at `http://127.0.0.1:54323` by default. Migrations live in
`supabase/migrations/`.

## Firmware

Two ESP32-C3 boards exist. The user's **conference badge** keeps its factory
firmware and is read over its serial console (`scripts/badge.py`) — never
reflash it. The second board (USB MAC `e8:f6:0a:26:6e:94`) is **our own VENDX
node** `vendx-esp32c3-6e94`: it runs `firmware-vendor/` (reflashed 2026-09-20
with the real vendor wallet compiled in) and is the only board that may ever be
flashed; see "Vendor node" below. Both enumerate as `/dev/cu.usbmodem101`, so
check which one is plugged in before doing anything: the node prints
`[vendx] boot device=vendx-esp32c3-6e94` on reset, the factory badge shows a
`badge> ` prompt. When in doubt, `esptool read-mac` (with the console stopped).

Everything specific to one physical node — relay public key, device id, vendor
wallet, optional default relay URL — lives in the generated, git-ignored
`src/facilitator_key.h`:

```bash
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
node scripts/gen-facilitator-key.mjs --device-id vendx-esp32c3-6e94 \
  --pay-to "$(solana-keygen pubkey ~/.vendx/vendor-devnet.json)"   # same wallet the relay quotes
cd firmware-vendor
../.venv-pio/bin/pio run -e esp32c3            # compile
```

Without `--pay-to` the placeholder wallet is compiled in and the node sells
into a void; the boot banner prints `payTo=` so you can check.

`pio run -t upload` is broken on this machine (esptool 5.4 logger crash inside
PlatformIO's uploader, *after* it has erased the bootloader). Flash with esptool
directly, and stop anything holding the port first (`pkill -f vendor_console.py`,
and the relay's badge poller if it is on):

```bash
B=firmware-vendor/.pio/build/esp32c3
./.venv-pio/bin/python -m esptool --chip esp32c3 --port /dev/cu.usbmodem101 --baud 460800 \
  --before default-reset --after hard-reset write-flash -z --flash-mode dio --flash-freq 80m --flash-size 4MB \
  0x0 $B/bootloader.bin 0x8000 $B/partitions.bin \
  0xe000 ~/.platformio/packages/framework-arduinoespressif32/tools/partitions/boot_app0.bin \
  0x10000 $B/firmware.bin
```

A backup of the disposable badge's factory bootloader + partition table + app
(storage/LittleFS deliberately excluded — it holds identity.json and solana.json)
is in `~/.vendx/badge-backups/e8f60a266e94-*/` with restore instructions.

The C++ verifier in `firmware-vendor/src/verifier.cpp` mirrors the type
definitions in `packages/vendx-protocol/src/types.ts`. When you change a
`VerifyFailure` reason code or a wire field, update both files and add a comment
in `verifier.cpp` pointing to the TypeScript source.

## Vercel deploy (web)

```bash
cd web
vercel --prod
```

Set the environment variables in the Vercel dashboard. The `NEXT_PUBLIC_*`
variables are baked in at build time; server-side variables (`SUPABASE_SERVICE_KEY`)
are injected at runtime.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `dyld: libicui18n.77.dylib not found` on `node` | Homebrew node on PATH | `export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"` |
| `bad_signature` from device | Facilitator public key mismatch | Recompile firmware with correct key |
| `nonce_expired` from device | Clock skew > TTL (300s default) | Sync device clock; reduce latency between challenge and payment |
| `nonce_replayed` from device | Receipt submitted twice | Buyer should not retry with the same receipt; request a new challenge |
| `wrong_recipient` from device | `payTo` in receipt != device wallet | Confirm relay is quoting the correct vendor wallet |
| `insufficient_amount` | Buyer underpaid | Check `maxAmountRequired` in the challenge; buyer must transfer ≥ that amount |
| Protocol package missing from `node_modules` | Workspace not linked | Run `npm install` from repo root, not from inside the package directory |

## Frontend tests: two modes

```sh
cd web && npx playwright test          # relay down: 11 pass, 9 skip
# in another shell: node relay-proxy/dist/index.js
cd web && npx playwright test          # relay up:   20 pass
```

`routes.spec.ts` only ever proves each page's empty state. `relay-up.spec.ts`
runs a real handshake and loads every page populated — it **skips** (does not
pass) when the relay is unreachable, so a green relay-down run is honest about
what it did not check. Before trusting any screenshot, kill anything on `:3000`;
`playwright.config` reuses an existing server and will happily show you a stale
build.


## Running the relay: real by default, demo on request

```bash
scripts/relay.sh up       # default: poll the conference badge → source: "badge"; receipts only for
                          # USDC transfers confirmed on Solana (VENDX_SETTLEMENT=verify)
scripts/relay.sh demo     # simulator telemetry, poller disabled, receipts signed on trust — no wallet needed
scripts/relay.sh status   # pid, mode, settlement, vendor wallet, /health, who holds the badge port
scripts/relay.sh down
```

### Real payment (devnet)

The relay quotes `VENDX_VENDOR_WALLET` as `payTo`; `relay.sh` derives it from
`~/.vendx/vendor-devnet.json` (`solana-keygen new -o ~/.vendx/vendor-devnet.json`).
Without it the relay quotes a placeholder address nobody controls and says so at
boot. The buyer pays from the Solana CLI keypair (`~/.config/solana/id.json`, or
`VENDX_BUYER_KEYPAIR`), which needs devnet SOL (`solana airdrop 1`) and devnet
USDC from Circle's faucet (https://faucet.circle.com → Solana Devnet, mint
`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`). Check with
`spl-token balance 4zMM…ncDU --url devnet`.

```bash
npm run build -w @vendx/agent-buyer && (cd agent-buyer && node dist/index.js)   # against localhost:3402
RELAY_URL=https://relay.vendx.biz node agent-buyer/dist/index.js               # through the tunnel
```

The buyer sends one transaction: create the vendor's USDC ATA if missing,
`transferChecked` of the challenge amount, and a Memo holding the nonce. In
`verify` mode `/settle` fetches that transaction and refuses to sign unless it
succeeded, the vendor's USDC balance rose by at least the challenge amount and
the memo equals the nonce; a signature buys exactly one receipt, and the nonce
must be one this relay issued. Failure reasons come back as
`{ success: false, errorReason, detail }` with 402: `payment_not_found`,
`payment_failed`, `wrong_recipient`, `insufficient_amount`, `memo_mismatch`,
`signature_reused`, `nonce_unknown|replayed|expired`. `VENDX_SOLANA_RPC`
overrides the public devnet RPC. `VENDX_FAKE_PAYMENT=1` makes the buyer send a
fabricated signature; only a `demo` (trust) relay accepts it.

Note: the web `/agent` page still fabricates its signature client-side, so
against a `verify` relay it stops at `/settle` with `payment_not_found`. Run the
relay in `demo` mode for that page, or pay from the agent-buyer CLI.

The VENDX node quotes the wallet compiled into it (`--pay-to` at build time);
since 2026-09-20 that is the same vendor wallet the relay quotes. The relay
signs node receipts over the node's **registered** wallet and price, so the
two must agree or every buyer gets `wrong_recipient`.

`up` and `demo` restart a running relay, so switching is one command. `up`
stays honest about what it can read: with no badge plugged in it starts in real
mode anyway and picks the badge up when it appears (payloads say
`source: "simulator", badgeState: "absent"` until then). If the port is already
held by another process — in practice `scripts/vendor_console.py` on the
disposable vendor node, which does not speak the badge console and would be
reset by a second port owner — `up` points the poller at a non-existent device,
prints a warning, and the relay reports `mode: simulator`. Plug in the
conference badge (it shows a `badge> ` prompt) and run `up` again. Log:
`~/.vendx/relay.log`.

## Public relay: the cloudflared tunnel

The relay must run on the laptop (it owns the badge's USB port), and Vercel's
API proxies read `NEXT_PUBLIC_RELAY_URL` at build time. With the variable unset
they point at localhost and the deployed site returns 503.

The primary path is the cloudflared **named tunnel** `vendx-relay` at
`https://relay.vendx.biz` (config `~/.cloudflared/config.yml`; the zone is on
Cloudflare, registered at Porkbun). The hostname is stable, so cloudflared
restarts need no redeploy. The fallback is a *quick tunnel* — no Cloudflare
account needed, but the `*.trycloudflare.com` hostname changes every time
cloudflared restarts, and each new hostname needs a Vercel env update **and a
redeploy**. `up` prefers the named hostname whenever it answers.

```bash
scripts/relay-tunnel.sh up       # start tunnel if needed, set NEXT_PUBLIC_RELAY_URL (prod+preview), redeploy if changed
scripts/relay-tunnel.sh status   # tunnel state, relay health through it, which URL is deployed
scripts/relay-tunnel.sh down
```

State: `~/.vendx/cloudflared-named.log`, `~/.vendx/cloudflared.log`,
`~/.vendx/relay-public-url`. After a laptop reboot: `scripts/relay.sh up`, then
`scripts/relay-tunnel.sh up`. `status` resolves the hostname at 1.1.1.1, because
this laptop's resolver kept stale Porkbun records for a while after the zone
moved and made a healthy tunnel look dead; if it reports a stale local record,
flush with `sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder`.
The public internet and Vercel are unaffected by that cache.

## Vendor node (the VENDX ESP32-C3 running firmware-vendor)

The node serves the x402 endpoint itself on port 80 (`GET /api/telemetry`,
`GET /health`, `GET /`) and verifies relay receipts offline with the compiled-in
facilitator public key. Provenance field: `"source": "esp32c3"`.

**It must be registered with the relay before anyone can buy from it.** The
node mints its own challenge nonces, and `/settle` only signs receipts for
nonces it can account for: its own, or one from a node that has registered
(`POST /api/nodes/register`, see docs/API.md). Registration happens from the
node — give it the relay's URL over the serial console and it posts its
identity on every station connect and every 60 s after (`status` shows
`registered=yes`). The relay probes the node's `/health` at the URL it gave
and lists it in `/api/devices` with `source: "esp32c3"`, `nodeState`
(`live`/`stale`/`lost` by heartbeat age) and `reachable`. Plain HTTP only:
the C3 has no heap for TLS with BLE up, so point it at the laptop's LAN IP,
not at `https://relay.vendx.biz`.

```bash
./.venv-pio/bin/python scripts/vendor_console.py send 'relay http://<laptop-ip>:3402'   # save + register now
./.venv-pio/bin/python scripts/vendor_console.py send register                          # re-register on demand
./.venv-pio/bin/python scripts/vendor_console.py send 'relay clear'
curl -s localhost:3402/api/nodes | jq .                                                 # what the relay knows
```

The node names its facilitator in every challenge (`accepts[0].extra.facilitator`,
alongside `extra.deviceId`), so a buyer that finds the node knows where to settle.

**WiFi** is provisioned at runtime — nothing is compiled in. If no station link
is up 20 s after boot it opens its own WPA2 access point
`vendx-<last 4 of MAC>` (`vendx-6e94`, password `vendx-setup`, node at
`192.168.4.1`). Station credentials are stored in NVS via the USB console and
survive reflashes. WPA2-Enterprise networks (eduroam and the like) are **not**
supported — use a phone hotspot or the AP.

```bash
./.venv-pio/bin/python scripts/vendor_console.py tail &                # ONE process owns the port; logs to ~/.vendx/vendor-serial.log
./.venv-pio/bin/python scripts/vendor_console.py send status           # link, ip, heap, uptime, current BLE bucket
./.venv-pio/bin/python scripts/vendor_console.py send scan             # nearby networks
./.venv-pio/bin/python scripts/vendor_console.py wifi "My Hotspot" pw  # save + connect; prints ip and vendx-esp32c3-6e94.local
./.venv-pio/bin/python scripts/vendor_console.py send help
```

Never open the serial port from a second process: on the C3's USB-Serial/JTAG
the DTR/RTS toggle of a second `open()` resets the chip into download mode.
`send` goes through a FIFO to the running `tail` for exactly this reason.

End-to-end check over the network (402 → relay `/settle` → 200 → replay and
tamper both rejected). The handshake script fabricates the transaction, so it
needs a `demo` (trust) relay; against a `verify` relay step 2 correctly fails
with `payment_not_found`. The real thing is `buy-node.mjs`: a genuine devnet
USDC transfer, verified on-chain by the relay, redeemed on the node.

```bash
scripts/vendor-handshake.sh http://192.168.4.1                # on the AP, relay in demo mode
scripts/vendor-handshake.sh http://vendx-esp32c3-6e94.local   # on a shared LAN
node scripts/buy-node.mjs http://vendx-esp32c3-6e94.local     # real purchase, relay in verify mode
```

Network reality on 2026-09-20: the venue LAN is WPA2-Enterprise, which the node
cannot join, and the laptop's only uplink is its Wi-Fi. So either put both on a
phone hotspot (`vendor_console.py wifi …`, then `relay http://<laptop-ip>:3402`),
or uplink the laptop over iPhone USB and join its Wi-Fi to `vendx-6e94`
(then the node registers with `relay http://192.168.4.2:3402` — the AP hands the
laptop `.2`; check with `ifconfig en0`). Joining the laptop to the AP with no
other uplink cuts every remote session on it.

### Stable hostname (named tunnel)

Target: **relay.vendx.biz**. Prepared on 2026-09-19: tunnel `vendx-relay`
(id `c9dbe6fb-0523-424d-9d71-42e96565bfce`) exists in the Cloudflare account
and `~/.cloudflared/config.yml` already routes `relay.vendx.biz` →
`localhost:3402`. vendx.biz is registered at Porkbun and is **not** in the
Cloudflare account yet; the tunnel cert on this machine cannot create zones.
Remaining steps, in order:

1. Cloudflare dashboard → Add a domain → `vendx.biz` (Free plan is fine). Note
   the two nameservers it assigns.
2. Porkbun → vendx.biz → Nameservers → replace the porkbun.com ones with those
   two. Wait until `dig +short NS vendx.biz` returns them (minutes to hours).
3. Either `cloudflared tunnel login` choosing vendx.biz, then
   `cloudflared tunnel route dns vendx-relay relay.vendx.biz` — or add the DNS
   record by hand: CNAME `relay` → `c9dbe6fb-0523-424d-9d71-42e96565bfce.cfargotunnel.com`, proxied.
4. `VENDX_RELAY_HOST=relay.vendx.biz scripts/relay-tunnel.sh up` (or change the
   `NAMED_HOST` default in the script). It starts the named tunnel, re-points
   Vercel, redeploys once and stops the quick tunnel. The URL never rotates again.


## Several relays on one site

`web/lib/relays.ts` reads `NEXT_PUBLIC_RELAYS` (`label=url,label=url`). Every
page fans out to all relays and tags each device, sale and receipt with the
relay it came from; a relay that is down is reported in its own panel while the
others still render. Device links carry `relayKey:deviceId` because two
simulators share the id `esp32-sim-001`. The agent console has a relay picker,
and `/api/telemetry?relay=<key>` / `/api/settle?relay=<key>` proxy to that
relay only — a nonce exists in one relay's process, so challenge and settlement
must not be split across relays. To add a teammate:

```bash
echo 'teammate=https://their-relay.example' >> ~/.vendx/extra-relays
scripts/relay-tunnel.sh up          # rewrites NEXT_PUBLIC_RELAYS and redeploys once
```

Their relay must serve the same REST surface (docs/API.md) with CORS on.

## Deploying the web app

The Vercel project `web` is linked to GitHub `jashanpratapsingh/vendx-htn` with
production branch **main** and Root Directory **web** (set 2026-09-20). Every
merge to main builds and, if green, becomes production at
https://web-rouge-six-46.vercel.app. `vercel --prod` from `web/` still works
for a manual deploy of the working tree.

`web/` consumes `@vendx/protocol` as a tarball (`file:./vendx-protocol.tgz`)
rather than a workspace link, and the root `package-lock.json` pins that
tarball's sha512. If the two disagree, every clean install fails with
EINTEGRITY — which is why all git-triggered builds failed until 2026-09-20.
Whenever `packages/vendx-protocol` changes:

```bash
scripts/pack-protocol.sh          # rebuilds, re-packs, pins the hash
git add web/vendx-protocol.tgz package-lock.json
```

and commit both files together.
