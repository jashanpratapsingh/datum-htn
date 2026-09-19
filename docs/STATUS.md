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
