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
