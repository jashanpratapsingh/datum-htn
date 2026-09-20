# What to tell your partners (simple)

Do **not** commit secrets. Do **not** regenerate the program keypair.

---

## Partner A — Vercel (2 steps)

Text them:

> 1. In Vercel → our project → Settings → Environment Variables, set  
> `NEXT_PUBLIC_RELAY_URL` = `https://utilization-hints-approx-excited.trycloudflare.com`  
> (no slash at the end)  
> 2. Redeploy Production.
>
> Nilay’s laptop must keep the relay + tunnel running. If the site still says offline, ask him for a fresh tunnel URL.

---

## Partner B — Mac (ledger deploy)

Text them:

> 1. Get the repo on branch `feat/vendx-solana-spine`, and AirDrop from Nilay:  
> `solana-ledger/target/deploy/vendx_zk-keypair.json`  
> (put it in that same path — do not make a new keypair)
> 2. Install Solana CLI + Rust if needed, fund your Solana CLI wallet with a bit of **devnet SOL**, then run:
>
> ```bash
> bash scripts/deploy-ledger.sh
> ```
>
> 3. Tell Nilay when it prints DONE. He will restart the relay with  
> `VENDX_RPC_URL=https://api.devnet.solana.com`  
> and check `/api/ledger` shows `deployed: true`.

Optional: also copy `keys/vendor.json` if they need to run `init-ledger` themselves (script uses it). Prefer Nilay runs init on the laptop after deploy if keys stay on the laptop.

---

## You (Nilay) — after they finish

```bash
# after Vercel partner
# open the live site → Devices should load

# after Mac partner
export VENDX_RPC_URL=https://api.devnet.solana.com
node relay-proxy/dist/index.js
curl -s http://localhost:3402/api/ledger
# expect deployed: true

# when wallets are funded (Circle + Solana faucets)
npm run fund
npm run allowance -- --cap 5
VENDX_SETTLEMENT=devnet npm run demo:solana
node scripts/demo-hardcap.mjs   # expects a REJECT
```
