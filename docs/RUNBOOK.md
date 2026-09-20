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

Nothing with a secret is committed. Names are listed in `.env.example` at the
repo root. Where each value lives:

| Where | File | Holds |
| --- | --- | --- |
| relay (laptop) | `~/.vendx/relay.env` (chmod 600, sourced by `scripts/relay.sh`) | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VENDX_WEB_SECRET`, `VENDX_RELAY_LABEL` |
| web (local) | `web/.env.local` | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_RELAY_URL`, `VENDX_WEB_BUYER_KEYPAIR`, `VENDX_WEB_SECRET`; Phantom login: `SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SOLANA_RPC_URL`, optional `SIWS_ALLOWED_DOMAINS` |
| web (Vercel) | project settings, prod + preview + development | the same set |
| buyer / MCP | shell env or `claude mcp add -e …` | `RELAY_URL`, `VENDX_API_KEY`, optional `VENDX_BUYER_KEYPAIR` |

Keys come from the CLI without pasting them into a terminal transcript:

```bash
supabase projects api-keys --project-ref dhjhsupqdmcdyqghxace -o env --reveal > ~/.vendx/supabase-keys.env
chmod 600 ~/.vendx/supabase-keys.env
# SUPABASE_DEFAULT_KEY (sb_secret_…) → SUPABASE_SECRET_KEY in relay.env
# SUPABASE_PUBLISHABLE_KEY           → NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in web/.env.local and Vercel
```

`NEXT_PUBLIC_RELAYS` (comma-separated `label=url`) still works as an override
for the handshake proxies; the marketplace lists relays from the Supabase
directory regardless (see below).

The facilitator public key must match what is compiled into the firmware. Changing
it requires a firmware rebuild and re-flash. It is also the relay's id in the
directory, so a fresh checkout without `keys/facilitator.json` registers as a
new relay (handy for a dev relay; confusing if you meant to be the production one).

### Solana-track spine (ports 4021 / 4022)

`npm run demo:solana` runs a standalone node (`relay-proxy/dist/node.js`) and a
chain-checking facilitator (`relay-proxy/dist/facilitator-server.js`) beside the
relay. They read their own variables, and their keys are **files** under `keys/`
(`keys/{treasury,agent,vendor}.json`, created by `npm run keygen`).

```bash
VENDX_NETWORK=solana-devnet
VENDX_SETTLEMENT=mock                    # spine only: "mock" or "devnet" (the relay reads verify|trust)
VENDX_RPC_URL=https://api.devnet.solana.com
VENDX_NODE_PORT=4021
VENDX_NODE_URL=http://127.0.0.1:4021
VENDX_FACILITATOR_PORT=4022
VENDX_FACILITATOR_URL=http://127.0.0.1:4022
VENDX_ROOT=.                             # repo root for keys/
VENDX_RESOURCE=/api/telemetry
VENDX_CSI_PORT=5005
VENDX_NODE_ID=1
VENDX_ROUNDS=1
VENDX_DEMO_REPLAY=0                      # set 1 to prove nonce_replayed
VENDX_FORCE_TIER=                        # optional: MEASURED_RSSI | SIMULATED | …
```

`VENDX_SETTLEMENT` means different things to the two programs (`mock|devnet`
for the spine, `verify|trust` for the relay), so set it per process, never in a
shared shell. Badge serial extras for the relay: `VENDX_BADGE_PORT` defaults to
`COM3` on Windows (`VENDX_PY` is the path to `python.exe` there) and
`VENDX_ALLOW_SCREEN=1` enables `GET /api/screen`.

Optional on-chain ledger batcher (`vendx-zk`): the relay commits sale batches
only when **both** `VENDX_LEDGER_AUTHORITY` (JSON secret key) and
`VENDX_RPC_URL` are set; with neither, `/api/ledger` reports `deployed:false`
without touching the network.

## Supabase (hosted project `Datum-htn`, ref `dhjhsupqdmcdyqghxace`)

The relay is the only writer (service-role key). The website reads the public
directory and sales view with the publishable key and the signed-in user's own
rows through RLS. Schema: `supabase/migrations/0003_persistence.sql` (+ `0004`,
`0005`).

