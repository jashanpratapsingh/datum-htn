# Agent handoff — 2026-09-19 ~18:15 EDT

**Status: RESUME.** Local servers were paused for a `main` sync. Your WIP was stashed and restored. Continue on this branch.

## What just happened

1. Relay (`:3402`) and Next (`:3000`) were stopped so git could run without file locks.
2. `origin/main` was fetched and checked out — **Already up to date** at `1076fbe` (PR #13 code-discovery docs/tests). **No new commits from Jashan since the last pull.**
3. Branch returned to `feat/vendx-solana-spine` (already contains `main`).
4. Agent WIP stash was popped back onto the working tree.
5. Servers are being restarted with `NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:3402`.

## Current git picture

| Ref | Tip | Notes |
| --- | --- | --- |
| `origin/main` | `1076fbe` | Jashan’s latest. Vend-panel web redesign is in history. |
| `feat/vendx-solana-spine` | `1bd5b23` | **Your** local branch: +2 commits on top of main (settlement spine + verifier tests). Not on origin yet. |
| Working tree | dirty | In-progress WIP restored (see below). |

## Your local commits (do not rebase onto main again unless told)

1. `6a68bfb` — `feat(vendx): real-settlement spine on top of the simulator relay`
   - Adds Solana-track modules alongside simulator; `:3402` simulator path stays.
   - Paid node path on **`:4021`**; facilitator wrap on settlement; mock default, `VENDX_SETTLEMENT=devnet` for real USDC.
2. `1bd5b23` — `test(vendx): cover the verifier, nonce ring, wire format and sensing heuristics`

## Restored uncommitted WIP (yours — finish or commit via integrate rules)

Modified:
- `docs/API.md`, `docs/RUNBOOK.md`
- `package.json`, `package-lock.json`
- `relay-proxy/package.json`
- `relay-proxy/src/badge-source.ts`, `index.ts`, `nonce-store.ts`, `sales-log.ts`

Untracked:
- `relay-proxy/src/supabase.ts`
- `scripts/fund.mjs`
- `supabase/migrations/0002_sales.sql`
- `web/AGENTS.md`, `web/CLAUDE.md`

## Course-of-action updates (read before editing)

1. **Do not rewrite or reset `main`.** Work stays on `feat/vendx-solana-spine`.
2. **UI look is Jashan’s vend-panel** (glass/phosphor in `web/app/globals.css`). Color mismatches vs Vercel are usually cache or relay-offline empty states — hard-refresh; do not “fix” colors by inventing a new theme.
3. **Two relay surfaces exist:**
   - `:3402` — classic simulator relay (`relay-proxy/dist/index.js`) — what the Next app expects by default.
   - `:4021` / facilitator — settlement-spine node from your commits. Do not assume web pages call `:4021` unless `NEXT_PUBLIC_RELAY_URL` points there.
4. **Wire contract:** `web/lib/relay.ts` adapts wrapped shapes (`{devices:[]}`, `amountMicroUsdc`, etc.). Do not reintroduce bare-array types.
5. **Ownership (if fleet):** backend → `agent-buyer/`, `relay-proxy/`, `solana-ledger/`, `packages/vendx-protocol/`; frontend → `web/`; research → `docs/`; only integrate commits.
6. **Before claiming UI/relay bugs:** check `http://127.0.0.1:3402/health` and that Next was started with `NEXT_PUBLIC_RELAY_URL=http://127.0.0.1:3402`.
7. **Stashes left:** older stashes from the first pull may still exist (`git stash list`). Do not `stash pop` blindly.

## Resume checklist

- [ ] Re-read this file and `git status -sb`
- [ ] Confirm branch is `feat/vendx-solana-spine`
- [ ] Confirm relay health + web :3000
- [ ] Continue WIP (supabase sales path / fund script / docs) without touching unrelated `main`-owned redesign files unless necessary
- [ ] Append a line to `docs/STATUS.md` when you CLAIM/DONE/IDLE
