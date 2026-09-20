#!/usr/bin/env bash
# Deploy the VENDX web app (marketplace, dashboard, remote MCP server) to Vercel
# and keep Supabase in step. Every verb is idempotent and prints what it did.
#
#   scripts/deploy.sh check            tooling, logins, required env NAMES present in ~/.vendx/web-mcp.env
#   scripts/deploy.sh migrate          supabase migration list + db push --linked (hosted project Datum-htn)
#   scripts/deploy.sh env [preview]    push the env file's values to Vercel production (+preview) — values never echoed
#   scripts/deploy.sh build            clean build: protocol → pack tarball if changed → relay tests → next build
#   scripts/deploy.sh preview          vercel deploy of the current checkout → prints the preview URL, runs verify on it
#   scripts/deploy.sh release          push branch, open/merge the PR (git-linked Vercel builds main into production)
#   scripts/deploy.sh verify [url]     discovery docs, 401 hint, then scripts/mcp-smoke.mjs with the smoke key
#   scripts/deploy.sh relay            restart the laptop relay from THIS checkout (Supabase-backed, real mode)
#   scripts/deploy.sh all              check → migrate → env → build → preview
#
# Env file: ~/.vendx/web-mcp.env (chmod 600). Names it must hold are in REQUIRED below.
set -euo pipefail
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE="$HOME/.vendx"
ENV_FILE="${VENDX_WEB_ENV:-$STATE/web-mcp.env}"
PROJECT_REF="dhjhsupqdmcdyqghxace"
PROD_URL="${VENDX_PROD_URL:-https://vendx.biz}"

REQUIRED=(
  SUPABASE_URL SUPABASE_SERVICE_KEY SESSION_SECRET
  NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  NEXT_PUBLIC_RELAY_URL NEXT_PUBLIC_SOLANA_RPC_URL
  VENDX_WEB_SECRET VENDX_WEB_BUYER_KEYPAIR VENDX_WALLET_KEK
)
OPTIONAL=(VENDX_SITE_URL NEXT_PUBLIC_RELAYS SIWS_ALLOWED_DOMAINS VENDX_WEB_MAX_MICRO_USDC VENDX_SOLANA_RPC)

say() { printf '\n[deploy] %s\n' "$*"; }
die() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }
have_var() { grep -qE "^$1=." "$ENV_FILE"; }

cmd_check() {
  say "tooling"
  node --version | grep -q '^v22\.' || die "node 22 not on PATH (nvm use)"
  command -v vercel >/dev/null || die "vercel CLI missing (npm i -g vercel)"
  command -v supabase >/dev/null || die "supabase CLI missing"
  command -v gh >/dev/null || die "gh CLI missing"
  say "logins"
  [ -f "$ROOT/.vercel/project.json" ] || die "repo root is not linked to the Vercel project (copy .vercel/ from a linked checkout; Root Directory is web)"
  local who; who="$(vercel whoami 2>/dev/null | tail -1)"; [ "$who" = "jashanpratapsingh" ] || die "vercel is logged in as '$who', expected jashanpratapsingh"
  gh auth status 2>&1 | grep -q 'Logged in to github.com account jashanpratapsingh' || die "gh is not logged in as jashanpratapsingh"
  [ "$(git -C "$ROOT" config user.email)" = "88160290+jashanpratapsingh@users.noreply.github.com" ] || [ "$(git -C "$ROOT" config user.email)" = "jashanpratap123@gmail.com" ] || die "git identity is not the personal one"
  say "env file $ENV_FILE"
  [ -f "$ENV_FILE" ] || die "missing; copy web/.env.example there, fill it, chmod 600"
  [ "$(stat -f '%Lp' "$ENV_FILE")" = "600" ] || echo "[deploy] WARNING: $ENV_FILE is not chmod 600"
  local missing=0
  for v in "${REQUIRED[@]}"; do if have_var "$v"; then echo "  ✓ $v"; else echo "  ✗ $v (required)"; missing=1; fi; done
  for v in "${OPTIONAL[@]}"; do if have_var "$v"; then echo "  ✓ $v"; else echo "  · $v (optional)"; fi; done
  [ "$missing" = 0 ] || die "fill the missing variables first"
  say "supabase link"
  [ -f "$ROOT/supabase/.temp/project-ref" ] && [ "$(cat "$ROOT/supabase/.temp/project-ref")" = "$PROJECT_REF" ] || echo "[deploy] WARNING: supabase/.temp is not linked to $PROJECT_REF (copy it from a linked checkout)"
  say "check passed"
}

cmd_migrate() {
  cd "$ROOT"
  say "migrations on $PROJECT_REF"
  supabase migration list --linked 2>&1 | tail -3
  supabase db push --linked --include-all 2>&1 | grep -v '^$' | tail -5
}

