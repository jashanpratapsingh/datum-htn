# The build fleet

Four tmux sessions build VENDX in parallel. `scripts/fleet.sh` runs them.

```bash
./scripts/fleet.sh up               # launch all four
./scripts/fleet.sh status           # per-session state + STATUS.md tail
./scripts/fleet.sh attach backend   # watch one (ctrl-b d to detach)
./scripts/fleet.sh logs frontend    # tail its log
./scripts/fleet.sh down             # stop everything
```

## Ownership

| Session | Writes only in |
| --- | --- |
| `backend` | `agent-buyer/`, `relay-proxy/`, `solana-ledger/`, `packages/vendx-protocol/` |
| `frontend` | `web/` |
| `integrate` | end-to-end runs, Vercel, Supabase, **git** |
| `research` | `docs/` |

## Why the rules exist

Four agents in one repo is a concurrency problem, and the failure modes are
boring and predictable. Each rule below exists because of one of them.

**Exclusive directory ownership.** Two agents editing the same file interleave
edits and produce something neither intended. Ownership is by directory and
there is no shared write path. A session that needs a change outside its area
appends a `BLOCKED` line naming the owner and moves on — that is the entire
inter-session protocol, and it is deliberately narrow.

**`STATUS.md` is append-only.** Two concurrent rewrites of a file lose one
writer's work. Appends from different sessions interleave harmlessly.

**Only `integrate` commits.** Four processes racing on `.git/index` produce lock
contention and half-staged commits. One writer, no races, and the history stays
readable.

**Explicit termination.** A self-prompting loop with no exit condition runs
until it hits a token limit, which is an expensive way to produce nothing. Each
session stops when its build passes and it holds no open task, and there is a
hard iteration cap (`VENDX_MAX_ITERS`, default 12) behind that.

**No invented APIs.** The single most common failure in unattended agent work is
confidently calling a function that does not exist. Sessions are told to read
the `.d.ts` in `node_modules` rather than guess.

**Test the join, not just the halves.** Round two shipped a frontend typed
against bare arrays and a backend returning wrapped objects with different
field names — and every Playwright run happened with the relay down, so each
page only ever proved its empty state. Three routes crashed the moment the
relay was actually running. Two sessions each did their job correctly and the
product was still broken, because nothing exercised the contract between them.
`web/tests/relay-up.spec.ts` now runs against a live relay and skips (not
passes) when there isn't one. Any time two sessions own the two ends of an
interface, the integrate session must run something that crosses it.

## Watching it

`STATUS.md` is the ground truth, not the terminal scrollback:

```bash
tail -f docs/STATUS.md
```

A session that has gone quiet without writing `IDLE` has stalled — attach to it
and look. A `BLOCKED` line that nobody has answered is the other thing worth
scanning for.