```bash
supabase migration list        # local vs remote versions
supabase db push               # apply new migrations (password from the keychain since the project is linked)
supabase config diff           # preview auth settings; `supabase config push` writes only declared properties
```

What persists: nonces (scoped per relay), used transaction signatures, sales
(with `agent_id` / `user_id` attribution and the receipt, owner-only), the
relay/device directory, and agents (API keys, hash only). `scripts/relay.sh up`
warns when `~/.vendx/relay.env` is missing: the relay then runs on memory,
nothing survives a restart and API keys are not recognised.

Restart proof (trust mode, no USDC needed):

```bash
scripts/relay.sh demo
N=$(curl -s localhost:3402/api/telemetry | jq -r .nonce)
R=$(curl -s -XPOST localhost:3402/settle -H 'content-type: application/json' \
     -d "{\"nonce\":\"$N\",\"txSignature\":\"SimTx_$N\",\"amount\":\"100\",\"network\":\"solana-devnet\"}" | jq -r .receipt)
scripts/relay.sh demo                                   # restart
curl -s -o /dev/null -w '%{http_code}\n' -H "x-payment-receipt: $R" localhost:3402/api/telemetry   # 200
curl -s -H "x-payment-receipt: $R" localhost:3402/api/telemetry                                     # {"error":"nonce_replayed"}
```

## Connecting a coding agent (remote MCP server)

The website IS the MCP server: `https://vendx.biz/api/mcp` (the vercel.app alias
serves the same thing; every URL below derives from the host you visit) — Streamable HTTP,
stateless) plus its own OAuth 2.1 authorization server. `/connect` prints the
one-liners; the flow for a buyer is:

1. **Install.** Claude Code: `claude mcp add --transport http --scope user vendx https://<site>/api/mcp`,
   then `/mcp` → vendx → Authenticate. Codex: `codex mcp add vendx --url …` +
   `codex mcp login vendx`. Cursor: the deep link on `/connect` or `.cursor/mcp.json`.
   The first call gets `401` + `WWW-Authenticate: … resource_metadata=…`; the
   client reads `/.well-known/oauth-protected-resource/api/mcp`, then
   `/.well-known/oauth-authorization-server`, registers itself at
   `/api/oauth/register` (loopback or https redirect URIs only) and opens the browser.
2. **Approve** at `/oauth/authorize`: sign in (Phantom first, email fallback —
   both are one Supabase auth user, see migration 0006), pick or name the agent,
   set a per-reading and a daily cap. Approving creates the agent
   (`vendx_create_agent_oauth`, no API key), its custodial Solana wallet
   (`vendx_agent_wallets`, secret sealed with `VENDX_WALLET_KEK`) and a 10-minute
   code bound to the client's PKCE challenge.
3. **Fund** at `/oauth/authorize/done`: one Phantom transaction sends devnet USDC
   (what readings cost) and a little SOL (what transactions cost) to the agent
   wallet, then "Continue" hands the code back to the client, which exchanges it
   at `/api/oauth/token` for a 1 h access token and a 30 d refresh token
   (rotated on every use; a replayed refresh token revokes the whole family).
4. **Buy.** Tools: `vendx_list_devices` (Supabase directory), `vendx_buy_reading`
   (402 → reserve against the caps in Postgres → pay from the agent wallet →
   `/settle` with `x-vendx-web-secret` + `x-vendx-user-id` + `x-vendx-agent-id`
   → redeem → `vendx_readings`), `vendx_reading_history` (with stats),
   `vendx_budget_status`, `vendx_transactions`. The wallet balance is the hard
   budget; the caps are checked by `vendx_reserve_spend` (row lock on the agent)
   before any transfer, so parallel tool calls cannot overspend.
5. **See it** on `/account`: agents with wallet balances, caps (editable),
   sessions, activity-over-time per device, spend per hour, transactions with
   Solscan links. Revoking an agent revokes every token it had; the next call
   is a 401 before any money moves.

Static-key alternative (no browser step): **Register agent** on `/account`
mints `vendx_sk_…` once; use it as a bearer header —
`claude mcp add --transport http vendx https://<site>/api/mcp --header "Authorization: Bearer vendx_sk_…"`
(`/account` prints the Codex and Cursor forms too). The stdio server in
`agent-buyer/dist/mcp.js` still works for self-custody buyers who want to pay
from their own keypair.

