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
    backend)   echo "ROUND 3. Builds are green and the Anchor .so compiles. Remaining: (1) UNBLOCK THE IDL — 'anchor build' fails at IDL generation because anchor-syn 0.30.1 calls proc_macro2::Span::source_file(), removed in nightly >=1.100. Try in order: pin a nightly older than 1.100 for the idl-build step; OR bump Anchor via avm (run 'avm list'; 0.31.1/0.32.2 exist) and fix the API drift; OR pin proc-macro2 in Cargo.toml. Verify with a real 'anchor build' that emits target/idl/vendx_zk.json. (2) Add unit tests for the policy engine in agent-buyer proving the \$5.00/day cap trips, that it survives a restart via the persisted ledger, and that a per-request cap rejects an over-priced challenge. Done when: anchor build emits an IDL (or all three routes are tried and the exact failure documented) and 'npm test -w @vendx/agent-buyer' passes." ;;
    frontend)  echo "ROUND 3. All 12 routes build. Raise the quality bar. Load the frontend-design skill FIRST and apply it (it wins over ui-ux-pro-max on conflict). (1) The feature pages are functional but plain — give them real visual hierarchy, genuine empty states, loading skeletons, and typography consistent with the Inter/Instrument Serif system in globals.css. (2) /agent is the money shot: make the 9-step handshake legible as it runs. (3) Load the dataviz skill before any chart — the reset-reason histogram on /devices/[id] and the policy burn-down on /policy must read well on dark. (4) Use the webapp-testing skill (Playwright) to confirm each route renders and the mobile menu traps focus. NEVER invent data: a real ESP32-C3 badge is attached, readBadge() returns genuine values, always show source=badge vs simulator. Done when npm run build passes AND you have loaded pages in a browser to check." ;;
    integrate) echo "ROUND 3. Live at https://web-rouge-six-46.vercel.app, Supabase migrated. (1) Re-deploy to Vercel once frontend lands round 3, and curl the live URL to confirm it actually serves the new build — do not assume. (2) Keep docs/STATUS.md honest. (3) Commit with conventional-commit messages on feat/vendx-architecture-gamma. You are the ONLY session permitted to run git commit. Never commit .keys/, .venv-pio/, solana-ledger/target/, or anything read off the badge — especially identity.json or solana.json contents. Done when the live URL serves round 3 and all work is committed." ;;
    research)  echo "ROUND 3. Docs are accurate. (1) Write docs/DEMO.md: a tight 3-minute demo script — what to run, what to point at, what a judge should understand at each step; cover both the badge-attached and no-badge paths. (2) Verify docs/BADGE.md against the live device (attached and responding) and add anything missing about the console API. (3) Keep README SHORT — it links out, it does not duplicate. Do not invent API names: read the source, or probe read-only via 'scripts/badge.py cmd'. NEVER reflash or erase the badge. Done when DEMO.md exists and docs match reality." ;;
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
