#!/usr/bin/env bash
# One command for the local VENDX stack: relay-proxy on :3402 and the Next.js
# site on :3000, with env from ~/.vendx/dev.env.
#
#   scripts/dev.sh up [demo|real] [--restart]   start both (default demo: simulator + trust settlement)
#   scripts/dev.sh down                          stop what dev.sh started
#   scripts/dev.sh status                        what is running, and with what
#   scripts/dev.sh logs                          tail relay + web logs
#
# Ownership rules, because other things use these ports on this laptop:
#   - A relay already on :3402 is adopted when scripts/relay.sh started it
#     (pid file + command line match); pass --restart to replace it. Anything
#     else on :3402 is left alone and reported.
#   - :3000 is only ever taken or killed when the pid is the one dev.sh wrote.
#   - `down` stops the relay only if `up` started it.
set -euo pipefail

export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.vendx"
ENV_FILE="$STATE/dev.env"
WEB_PID="$STATE/web-dev.pid"
WEB_LOG="$STATE/web-dev.log"
RELAY_OWNED="$STATE/dev.relay-owned"
RELAY_PID="$STATE/relay.pid"
mkdir -p "$STATE"

say() { printf '%s\n' "$*"; }
die() { say "dev.sh: $*" >&2; exit 1; }

load_env() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ROOT/scripts/dev.env.example" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    die "created $ENV_FILE from scripts/dev.env.example — fill in SUPABASE_SERVICE_KEY and SESSION_SECRET, then rerun"
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

port_pid() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | head -1 || true; }
pid_cmd() { ps -o command= -p "$1" 2>/dev/null || true; }
alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

relay_owned_by_relay_sh() {
  local pid
  pid="$(cat "$RELAY_PID" 2>/dev/null || true)"
  alive "$pid" && pid_cmd "$pid" | grep -q 'relay-proxy/dist/index.js'
}

relay_health() { curl -s -m 2 http://localhost:3402/health 2>/dev/null || true; }

web_code() { curl -s -m 3 -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null || echo 000; }

start_relay() {
  local mode="$1" restart="$2" bound
  bound="$(port_pid 3402)"
  if [ -n "$bound" ]; then
    if relay_owned_by_relay_sh; then
      if [ "$restart" = 1 ]; then
        say "relay: restarting via scripts/relay.sh $mode"
        "$ROOT/scripts/relay.sh" down >/dev/null 2>&1 || true
      else
        local have want
        have="$(cat "$STATE/relay.mode" 2>/dev/null || echo '?')"
        want="$([ "$mode" = real ] && echo up || echo demo)"
        say "relay: adopting the one scripts/relay.sh already runs on :3402 (mode file: $have)"
        case "$have" in *"$want"*) ;; *) say "relay: note — you asked for '$mode'; pass --restart to switch" ;; esac
        return 0
      fi
    else
      say "relay: :3402 is held by something dev.sh did not start — leaving it alone:"
      lsof -nP -iTCP:3402 -sTCP:LISTEN 2>/dev/null | tail -n +2 || true
      return 0
    fi
  fi
  if [ "$mode" = real ]; then "$ROOT/scripts/relay.sh" up; else "$ROOT/scripts/relay.sh" demo; fi
  touch "$RELAY_OWNED"
}

start_web() {
  local bound mine
  bound="$(port_pid 3000)"
  mine="$(cat "$WEB_PID" 2>/dev/null || true)"
  if [ -n "$bound" ]; then
    if [ "$bound" = "$mine" ]; then
      say "web: already running (pid $bound)"
      return 0
    fi
    say "web: :3000 is held by pid $bound, not started by dev.sh — stop it first:"
    pid_cmd "$bound"
    return 1
  fi
  say "web: starting next dev on :3000 (log: $WEB_LOG)"
  (
    cd "$ROOT/web"
    nohup npm run dev >"$WEB_LOG" 2>&1 &
    echo $! >"$WEB_PID"
  )
  local i
  for i in $(seq 1 45); do
    case "$(web_code)" in 200|3*) say "web: up — http://localhost:3000"; return 0 ;; esac
    sleep 1
  done
  say "web: no answer on :3000 after 45 s — see $WEB_LOG"
  tail -20 "$WEB_LOG" || true
  return 1
}

cmd_up() {
  local mode=demo restart=0 a
  for a in "$@"; do
    case "$a" in
      demo|real) mode="$a" ;;
      --restart) restart=1 ;;
      *) die "unknown argument '$a' (up [demo|real] [--restart])" ;;
    esac
  done
  load_env
  start_relay "$mode" "$restart"
  start_web
  cmd_status
}

cmd_down() {
  local pid bound
  pid="$(cat "$WEB_PID" 2>/dev/null || true)"
  if alive "$pid"; then
    say "web: stopping pid $pid"
    pkill -P "$pid" 2>/dev/null || true
    kill "$pid" 2>/dev/null || true
    sleep 1
    if alive "$pid"; then kill -9 "$pid" 2>/dev/null || true; fi
  else
    say "web: not running (no live pid in $WEB_PID)"
  fi
  rm -f "$WEB_PID"
  bound="$(port_pid 3000)"
  if [ -n "$bound" ]; then
    say "web: :3000 is still held by pid $bound ($(pid_cmd "$bound")) — not ours, left alone"
  fi
  if [ -f "$RELAY_OWNED" ]; then
    say "relay: stopping (dev.sh started it)"
    "$ROOT/scripts/relay.sh" down || true
    rm -f "$RELAY_OWNED"
  else
    say "relay: left running (not started by dev.sh)"
  fi
}

cmd_status() {
  local h pid code
  say "env:    $([ -f "$ENV_FILE" ] && echo "$ENV_FILE" || echo 'missing (run up once)')"
  h="$(relay_health)"
  if [ -n "$h" ]; then
    say "relay:  :3402 $h $([ -f "$RELAY_OWNED" ] && echo '(started by dev.sh)' || echo '(adopted)')"
  else
    say "relay:  :3402 not answering"
  fi
  pid="$(cat "$WEB_PID" 2>/dev/null || true)"
  code="$(web_code)"
  if [ "$code" != 000 ]; then
    say "web:    :3000 HTTP $code $(alive "$pid" && echo "(pid $pid)" || echo '(not started by dev.sh)')"
  else
    say "web:    :3000 not answering"
  fi
}

cmd_logs() { tail -n 40 -f "$STATE/relay.log" "$WEB_LOG"; }

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) cmd_down ;;
  status) cmd_status ;;
  logs) cmd_logs ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