cmd_env() {
  cd "$ROOT"  # the Vercel project has Root Directory = web, so the link and every vercel command live at the repo root
  local targets=(production); [ "${1:-}" = "preview" ] && targets+=(preview)
  say "pushing ${#REQUIRED[@]}+ variables to Vercel: ${targets[*]} (values are never printed)"
  for v in "${REQUIRED[@]}" "${OPTIONAL[@]}"; do
    have_var "$v" || continue
    local value; value="$(sed -n "s/^$v=//p" "$ENV_FILE" | head -1)"
    # VENDX_SITE_URL must be the public origin in production, never a localhost value from a dev env file.
    if [ "$v" = "VENDX_SITE_URL" ] && printf '%s' "$value" | grep -q localhost; then echo "  · $v skipped (localhost)"; continue; fi
    for t in "${targets[@]}"; do
      vercel env rm "$v" "$t" --yes >/dev/null 2>&1 || true
      printf '%s' "$value" | vercel env add "$v" "$t" >/dev/null 2>&1 && echo "  ✓ $v → $t" || echo "  ✗ $v → $t"
    done
  done
}

cmd_build() {
  cd "$ROOT"
  say "protocol"
  npm run build -w @vendx/protocol >/dev/null
  if ! git diff --quiet HEAD~5 -- packages/vendx-protocol 2>/dev/null; then
    say "protocol changed recently: re-packing web/vendx-protocol.tgz"; scripts/pack-protocol.sh
  fi
  say "relay tests"; npm test -w @vendx/relay-proxy 2>&1 | grep -E '^# (pass|fail)'
  say "web unit tests"; (cd web && npm run test:unit 2>&1 | grep -E '^# (pass|fail)')
  say "next build"; (cd web && npm run build 2>&1 | tail -4)
}

cmd_verify() {
  local base="${1:-$PROD_URL}"
  say "verify $base"
  curl -fsS "$base/.well-known/oauth-protected-resource/api/mcp" | grep -q '"resource"' && echo "  ✓ protected resource metadata" || die "no resource metadata at $base"
  curl -fsS "$base/.well-known/oauth-authorization-server" | grep -q '"authorization_endpoint"' && echo "  ✓ authorization server metadata"
  local code; code="$(curl -s -o /dev/null -w '%{http_code}' -X POST "$base/api/mcp" -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' --data '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
  [ "$code" = "401" ] && echo "  ✓ anonymous MCP call is 401" || die "expected 401 from $base/api/mcp, got $code"
  if [ -f "$STATE/mcp-smoke.env" ]; then
    say "smoke with the test agent key"
    set -a; . "$STATE/mcp-smoke.env"; set +a
    MCP_URL="$base/api/mcp" node "$ROOT/scripts/mcp-smoke.mjs"
  else
    echo "  · no $STATE/mcp-smoke.env: skipping the authenticated smoke (mint a key on /account and put VENDX_API_KEY=… there)"
  fi
}

cmd_preview() {
  cd "$ROOT"
  say "vercel preview deploy"
  local out; out="$(vercel deploy --yes 2>&1)" || { printf '%s\n' "$out" | tail -5; die "vercel deploy failed"; }
  local url; url="$(printf '%s\n' "$out" | grep -Eo 'https://[a-z0-9.-]+\.vercel\.app' | tail -1)"
  [ -n "$url" ] || die "vercel deploy printed no URL"
  echo "  preview: $url"
  echo "$url" > "$STATE/web-preview-url"
  cmd_verify "$url"
}

cmd_release() {
  cd "$ROOT"
  local branch; branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" != "main" ] || die "release runs from a feature branch"
  git diff --quiet && git diff --cached --quiet || die "commit or stash your changes first"
  say "push $branch"; git push -u origin "$branch"
  if ! gh pr view "$branch" >/dev/null 2>&1; then
    say "open PR"; gh pr create --fill --base main
  fi
  say "merge (Vercel builds main into production)"; gh pr merge "$branch" --merge --delete-branch
  say "waiting for production"; sleep 90; cmd_verify "$PROD_URL"
}

cmd_relay() {
  say "restarting the laptop relay from $ROOT (Supabase-backed, verify mode)"
  [ -f "$STATE/relay.env" ] || die "$STATE/relay.env missing (SUPABASE_URL, SUPABASE_SECRET_KEY, VENDX_WEB_SECRET, VENDX_RELAY_LABEL)"
  (cd "$ROOT/relay-proxy" && npm run build >/dev/null)
  "$ROOT/scripts/relay.sh" up
  sleep 2; "$ROOT/scripts/relay.sh" status | tail -4
  curl -s "https://relay.vendx.biz/health" | grep -q supabase && echo "  ✓ relay.vendx.biz reports Supabase persistence" || echo "  · relay.vendx.biz not yet reporting the new build (tunnel up? scripts/relay-tunnel.sh status)"
}

case "${1:-}" in
  check) cmd_check ;;
  migrate) cmd_migrate ;;
  env) cmd_env "${2:-}" ;;
  build) cmd_build ;;
  preview) cmd_preview ;;
  release) cmd_release ;;
  verify) cmd_verify "${2:-}" ;;
  relay) cmd_relay ;;
  all) cmd_check; cmd_migrate; cmd_env preview; cmd_build; cmd_preview ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
