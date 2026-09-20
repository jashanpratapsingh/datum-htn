# Manual test checklist — VENDX remaining gaps

See also `docs/PARTNER.md` for copy/paste texts to partners.

## Step 1 — Public relay (DONE on laptop; partner finishes Vercel)

Tunnel URL right now:
```
https://utilization-hints-approx-excited.trycloudflare.com
```

**Already verified:**
- Local + tunnel `GET /health` → ok
- Tunnel `GET /api/telemetry` → 402
- Startup log honest (`mode: simulator serial=COM3`)

**You:** keep relay + tunnel up. **Partner A:** set Vercel env + redeploy (`docs/PARTNER.md`).

---

## Step 2 — Real payment (blocked on funding)

Mock OK: `VENDX_SETTLEMENT=mock npm run demo:solana`

After SOL + Circle USDC:
```bash
npm run fund
npm run allowance -- --cap 5
VENDX_SETTLEMENT=devnet npm run demo:solana
node scripts/demo-hardcap.mjs
```

Treasury: `5eRPGbt3oxyjprqKFstoF8qsUfSCFSUDZ8pPaUC7AEpz`

---

## Step 3 — Host C++/TS verify (DONE — not silicon)

```bash
npm run xlang
```
Expect both PASS lines.

---

## Step 4 — Persistence

```bash
npm run test -w @vendx/relay-proxy
```
Expect 59 pass (relay 34 + sensing 25). Supabase optional: the relay persists when `SUPABASE_URL` + `SUPABASE_SECRET_KEY` are set (schema `supabase/migrations/0003_persistence.sql` onward; see RUNBOOK "Supabase").

---

## Step 5 — Ledger deploy (Mac partner)

AirDrop `solana-ledger/target/deploy/vendx_zk-keypair.json`, then:
```bash
bash scripts/deploy-ledger.sh
```
Then on laptop:
```bash
VENDX_RPC_URL=https://api.devnet.solana.com node relay-proxy/dist/index.js
curl -s localhost:3402/api/ledger
```
Expect `deployed: true`.

---

## Step 6 — Web restyle

Already in git. Ships when Partner A redeploys with the tunnel URL.

---

## Step 7 — Docs + honest mode log

Done. Restart relay and read the mode line.
