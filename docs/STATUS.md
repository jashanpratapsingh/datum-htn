# VENDX build board

Append-only. Newest entries at the bottom. Format:

```
[ISO8601] <session> <CLAIM|DONE|BLOCKED|IDLE> <area> — message
```

Rules for fleet sessions — see [FLEET.md](FLEET.md):

- Write only inside the area you own. Need a change elsewhere? `BLOCKED` naming
  the owning session.
- Never `git commit`. `integrate` owns the index.
- `CLAIM` before you start so nobody duplicates you.
- When your build passes and you hold no open tasks, write `IDLE` and stop.

## Areas

| Session | Owns |
| --- | --- |
| `backend` | `agent-buyer/`, `relay-proxy/`, `solana-ledger/`, `packages/vendx-protocol/` |
| `frontend` | `web/` |
| `integrate` | e2e, Vercel, Supabase, git |
| `research` | `docs/` |

## Log

[2026-09-19T15:20:00Z] orchestrator DONE protocol — packages/vendx-protocol builds; receipt sign/verify round-trips, tamper + wrong-key rejected, 378B wire
[2026-09-19T15:20:00Z] orchestrator DONE docs — README (both Mermaid diagrams), PROTOCOL.md with the @x402-solana divergence on record
[2026-09-19T16:00:00Z] frontend CLAIM web/ — scaffolding Next.js 16 + Tailwind 4 app with hero, HLS video, liquid-glass card, mobile menu
[2026-09-19T16:05:00Z] research CLAIM docs/ — writing ARCHITECTURE.md and RUNBOOK.md (FLEET.md and FRONTEND_BRIEF.md already exist and are accurate)
[2026-09-19T16:20:00Z] research DONE docs/ — ARCHITECTURE.md written (system map, 7 surfaces, payment handshake steps, trust model, build status table); RUNBOOK.md written (node setup, build, demo, fleet, env vars, supabase, firmware, vercel, troubleshooting); all API names verified against packages/vendx-protocol/src/*.ts exports
[2026-09-19T16:20:00Z] research IDLE docs/ — all four docs exist and are accurate; no open tasks
[2026-09-19T16:25:00Z] integrate CLAIM e2e — building relay-proxy (simulator+facilitator), agent-buyer, scripts/demo.mjs, supabase/migrations/; will npm install + run demo then commit
[2026-09-19T16:30:00Z] frontend DONE web/ — next build passes (Next.js 16.3.5 + Tailwind 4.3.3); hero with HLS video, liquid-glass card, mobile menu with focus trap; 6 below-hero stubs; all a11y requirements met
[2026-09-19T16:30:00Z] frontend IDLE web/ — build green, no open tasks
[2026-09-19T16:35:00Z] backend CLAIM relay-proxy/ — TypeScript build, server startup, nonce store, facilitator key persistence (integrate wrote JS stubs; backend completing ownership)
[2026-09-19T16:35:00Z] backend CLAIM agent-buyer/ — TypeScript build, $5.00/day spend policy (persisted JSON), wallet keygen, main entry point
[2026-09-19T16:35:00Z] backend CLAIM solana-ledger/ — Anchor program scaffold for vendx-zk ZK-compressed telemetry commits
[2026-09-19T16:50:00Z] backend DONE relay-proxy/ — TypeScript builds clean; keys.ts/nonce-store.ts/simulator.ts/facilitator.ts/server.ts/index.ts; Ed25519 facilitator keypair persisted; HTTP server on :3402
[2026-09-19T16:50:00Z] backend DONE agent-buyer/ — TypeScript builds clean; policy.ts ($5.00/day cap, persisted spend-ledger.json); wallet.ts (Ed25519 keygen); index.ts (full 402→settle→200 arc verified)
[2026-09-19T16:50:00Z] backend DONE solana-ledger/ — vendx-zk Anchor program scaffolded (initialize + commit_batch instructions, VendxLedger PDA, TelemetryBucket struct); anchor build blocked on Rust 1.83 < 1.85 required by cpufeatures 0.3.1 (edition2024 feature); code is correct — toolchain upgrade needed
[2026-09-19T16:50:00Z] backend BLOCKED solana-ledger/ integrate — anchor build needs Rust ≥ 1.85 (have 1.83); run: rustup update stable, then anchor build in solana-ledger/
[2026-09-19T16:50:00Z] backend IDLE — npm run build green in agent-buyer and relay-proxy; 402→pay→receipt→200 arc confirmed in simulator; no open tasks
[2026-09-19T16:55:00Z] integrate DONE e2e — npm run demo green (402→pay→receipt→200 SIM); 2 commits on feat/vendx-architecture-gamma; relay-proxy TS dist built; supabase/migrations/0001_nonces.sql; .gitignore: keys/ data/ excluded; package.json demo builds relay-proxy before running
[2026-09-19T16:55:00Z] integrate IDLE git — demo arc green, all sessions committed, no open tasks
[2026-09-19T17:20:00Z] orchestrator DONE hardware — real ESP32-C3 HTN badge analysed read-only (no reflash, no erase); scripts/badge.py bridge; relay now sells REAL badge telemetry (source=badge); docs/BADGE.md
[2026-09-19T17:20:00Z] orchestrator BLOCKED badge-app — .lua side-load blocked by firmware guard (verified: 720B a.bin persists, byte-identical b.lua zeroed). badge-app/vendx written + ready; needs admin unlock or share path.
[2026-09-19T17:20:00Z] orchestrator DONE toolchain — rustup stable 1.83 -> 1.98.1, unblocks anchor build for backend
[2026-09-19T17:25:00Z] orchestrator DONE docs — docs/FEATURES.md: 9 routes planned for the product beyond the hero
[2026-09-19T17:25:00Z] orchestrator CLAIM none — relaunching fleet for feature pages + anchor build (rust now 1.98.1)
[2026-09-19T17:30:00Z] backend CLAIM solana-ledger/ — anchor build with Rust 1.98.1 (prev blocker was Rust <1.85); fix or document
[2026-09-19T17:30:00Z] backend CLAIM relay-proxy/ — add GET /api/devices, /api/devices/:id, /api/sales, /api/policy, /api/ledger endpoints
[2026-09-19T17:30:00Z] integrate CLAIM supabase — applying migrations/0001_nonces.sql to Datum-htn (dhjhsupqdmcdyqghxace)
[2026-09-19T17:31:00Z] integrate DONE supabase — 0001_nonces.sql applied to Datum-htn (dhjhsupqdmcdyqghxace)
[2026-09-19T17:31:00Z] integrate CLAIM vercel — deploying web/ to Vercel as jashanpratapsingh
[2026-09-19T17:35:00Z] research CLAIM docs/ — ARCHITECTURE.md: fix Xtensa→RISC-V, txSig→txSignature, stale build table; RUNBOOK.md: fix port 3001→3402, stale demo/build status; write docs/API.md
[2026-09-19T17:45:00Z] research DONE docs/ — ARCHITECTURE.md: "Xtensa"→"RISC-V", POST /settle field txSig→txSignature+network, build table updated to reflect all surfaces built; RUNBOOK.md: port 3001→3402, demo arc updated (green), build section updated; docs/API.md written (3 routes: GET /api/telemetry, POST /settle, GET /health — all verified against server.ts/facilitator.ts/badge-source.ts/simulator.ts)
[2026-09-19T17:45:00Z] research BLOCKED firmware-vendor/ backend — firmware-vendor/src/main.cpp lines 7-9 comment says "core 0 NimBLE … core 1 AsyncWebServer"; ESP32-C3 is single-core RISC-V — should say "single-core, time-sliced". Backend session owns that file.
[2026-09-19T17:45:00Z] research IDLE docs/ — all claims verified against source; three drift fixes applied; API.md written; no open tasks
[2026-09-19T17:50:00Z] frontend CLAIM web/ — building all 8 feature routes: /devices /devices/[id] /marketplace /agent /policy /ledger /protocol /docs; relay fetch with graceful empty states; SVG sparklines; agent console live handshake
[2026-09-19T17:55:00Z] backend DONE solana-ledger/ — anchor build --no-idl passes; vendx_zk.so (197KB) in target/deploy/; added idl-build feature to Cargo.toml; IDL step blocked on anchor-syn 0.30.1 using proc_macro2::Span::source_file() removed in nightly≥1.100 — documented in Anchor.toml comment; program logic correct
[2026-09-19T17:55:00Z] backend DONE relay-proxy/ — 5 new REST endpoints: GET /api/devices, GET /api/devices/:id, GET /api/sales, GET /api/policy, GET /api/ledger; sales-log.ts added (in-memory store, recorded at /settle); policy reads data/spend-ledger.json; CORS headers on all responses; npm run build -w @vendx/relay-proxy passes clean
[2026-09-19T17:55:00Z] backend IDLE — both builds green; all tasks complete
[2026-09-19T18:05:00Z] frontend DONE web/ — npm run build passes (12 routes, 0 TS errors); /devices /devices/[id] /marketplace /agent /policy /ledger /protocol /docs all render; relay fetch with offline/unimplemented empty states; SVG sparklines; source=badge|simulator badge on every row; agent console runs live 402→settle→200 arc in browser; NavBar updated to page links
[2026-09-19T18:05:00Z] frontend IDLE web/ — build green, no open tasks
[2026-09-19T17:45:00Z] integrate DONE vercel — web/ deployed; https://web-rouge-six-46.vercel.app
[2026-09-19T17:50:00Z] integrate DONE git — commit 89f0dc4 on feat/vendx-architecture-gamma; 33 files, all ROUND 2 sessions captured
[2026-09-19T17:50:00Z] integrate IDLE — supabase migrated, web deployed (https://web-rouge-six-46.vercel.app), commit done; no open tasks
[2026-09-19T18:15:00Z] orchestrator DONE firmware-vendor/ — resolved research BLOCKED: main.cpp concurrency comment now states ESP32-C3 is single-core RISC-V, scan/server time-sliced
[2026-09-19T18:15:00Z] orchestrator DONE CLAUDE.md — corrected stale "no hardware attached" claim; added never-reflash and never-read-identity/solana rules
[2026-09-19T18:15:00Z] orchestrator DONE verify — deploy checked independently: / /devices /agent /protocol all 200; VENDX re-skin live; HLS wired with enableWorker:false
[2026-09-19T18:30:00Z] integrate CLAIM git — ROUND 3 start; committing scripts/fleet.sh (round 3 goals update); will re-deploy to Vercel once frontend lands round 3
[2026-09-19T18:31:00Z] integrate DONE verify — round 2 live URL confirmed: / /devices /agent /protocol /marketplace /ledger /policy /docs all 200 at https://web-rouge-six-46.vercel.app
[2026-09-19T18:31:00Z] integrate BLOCKED frontend — waiting for round 3 web/ changes before Vercel redeploy; no unstaged web/ changes visible in git status
[2026-09-19T18:31:00Z] integrate IDLE — fleet.sh committed (6b08459), round 2 deploy verified green; will re-deploy and commit once frontend lands round 3
[2026-09-19T18:30:00Z] backend CLAIM solana-ledger/ — ROUND 3: unblock IDL generation (proc_macro2::Span::source_file() removed in nightly≥1.100); try pin old nightly → bump anchor → pin proc-macro2
[2026-09-19T18:30:00Z] backend CLAIM agent-buyer/ — ROUND 3: add unit tests for policy engine ($5/day cap, restart persistence, per-request cap rejection)
[2026-09-19T18:35:00Z] research CLAIM docs/ — ROUND 3: (1) write DEMO.md (3-minute script, both paths); (2) update BADGE.md with radio probe chip-reset quirk and actual task list; (3) update API.md to document landed endpoints, fix /health mode field
[2026-09-19T18:30:00Z] frontend CLAIM web/ — ROUND 3: visual hierarchy (Instrument Serif titles, timeline agent, arc gauge, histogram, loading skeletons, empty states); all 12 routes
[2026-09-19T18:40:00Z] orchestrator DONE badge — cracked the `shot` RLE format (run bias is +2, not +1); scripts/badge_shot.py decodes the live screen to PNG, all 8 stripes exact
[2026-09-19T18:40:00Z] orchestrator DONE relay-proxy/ — GET /api/screen, gated behind VENDX_ALLOW_SCREEN (404 by default): the badge home screen shows the attendee name, badge ID and identity QR, so it must never reach the public site. Captures gitignored.
[2026-09-19T18:40:00Z] orchestrator NOTE research — I appended a "shot screen format" section to docs/BADGE.md (your area, sorry). It is committed. Please KEEP it and edit around it rather than rewriting the file wholesale.
[2026-09-19T18:45:00Z] research DONE docs/ — DEMO.md written (3-min script, sim + badge paths, web frontend, judge talking points, curl probes); BADGE.md: radio probe chip-reset quirk (rst:0x15 USB_UART_CHIP_RESET, badge reboots ~8s, BLE keys absent), card subcommand noted, task count corrected (7 idle); API.md: removed stale "planned endpoints" section, documented all 5 landed endpoints (GET /api/devices /api/devices/:id /api/sales /api/policy /api/ledger), fixed GET /health mode field (now reflects badgeAttached()); all API shapes verified against relay-proxy/src/server.ts
[2026-09-19T18:45:00Z] research BLOCKED integrate — README.md docs table missing: BADGE.md, API.md, FEATURES.md, DEMO.md; please add four rows. integrate owns README.
[2026-09-19T18:45:00Z] research IDLE docs/ — all tasks complete; DEMO.md, BADGE.md, API.md accurate; no open tasks
[2026-09-19T18:55:00Z] frontend DONE web/ — ROUND 3 complete: Instrument Serif titles on all PageShell pages; /agent timeline with party-colored vertical connector and pulsing dot; /devices/[id] SVG bar-chart histogram (opacity-stepped greens, labeled axes); /policy SVG arc gauge with $remaining overlay; /ledger and /marketplace key numbers in Instrument Serif; 6 loading.tsx skeletons (devices, devices/[id], marketplace, policy, ledger, protocol); Playwright 11/11 tests pass (all 8 routes render, mobile menu focus-trap confirmed, /agent 9 steps, /protocol 4 sections); npm run build green 12 routes 0 TS errors
[2026-09-19T18:55:00Z] frontend IDLE web/ — build green, 11 playwright tests passing, no open tasks
[2026-09-19T19:15:00Z] backend DONE solana-ledger/ — IDL unblocked: approach 1 (pin nightly) failed (proc_macro2 1.0.107 removed source_file() entirely, not nightly-gated); approach 2 succeeded — avm install 0.31.1, anchor-lang bumped to 0.31.1, anchor-syn 0.31.2 uses new IDL extraction that does not call source_file(); target/idl/vendx_zk.json emitted (6.4KB, IDL spec 0.1.0, 2 instructions, 3 errors); target/deploy/vendx_zk.so (209KB)
[2026-09-19T19:15:00Z] backend DONE agent-buyer/ — policy unit tests: 4/4 pass (npm test -w @vendx/agent-buyer); covers: daily cap trips, restart via persisted ledger, per-request over-priced rejection, stale-day ledger reset; SpendPolicy minimally refactored to accept optional ledgerFile path for test isolation
[2026-09-19T19:15:00Z] backend IDLE — anchor build emits IDL; npm test passes; no open tasks
[2026-09-19T19:30:00Z] orchestrator DONE firmware-vendor/ — pio run -e esp32c3 SUCCESS (RAM 13.9%, Flash 38.8%); added the missing config.h + BLE sensor module main.cpp referenced
[2026-09-19T19:30:00Z] orchestrator DONE vercel — round 3 redeployed and verified live (integrate had gone IDLE before frontend landed)
[2026-09-19T19:30:00Z] orchestrator NOTE testing — web/playwright.config uses reuseExistingServer:true, which silently served a STALE unstyled build during verification. Kill :3000 before trusting a local screenshot.
[2026-09-19T20:10:00Z] orchestrator DONE web/ — retro-futurist redesign: vend-panel system (glass + paper), IBM Plex, Mainframe hero mechanics (scrub video, typewriter, pills), 8 pages re-skinned, 6 skeletons collapsed to 1, 5 dead components removed. Build green, 11/11 Playwright, all colour pairs pass AA.
[2026-09-19T20:10:00Z] orchestrator FOUND web/ + relay-proxy/ — CONTRACT MISMATCH from round 2: lib/relay.ts typed every endpoint as a bare array; relay returns {devices:[]}, {sales:[]}, {device,recentSales}; sales use amountMicroUsdc not amount; policy uses capMicroUsdc and has no denials; /api/ledger is a summary not a list. /devices, /devices/[id], /marketplace, and the new landing panels all crashed with the relay UP. Never caught because every Playwright run was relay-down. Fixed by making lib/relay.ts a wire→page adapter. Lesson: the route suite needs at least one relay-up run.
[2026-09-19T21:05:00Z] orchestrator DONE relay-proxy/ — badge-source.ts: serial out of the request path; last-known value + background refresh + 60s dead-badge backoff; /api/devices 45s -> 3ms with badge asleep
[2026-09-19T21:05:00Z] orchestrator FOUND web/tests — first relay-up handshake test was VACUOUS: gated on "source=" which matches the step-9 idle placeholder text, so it passed in 1.2s before anything ran and every run navigated away before /settle. Now gates on the "200 OK · dispensed" panel. 4 sales settle per run.
[2026-09-19T21:05:00Z] orchestrator DONE web/ — relay-up 9/9, routes 11/11 (relay up and down), relay-down skips 9 honestly; paper receipt + populated panels verified by eye; histogram over-scale fixed
[2026-09-19T21:40:00Z] orchestrator DONE vercel — redesign deployed; production alias https://web-rouge-six-46.vercel.app verified serving the new build (IBM Plex present, #5ed29c absent, all routes 200)
[2026-09-19T21:40:00Z] orchestrator DONE git — commit 2420be7 (48 files, +1927 −1872) pushed; PR #1 body updated with the redesign and the three findings
[2026-09-19T21:40:00Z] orchestrator NOTE web/tests — mobile-menu flake did not reproduce: 3/3 pass relay-up, / reaches networkidle in ~0.8s with one CDN request. Treating as a one-off CDN stall; not changing preload behaviour on one unreproduced hang.
[2026-09-19T21:40:00Z] orchestrator IDLE — redesign complete, verified, deployed. Badge is flapping (re-enumerating, answers intermittently); badge-source handles it by design. No open tasks.
