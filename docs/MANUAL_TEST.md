# Manual test checklist — VENDX remaining gaps

## Step 1 — Public relay (DONE on laptop; you finish Vercel)

Tunnel URL right now:
```
https://utilization-hints-approx-excited.trycloudflare.com
```

**Already verified by agent:**
- Local `GET /health` → ok
- Tunnel `GET /health` → ok
- Tunnel `GET /api/telemetry` → 402
- Tunnel `GET /api/sales` → `{"sales":[]}`
- Startup log: `mode: simulator  serial=COM3` (honest)

**You do:**
1. Keep the laptop relay + tunnel running (`node relay-proxy/dist/index.js` and `npm run tunnel`).
2. In a browser (phone is fine): open  
   `https://utilization-hints-approx-excited.trycloudflare.com/health`  
   Expect `{"status":"ok",…}`.
3. Vercel → Settings → Environment Variables → set  
   `NEXT_PUBLIC_RELAY_URL` = that URL (no trailing slash) → Redeploy Production.
4. Open the live Vercel site → Devices / Marketplace should **not** show RelayOffline.

If the tunnel URL changed after a restart, update Vercel again (quick tunnels are ephemeral).

---

## Step 2 — Real payment (blocked on funding — do this next)

Mock path already passed end-to-end (`VENDX_SETTLEMENT=mock npm run demo:solana`).

**You fund:**
1. Devnet SOL for fees → https://faucet.solana.com  
   - Agent: `2aXFqqaPZcTxe8KWCGTEuBRWZ36Ke5S7qrgaBvtq55x2`  
   - Treasury: `5eRPGbt3oxyjprqKFstoF8qsUfSCFSUDZ8pPaUC7AEpz`  
   - Vendor: `3GwvCsZ69gUbmgai8orUNKZb6YJLWbAYdo1N9hSGsYyT`
2. Devnet USDC → https://faucet.circle.com → Solana Devnet → treasury address above.
3. Then run:
```bash
npm run fund
npm run allowance -- --cap 5
VENDX_SETTLEMENT=devnet npm run demo:solana
```
Expect a real Solscan tx (not `MOCK…`), receipt signed after chain verify, buyer gets DATA.

Tell me when SOL+USDC are funded and I’ll finish the hard-cap demo + capture the rejection.

---

## Step 3 — Host C++/TS verify (DONE — not silicon)

```bash
npm run xlang
```
Expect:
```
PASS  valid receipt accepted
PASS  tampered receipt rejected
CLAIM: TypeScript signer and C tweetnacl verifier agree on host (not silicon).
```
On Mac: `firmware-vendor/test/run.sh` does the same with `cc`.

---

## Step 4 — Persistence (in-memory proven; Supabase optional)

```bash
npm run test -w @vendx/relay-proxy
```
Expect 50 pass (includes `persist.test.ts`).

To survive restarts:
1. Apply `supabase/migrations/0002_sales.sql` on your project
2. Set `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` on the relay process
3. Restart relay → log says `persistence: Supabase`
4. Make a sale, restart, `GET /api/sales` still has it