Smoke test from a shell: `MCP_URL=https://<site>/api/mcp VENDX_API_KEY=vendx_sk_… node scripts/mcp-smoke.mjs`
(`SMOKE_BUY=1` also buys one reading, ~100 µUSDC). It never prints the key.

### Agent wallets and the KEK

`VENDX_WALLET_KEK` (32 bytes, base64; `openssl rand -base64 32`) seals every
agent wallet's secret key with AES-256-GCM (`web/lib/wallet/keystore.ts`). It
lives on Vercel and in `~/.vendx/web-mcp.env`, never in git. Losing it strands
every agent wallet; the same value must be used by every deployment that
serves `/api/mcp`. Rows record `kek_id` (first 8 hex of sha256(kek)) so a
rotation can re-seal them. Wallets are created lazily (consent page, or the
first tool call of a key-registered agent).

### Deploying: `scripts/deploy.sh`

```bash
scripts/deploy.sh check          # tooling, logins (vercel/gh as jashanpratapsingh), env NAMES in ~/.vendx/web-mcp.env
scripts/deploy.sh migrate        # supabase migration list + db push --linked
scripts/deploy.sh env preview    # push the env file to Vercel production + preview (values never echoed)
scripts/deploy.sh build          # protocol → tarball if changed → relay tests → web unit tests → next build
scripts/deploy.sh preview        # vercel deploy → preview URL → verify against it
scripts/deploy.sh release        # push, PR, merge → git-linked Vercel builds main into production → verify
scripts/deploy.sh relay          # restart the laptop relay from THIS checkout (Supabase-backed, verify mode)
scripts/deploy.sh verify [url]   # discovery docs, 401 hint, mcp-smoke.mjs with the key in ~/.vendx/mcp-smoke.env
```

The relay at `relay.vendx.biz` must run the Supabase-backed build for the
marketplace directory to have devices in it; `scripts/deploy.sh relay` (or
`scripts/relay.sh up` from an up-to-date checkout) does that.

### Background stack: `scripts/stack.sh` (tmux)

`scripts/stack.sh up [--web]` opens a tmux session `vendx` with windows
`relay` (real mode via relay.sh), `tunnel` (cloudflared), `smoke` (the MCP
smoke test against production every 5 min) and optionally `web` (`next dev`).
`status` prints relay, tunnel and production-MCP health; `attach`, `logs
<win>`, `down`.

## Buying from the website

Signed-in users can run the handshake on `/agent`. The site pays from a shared
devnet wallet (`VENDX_WEB_BUYER_KEYPAIR`, a dedicated key at
`~/.vendx/web-buyer-devnet.json`, funded with a little devnet SOL and USDC),
settles with `X-Vendx-Web-Secret` + `X-Vendx-User-Id` so the relay records the
sale against that account, and streams each step to the page. Guards: session
required, the server fetches its own 402, devnet + USDC mint + per-purchase cap
(`VENDX_WEB_MAX_MICRO_USDC`, default 100000), five purchases a minute per
account. Top the wallet up when `/agent` reports `buyer_unfunded`.

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

Set the environment variables in the Vercel dashboard. `NEXT_PUBLIC_RELAY_URL`
is baked in at build time — after changing a tunnel hostname, redeploy.

