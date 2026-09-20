#!/usr/bin/env node
/**
 * Smoke-test the VENDX remote MCP server over plain HTTP (no MCP SDK).
 *
 *   export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
 *   MCP_URL=https://vendx.biz/api/mcp VENDX_API_KEY=vendx_sk_… node scripts/mcp-smoke.mjs
 *   SMOKE_BUY=1 SMOKE_DEVICE=<relayKey:deviceId> …      # also buy ONE reading (real devnet USDC)
 *
 * Checks, in order: unauthenticated POST → 401 with resource_metadata;
 * discovery documents; initialize; tools/list has the five tools;
 * vendx_budget_status answers; optionally one purchase. Exit code 0 only if
 * every check passed. Never prints the key.
 */
const MCP_URL = process.env.MCP_URL ?? 'http://localhost:3005/api/mcp';
const KEY = process.env.VENDX_API_KEY;
const origin = new URL(MCP_URL).origin;
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const H = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };
const auth = KEY ? { Authorization: `Bearer ${KEY}` } : {};
let id = 0;
async function rpc(method, params = {}) {
  const res = await fetch(MCP_URL, { method: 'POST', headers: { ...H, ...auth }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    // SSE fallback: take the last data: line
    const m = [...text.matchAll(/^data: (.*)$/gm)].pop();
    if (m) body = JSON.parse(m[1]);
  }
  return { status: res.status, body, headers: res.headers };
}
function toolJson(r) {
  const text = r.body?.result?.content?.[0]?.text;
  return text ? JSON.parse(text) : null;
}

// 1. anonymous → 401 + hint
{
  const res = await fetch(MCP_URL, { method: 'POST', headers: H, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
  const www = res.headers.get('www-authenticate') ?? '';
  check('anonymous POST is 401', res.status === 401, `status ${res.status}`);
  check('WWW-Authenticate names resource_metadata', /resource_metadata="[^"]+"/.test(www), www.slice(0, 120));
}
// 2. discovery
{
  const prm = await fetch(`${origin}/.well-known/oauth-protected-resource/api/mcp`).then((r) => r.json()).catch(() => null);
  check('protected resource metadata', prm?.resource === MCP_URL && Array.isArray(prm?.authorization_servers), JSON.stringify(prm)?.slice(0, 100));
  const as = await fetch(`${origin}/.well-known/oauth-authorization-server`).then((r) => r.json()).catch(() => null);
  check('authorization server metadata', !!as?.authorization_endpoint && !!as?.token_endpoint && !!as?.registration_endpoint && as?.code_challenge_methods_supported?.includes('S256'));
}
if (!KEY) {
  console.log('\nVENDX_API_KEY not set: skipping authenticated checks.');
} else {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'vendx-smoke', version: '0' } });
  check('initialize', init.status === 200 && init.body?.result?.serverInfo?.name === 'vendx', `status ${init.status} ${JSON.stringify(init.body?.error ?? '')}`);
  const notified = await fetch(MCP_URL, { method: 'POST', headers: { ...H, ...auth }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  check('notifications/initialized accepted', notified.status === 202 || notified.status === 200, `status ${notified.status}`);
  const list = await rpc('tools/list');
  const names = (list.body?.result?.tools ?? []).map((t) => t.name).sort();
  check('tools/list has the five tools', names.length === 5 && names.includes('vendx_buy_reading'), names.join(', '));
  const budget = await rpc('tools/call', { name: 'vendx_budget_status', arguments: {} });
  const b = toolJson(budget);
  check('vendx_budget_status', budget.status === 200 && !budget.body?.result?.isError && !!b?.wallet?.pubkey, b ? `wallet ${b.wallet?.pubkey} · ${b.wallet?.usd} USDC · caps ${b.caps?.perRequestUsd}/${b.caps?.dailyUsd}` : JSON.stringify(budget.body).slice(0, 200));
  const devices = await rpc('tools/call', { name: 'vendx_list_devices', arguments: {} });
  const d = toolJson(devices);
  check('vendx_list_devices', devices.status === 200 && Array.isArray(d?.devices), `${d?.count ?? '?'} device(s): ${(d?.devices ?? []).map((x) => `${x.id} [${x.source}, ${x.state}]`).join('; ')}`);
  if (process.env.SMOKE_BUY === '1') {
    const device = process.env.SMOKE_DEVICE ?? d?.devices?.find((x) => x.state === 'live')?.id;
    if (!device) check('buy: a live device to buy from', false, 'none listed');
    else {
      const buy = await rpc('tools/call', { name: 'vendx_buy_reading', arguments: { device } });
      const r = toolJson(buy);
      const ok = buy.status === 200 && !buy.body?.result?.isError && r?.readings?.length === 1;
      check('vendx_buy_reading (real devnet USDC)', ok, ok ? `${r.readings[0].amountMicroUsdc} µUSDC · source=${r.readings[0].source} · ${r.readings[0].solscanUrl}` : JSON.stringify(r ?? buy.body).slice(0, 300));
    }
  }
}
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
