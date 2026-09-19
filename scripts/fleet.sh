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
    backend)   echo "agent-buyer (index/policy/wallet with a persisted \$5.00/day cap), relay-proxy (facilitator + ESP32 simulator), and the solana-ledger Anchor program. Done when: npm run build passes in agent-buyer and relay-proxy, and the simulator serves a 402 that agent-buyer can pay end to end." ;;
    frontend)  echo "the Next.js 16 + Tailwind 4 app in web/, implementing docs/FRONTEND_BRIEF.md exactly, re-skinned to VENDX. Done when: npm run build passes and the hero renders with the HLS video, liquid-glass card and working mobile menu." ;;
    integrate) echo "wiring the pieces: run the end-to-end demo, set up Supabase migrations, deploy web/ to Vercel, and keep docs/STATUS.md honest. You are the ONLY session permitted to run git commit. Done when: the demo arc runs green and the repo is committed." ;;
    research)  echo "docs/: ARCHITECTURE.md, RUNBOOK.md, FLEET.md and FRONTEND_BRIEF.md. Done when all four exist, are accurate against the code as built, and contain no invented API names." ;;
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
    if tmux has-session -t "vendx:$s" 2>/dev/null; then
      echo "  = vendx:$s already up"; continue
    fi
    prompt_for "$s" > "$LOGS/$s.prompt"
    tmux new-session -d -s "vendx:$s" -c "$ROOT"
    tmux send-keys -t "vendx:$s" \
      "export PATH=\"$NODE_BIN:\$PATH\"; cd '$ROOT' && claude --permission-mode bypassPermissions -p \"\$(cat '$LOGS/$s.prompt')\" 2>&1 | tee '$LOGS/$s.log'" C-m
    echo "  + vendx:$s  owns: $(owns "$s")"
  done
  echo
  echo "fleet up. ./scripts/fleet.sh status   |   ./scripts/fleet.sh attach backend"
}

cmd_status() {
  echo "SESSIONS"
  for s in "${SESSIONS[@]}"; do
    if tmux has-session -t "vendx:$s" 2>/dev/null; then
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
    tmux kill-session -t "vendx:$s" 2>/dev/null && echo "  - vendx:$s" || true
  done
}

case "${1:-status}" in
  up)     cmd_up ;;
  status) cmd_status ;;
  down)   cmd_down ;;
  attach) tmux attach -t "vendx:${2:?need session name}" ;;
  logs)   tail -f "$LOGS/${2:?need session name}.log" ;;
  *)      echo "usage: $0 {up|status|attach NAME|logs NAME|down}"; exit 1 ;;
esac