The Phantom login needs four of them on Vercel (production and preview):
`SESSION_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `NEXT_PUBLIC_SOLANA_RPC_URL`.
Without `SESSION_SECRET` the auth routes throw on Vercel by design (a random
per-process secret would log everyone out on every cold start). Without the
Supabase pair, login still works and the response carries
`warning: "accounts_unavailable"`.

## Phantom login (web)

One pill in the navbar, top right, for vendors and customers alike.

1. **Connect Phantom** → the site asks `POST /api/auth/nonce` for a Sign In
   With Solana input (domain, statement, nonce, issuedAt) and hands it to
   Phantom's `signIn`. One popup: connect and sign together. Older Phantom
   builds without `signIn` fall back to `connect` + `signMessage` (two popups).
2. `POST /api/auth/verify` checks the Ed25519 signature over the exact bytes
   Phantom signed, parses them back into fields, and compares domain, address,
   nonce (from the 5-minute `vendx_siws` cookie) and issue time. Then it sets
   `vendx_session` (httpOnly, SameSite=Lax, 7 days, HMAC-signed, stateless) and
   calls `vendx_touch_account` in Supabase (`supabase/migrations/0002_accounts.sql`:
   wallet, first_seen, last_seen, login_count, last_domain, last_method).
3. The pill shows the truncated address and the wallet's **devnet SOL and USDC**,
   read in the browser from `NEXT_PUBLIC_SOLANA_RPC_URL` every 30 s while the
   tab is visible. Click it for the full address, balances, role and Disconnect.
4. **Coming back**: the cookie restores the login on the server, and the page
   calls `connect({ onlyIfTrusted: true })` so Phantom re-attaches silently. If
   Phantom reports a different account, or the user disconnects in the
   extension, the site logs out rather than show one wallet while another signs.
5. **Role** is derived, never stored: a wallet is a *vendor* when some relay's
   `/api/devices` lists a registered device whose `payTo` is that wallet; anyone
   else is a *visitor*.
6. **Paying**: on `/agent`, a connected wallet pays the 402 for real — the page
   builds the same transaction `agent-buyer` sends (idempotent ATA create,
   `transferChecked` USDC, Memo = nonce), Phantom signs and sends it, the page
   waits for `confirmed`, then `/settle` verifies it on-chain. Disconnected
   visitors still get the simulated run, labelled as such, which a verifying
   relay refuses with `payment_not_found`.

Tests: `web/tests/wallet.spec.ts` drives the real routes through a Phantom
mock that signs with a real Ed25519 key (`web/tests/helpers/mock-phantom.ts`).
The live-payment test runs only with `VENDX_E2E_KEYPAIR=<funded devnet keypair>`
and a relay up; it moves real devnet USDC.

## One-command dev stack

```bash
scripts/dev.sh up            # relay-proxy (demo: simulator + trust) on :3402, next dev on :3000
scripts/dev.sh up real       # relay.sh up: badge poll + on-chain verification
scripts/dev.sh status        # /health, :3000, who owns what
scripts/dev.sh logs          # tail ~/.vendx/relay.log and ~/.vendx/web-dev.log
scripts/dev.sh down          # stops the web dev server; stops the relay only if dev.sh started it
```

Env comes from `~/.vendx/dev.env` (created from `scripts/dev.env.example` on
the first run; fill in `SUPABASE_SERVICE_KEY` and `SESSION_SECRET`). A relay
that `scripts/relay.sh` already runs on :3402 is adopted, not restarted — pass
`--restart` to switch modes. Anything else holding :3402 or :3000 is reported
and left alone.

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

## Presence node (ESP32-C3 running the presence-node firmware, read over WiFi)

A badge reflashed with the presence-node (ESPectre) build has no serial console,
so `scripts/badge.py` cannot read it and the relay would fall back to the
simulator even with the badge on USB. Instead the relay polls the node's own
HTTP API over WiFi (TCP 62587, base path `/espectre/v1`, exact-Origin allowlist)
and keeps one SSE connection open for `motion` events. The reading is sold via
x402 like any other and stamped `"source": "esp32c3"` with `transport:
"wifi-http"`, `firmware`, `readAt` and `ageSeconds`.

```bash
# ~/.vendx/relay.env — relay.sh loads it
VENDX_PRESENCE_NODE=172.20.10.13          # host[:port]; port defaults to 62587
VENDX_NODE_LOCATION="Hack the North"      # optional free text, shown as a plate on /devices
# VENDX_PRESENCE_ORIGIN=https://test.espectre.dev   # the firmware's default allow-listed Origin
```

Precedence in `readBadge()`: conference badge console (source `badge`) →
presence node (source `esp32c3`) → simulator. The device id is
`<chip>-<last 6 of the node's device_id>`, e.g. `esp32c3-3d24a3`. Laptop and
node must be on the same hotspot (see docs/BADGE.md); unplug the node from USB
while the relay runs so the serial poller does not reset it every minute.

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
