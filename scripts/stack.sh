#!/usr/bin/env bash
# The whole VENDX stack in one tmux session, so it keeps running in the background:
#
#   scripts/stack.sh up [--web]   windows: relay (real mode, Supabase-backed), tunnel (cloudflared → relay.vendx.biz),
#                                 smoke (mcp-smoke.mjs against production every 5 min), and --web adds `next dev`
#   scripts/stack.sh status       what is running, health of relay + tunnel + production MCP
#   scripts/stack.sh attach       open the session (Ctrl-b d to detach)
#   scripts/stack.sh logs [win]   tail a window's log (relay | tunnel | smoke | web)
#   scripts/stack.sh down         stop the session (relay.sh down, tunnel left to its own script)
#
# Ports: relay 3402 (scripts/relay.sh owns the pid file), web PORT (default 3000; refuses a busy port).
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.vendx"; mkdir -p "$STATE/stack"
SESSION="${VENDX_TMUX_SESSION:-vendx}"
PROD_URL="${VENDX_PROD_URL:-https://web-rouge-six-46.vercel.app}"
WEB_PORT="${PORT:-3000}"

log() { printf '[stack] %s\n' "$*"; }
win() {  # name, command
  tmux new-window -t "$SESSION" -n "$1" -d "cd '$ROOT' && ( $2 ) 2>&1 | tee -a '$STATE/stack/$1.log'"
}

cmd_up() {
  command -v tmux >/dev/null || { echo "tmux missing (brew install tmux)"; exit 1; }
  if tmux has-session -t "$SESSION" 2>/dev/null; then log "session '$SESSION' already exists; use status/attach/down"; exit 0; fi
  tmux new-session -d -s "$SESSION" -n control "cd '$ROOT' && echo 'VENDX stack. Windows: relay, tunnel, smoke$( [ "${1:-}" = "--web" ] && echo ', web' ). scripts/stack.sh status for health.' && exec bash"
  # relay.sh backgrounds the process itself; the window tails its log so the pane shows what the relay says.
  win relay "scripts/relay.sh up && exec tail -F '$STATE/relay.log'"
  win tunnel "scripts/relay-tunnel.sh up || true; exec tail -F '$STATE/cloudflared.log'"
  win smoke "while true; do date; if [ -f '$STATE/mcp-smoke.env' ]; then set -a; . '$STATE/mcp-smoke.env'; set +a; fi; MCP_URL='$PROD_URL/api/mcp' node scripts/mcp-smoke.mjs || echo 'SMOKE FAILED'; sleep 300; done"
  if [ "${1:-}" = "--web" ]; then
    if lsof -nP -iTCP:"$WEB_PORT" -sTCP:LISTEN >/dev/null 2>&1; then log "port $WEB_PORT is busy; not starting next dev (set PORT=…)"; else
      win web "cd web && PORT=$WEB_PORT npx next dev -p $WEB_PORT"
    fi
  fi
  log "session '$SESSION' up. scripts/stack.sh attach | status | logs relay"
}

cmd_status() {
  tmux has-session -t "$SESSION" 2>/dev/null && { log "tmux windows:"; tmux list-windows -t "$SESSION" -F '  #{window_name}  #{pane_current_command}'; } || log "no tmux session '$SESSION'"
  printf '[stack] relay :3402  '; curl -s -m 3 http://localhost:3402/health || echo "not answering"; echo
  printf '[stack] relay.vendx.biz  '; curl -s -m 8 https://relay.vendx.biz/health || echo "not answering"; echo
  printf '[stack] production MCP  '; curl -s -m 8 -o /dev/null -w 'POST /api/mcp anonymous → %{http_code} (401 expected)\n' -X POST "$PROD_URL/api/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
  [ -f "$STATE/stack/smoke.log" ] && { printf '[stack] last smoke: '; grep -E 'checks passed|SMOKE FAILED' "$STATE/stack/smoke.log" | tail -1; }
}

cmd_down() {
  tmux kill-session -t "$SESSION" 2>/dev/null && log "session '$SESSION' killed" || log "no session"
  "$ROOT/scripts/relay.sh" down || true
}

case "${1:-}" in
  up) cmd_up "${2:-}" ;;
  status) cmd_status ;;
  attach) exec tmux attach -t "$SESSION" ;;
  logs) exec tail -F "$STATE/stack/${2:-relay}.log" ;;
  down) cmd_down ;;
  *) sed -n '2,11p' "$0"; exit 2 ;;
esac
