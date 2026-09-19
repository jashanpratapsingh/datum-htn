# Public relay tunnel

Quick tunnel hostname changes every restart. Current live URL (laptop relay on `:3402`):

```
https://utilization-hints-approx-excited.trycloudflare.com
```

Verified locally:
- `GET /health` → `{"status":"ok","mode":"simulator"}`
- `GET /api/telemetry` → `402`
- `GET /api/sales` → `{"sales":[]}`

## Keep it up

```bash
# terminal 1
npm run build -w @vendx/relay-proxy && node relay-proxy/dist/index.js

# terminal 2
npm run tunnel
# or: tools/cloudflared.exe tunnel --url http://localhost:3402
```

## Point the deployed site at it

1. Vercel → Project → Settings → Environment Variables
2. Set `NEXT_PUBLIC_RELAY_URL` = the `https://….trycloudflare.com` URL (no trailing slash)
3. Redeploy Production (`vercel --prod` from `web/`, or Redeploy in the dashboard)
4. Open the live site → Devices / Marketplace should load (not RelayOffline)
5. From any machine: `curl https://YOUR_TUNNEL/health`
