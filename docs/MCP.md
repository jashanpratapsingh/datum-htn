# VENDX MCP server

`packages/vendx-mcp` exposes VENDX as an MCP connector, so any MCP-speaking
agent — Claude Code, Claude Desktop, or another party's buyer bot — can browse
what a VENDX relay has listed for sale and pay for a reading, without
shelling out to `agent-buyer`'s CLI or hand-rolling the 402 handshake.

It is a thin skin over the existing surfaces, not a second implementation of
them:

- The read/listing tools call `relay-proxy`'s REST API (`docs/API.md`)
  directly.
- `vendx_buy_telemetry` constructs the same `Buyer` class
  `agent-buyer/src/buy.ts` uses, so the daily `SpendPolicy` cap and the
  on-chain SPL Token delegate allowance both still apply. This server cannot
  spend past either.
- No tool grants or revokes the on-chain allowance. `npm run allowance` stays
  a manual, human-run step — changing spending authority is a different class
  of risk than spending within an authority a human already granted.

## Tools

| Tool | Talks to | What it does |
| --- | --- | --- |
| `vendx_list_devices` | relay-proxy `:3402` | List devices for sale: id, price, source (badge/simulator), lifetime sales. |
| `vendx_get_device` | relay-proxy `:3402` | One device's detail + up to 50 recent sales. |
| `vendx_get_sales` | relay-proxy `:3402` | All settlement records this relay has seen since it started. |
| `vendx_get_ledger` | relay-proxy `:3402` | ZK-compressed on-chain settlement summary. |
| `vendx_check_budget` | relay-proxy `:3402` | The buyer's soft daily USDC spend cap and remaining balance. |
| `vendx_check_allowance` | Solana RPC (read-only) | The HARD on-chain delegate allowance — the authoritative limit. |
| `vendx_buy_telemetry` | vendor node `:4021` + facilitator `:4022` | Runs the full 402 → policy → pay → receipt → 200 arc and returns the data. |

## Setup

```bash
npm install
npm run build                    # builds every workspace, including @vendx/mcp-server
```

Start the surfaces the tools need:

```bash
npm run demo          # relay-proxy on :3402 — needed for every read/listing tool
npm run demo:solana   # node + facilitator on :4021/:4022 — needed for vendx_buy_telemetry
```

Register the connector with Claude Code:

```bash
claude mcp add vendx -- node packages/vendx-mcp/dist/server.js
```

(Run from the repo root, or set `cwd`/`VENDX_ROOT` explicitly — see below.)

## Configuration

All of it is optional; every tool also accepts the matching argument to
target a different relay/node/facilitator per call (e.g. to buy from a
different party's node without restarting the connector).

| Env var | Default | Same as |
| --- | --- | --- |
| `VENDX_RELAY_URL` | `http://127.0.0.1:3402` | — |
| `VENDX_NODE_URL` | `http://127.0.0.1:4021` | `agent-buyer` CLI default |
| `VENDX_FACILITATOR_URL` | `http://127.0.0.1:4022` | `agent-buyer` CLI default |
| `VENDX_NETWORK` | `solana-devnet` | `agent-buyer` CLI default |
| `VENDX_RPC_URL` | `https://api.devnet.solana.com` | `agent-buyer` CLI default |
| `VENDX_SETTLEMENT` | `mock` | `agent-buyer` CLI default — set `devnet` to move real devnet USDC |
| `VENDX_RESOURCE` | `/api/telemetry` | `agent-buyer` CLI default |
| `VENDX_ROOT` | the repo root (derived from the compiled file's own path) | owns `keys/` and `data/spend-ledger.json` |

## A note on stdout

MCP over stdio uses stdout as the JSON-RPC channel. `Buyer` (and the modules
it calls) log a human-readable trace via `console.log`. `vendx_buy_telemetry`
temporarily redirects `console.log` to stderr for the duration of the call so
that trace still shows up in the host's MCP server logs without corrupting
the protocol framing.
