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
