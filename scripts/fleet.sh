#!/usr/bin/env bash
# VENDX build fleet — four self-pacing tmux sessions with exclusive ownership.
#
#   ./scripts/fleet.sh up            launch all four
#   ./scripts/fleet.sh status        one line per session + STATUS.md tail
#   ./scripts/fleet.sh attach NAME   attach (ctrl-b d to detach)
#   ./scripts/fleet.sh logs NAME     tail that session's log
#   ./scripts/fleet.sh down          kill all four
#
# Coordination rules live in docs/FLEET.md. The short version: a session writes
# only inside the directory it owns, never runs git commit, and stops when its
# build passes and it holds no open task.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS="$ROOT/.fleet"
NODE_BIN="$HOME/.nvm/versions/node/v22.23.2/bin"
SESSIONS=(backend frontend integrate research)
MAX_ITERS="${VENDX_MAX_ITERS:-12}"

owns() {
  case "$1" in
    backend)   echo "agent-buyer/ relay-proxy/ solana-ledger/ packages/vendx-protocol/" ;;
    frontend)  echo "web/" ;;
    integrate) echo "end-to-end runs, Vercel, Supabase, git" ;;
    research)  echo "docs/" ;;
  esac
}

goal() {
  case "$1" in
    backend)   echo "ROUND 2. agent-buyer and relay-proxy already build green. Your remaining tasks: (1) Rust is now 1.98.1 so the earlier blocker is gone — run 'anchor build' in solana-ledger/ and fix until it compiles; if light-sdk cannot be reconciled with the installed Anchor, keep the plain Anchor program that stores a 32-byte state root and say so in a comment. (2) Add REST endpoints the frontend needs: GET /api/devices, GET /api/devices/:id, GET /api/sales, GET /api/policy, GET /api/ledger in relay-proxy, serving real data where it exists. Read relay-proxy/src/badge-source.ts first — a real ESP32-C3 badge is attached and readBadge() returns genuine telemetry. Done when: anchor build passes (or is documented as blocked with the exact error) AND npm run build -w @vendx/relay-proxy is green with the new endpoints." ;;
    frontend)  echo "ROUND 2. The hero already builds. Now build the feature pages in docs/FEATURES.md: /devices, /devices/[id], /marketplace, /agent, /policy, /ledger, /protocol, /docs. Fetch from the relay endpoints (GET /api/devices, /api/devices/:id, /api/sales, /api/policy, /api/ledger on http://localhost:3402, base URL from NEXT_PUBLIC_RELAY_URL) and degrade to a clearly-labelled empty state when the relay is down — NEVER invent data, and always surface whether a reading is source=badge or source=simulator. A real ESP32-C3 badge is attached; read docs/BADGE.md. Load the dataviz skill before writing any chart. Done when: npm run build passes in web/ and every route in docs/FEATURES.md renders." ;;
    integrate) echo "ROUND 2. The demo arc is green and sells real badge data. Your tasks: (1) apply supabase/migrations to the linked Supabase project Datum-htn (ref dhjhsupqdmcdyqghxace) with the supabase CLI — it is already logged in and linked. (2) Once frontend reports its pages build, deploy web/ to Vercel with the vercel CLI (logged in as jashanpratapsingh, CLI 59.23.2) and append the live URL to docs/STATUS.md and the README badge line. (3) Commit work on feat/vendx-architecture-gamma with conventional-commit messages. You are the ONLY session permitted to run git commit. Never commit .keys/, .venv-pio/, or anything read off the badge. Done when: migrations applied, web deployed, URL recorded." ;;
    research)  echo "ROUND 2. The core docs exist. Now: (1) verify every claim in docs/ARCHITECTURE.md and docs/RUNBOOK.md against the code as actually built and fix drift — especially anything that still says dual-core or Xtensa, since the real badge is a single-core RISC-V ESP32-C3. (2) Write docs/API.md documenting the relay REST endpoints once backend lands them. (3) Keep docs/BADGE.md accurate. Do not invent API names; read the source. Done when docs match reality." ;;
  esac
}

prompt_for() {
  local s="$1"
  cat <<EOP
You are the '$s' session of the VENDX build fleet, working in $ROOT on branch feat/vendx-architecture-gamma.

YOUR AREA (you may write ONLY here): $(owns "$s")
YOUR GOAL: $(goal "$s")

Read docs/STATUS.md and docs/FLEET.md first, then README.md and docs/PROTOCOL.md.
packages/vendx-protocol is the single source of truth for the wire format — import it, do not redefine it.

HARD RULES
1. Never write outside your area. If you need a change elsewhere, append a BLOCKED line to docs/STATUS.md naming the owning session, and work on something else.
2. Never run 'git commit', 'git push', or any git command that writes. Only the 'integrate' session commits.
3. Append to docs/STATUS.md (never rewrite it): [timestamp] $s CLAIM|DONE|BLOCKED|IDLE area — message.
4. node is broken on PATH. Always: export PATH="$NODE_BIN:\$PATH"
5. Never use a claude.ai connector, and never let a work identity (tenstorrent, jashansinghTT) touch this repo.
6. Do not invent API names. If unsure about a library's surface, read its .d.ts in node_modules or its docs.

LOOP
Claim one task, do it, run your build, append DONE or BLOCKED. Repeat.
When your build passes and you hold no open tasks, append an IDLE line and stop.
EOP
}

cmd_up() {
  mkdir -p "$LOGS"
  command -v tmux >/dev/null || { echo "tmux missing: brew install tmux"; exit 1; }
  for s in "${SESSIONS[@]}"; do
    if tmux has-session -t "vendx-$s" 2>/dev/null; then
      echo "  = vendx-$s already up"; continue
    fi
    prompt_for "$s" > "$LOGS/$s.prompt"
    tmux new-session -d -s "vendx-$s" -c "$ROOT"
    tmux send-keys -t "vendx-$s" \
      "export PATH=\"$NODE_BIN:\$PATH\"; cd '$ROOT' && claude --permission-mode bypassPermissions -p \"\$(cat '$LOGS/$s.prompt')\" 2>&1 | tee '$LOGS/$s.log'" C-m
    echo "  + vendx-$s  owns: $(owns "$s")"
  done
  echo
  echo "fleet up. ./scripts/fleet.sh status   |   ./scripts/fleet.sh attach backend"
}

cmd_status() {
  echo "SESSIONS"
  for s in "${SESSIONS[@]}"; do
    if tmux has-session -t "vendx-$s" 2>/dev/null; then
      local n; n=$(wc -l < "$LOGS/$s.log" 2>/dev/null || echo 0)
      printf "  %-10s running   %s lines\n" "$s" "$n"
    else
      printf "  %-10s down\n" "$s"
    fi
  done
  echo
  echo "STATUS.md (last 12)"
  tail -12 "$ROOT/docs/STATUS.md" 2>/dev/null | sed 's/^/  /'
}

cmd_down() {
  for s in "${SESSIONS[@]}"; do
    tmux kill-session -t "vendx-$s" 2>/dev/null && echo "  - vendx-$s" || true
  done
}

case "${1:-status}" in
  up)     cmd_up ;;
  status) cmd_status ;;
  down)   cmd_down ;;
  attach) tmux attach -t "vendx-${2:?need session name}" ;;
  logs)   tail -f "$LOGS/${2:?need session name}.log" ;;
  *)      echo "usage: $0 {up|status|attach NAME|logs NAME|down}"; exit 1 ;;
esac
