import { test, expect, type APIRequestContext } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

/**
 * The remote MCP server and its OAuth 2.1 authorization server.
 *
 * Always: discovery documents, the 401 challenge, client registration rules,
 * the consent page's login redirect, and the /connect page.
 *
 * With E2E_SUPABASE=1: a real account signs up, a dynamically registered
 * client goes through consent (new agent + caps), exchanges the code with
 * PKCE, calls the MCP server with the access token, rotates the refresh
 * token, sees the agent on the dashboard, revokes it and is locked out.
 * Screenshots of /connect and /account land in test-results/.
 */

const MCP_HEADERS = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18' };

async function rpc(request: APIRequestContext, base: string, token: string | null, method: string, params: unknown = {}, id = 1) {
  const res = await request.post(`${base}/api/mcp`, {
    headers: { ...MCP_HEADERS, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    data: { jsonrpc: '2.0', id, method, params },
  });
  return res;
}

test.describe('MCP discovery and OAuth endpoints', () => {
  test('protected resource + authorization server metadata', async ({ request, baseURL }) => {
    const prm = await request.get('/.well-known/oauth-protected-resource/api/mcp');
    expect(prm.status()).toBe(200);
    const prmBody = await prm.json();
    expect(prmBody.resource).toBe(`${baseURL}/api/mcp`);
    expect(prmBody.authorization_servers).toEqual([baseURL]);
    const root = await request.get('/.well-known/oauth-protected-resource');
    expect(root.status()).toBe(200);
    const as = await request.get('/.well-known/oauth-authorization-server');
    expect(as.status()).toBe(200);
    const asBody = await as.json();
    expect(asBody.issuer).toBe(baseURL);
    expect(asBody.code_challenge_methods_supported).toContain('S256');
    expect(asBody.token_endpoint_auth_methods_supported).toEqual(['none']);
  });

  test('anonymous MCP call is 401 with a resource_metadata hint', async ({ request, baseURL }) => {
    const res = await rpc(request, baseURL!, null, 'tools/list');
    expect(res.status()).toBe(401);
    expect(res.headers()['www-authenticate']).toMatch(/resource_metadata="[^"]+\/\.well-known\/oauth-protected-resource\/api\/mcp"/);
    const bad = await rpc(request, baseURL!, 'vendx_at_' + 'A'.repeat(43), 'tools/list');
    expect(bad.status()).toBe(401);
  });

  test('registration accepts loopback and https, refuses other http', async ({ request }) => {
    const ok = await request.post('/api/oauth/register', { data: { client_name: 'pw', redirect_uris: ['http://localhost:4242/callback', 'https://example.com/cb'] } });
    expect(ok.status()).toBe(201);
    const body = await ok.json();
    expect(body.client_id).toMatch(/^vendx_c_/);
    expect(body.token_endpoint_auth_method).toBe('none');
    const bad = await request.post('/api/oauth/register', { data: { redirect_uris: ['http://evil.example/cb'] } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error).toBe('invalid_redirect_uri');
    const empty = await request.post('/api/oauth/register', { data: { redirect_uris: [] } });
    expect(empty.status()).toBe(400);
  });

  test('consent page: unknown client is an error page, valid client without session goes to /login', async ({ page, request }) => {
    await page.goto('/oauth/authorize?client_id=vendx_c_nope&redirect_uri=http://localhost:1/cb&response_type=code&code_challenge=x&code_challenge_method=S256');
    await expect(page.locator('h1').first()).toHaveText(/Cannot connect/);
    const reg = await request.post('/api/oauth/register', { data: { client_name: 'pw', redirect_uris: ['http://localhost:4242/callback'] } });
    const { client_id } = await reg.json();
    const challenge = createHash('sha256').update('v'.repeat(43)).digest('base64url');
    await page.goto(`/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:4242/callback')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=abc`);
    await expect(page).toHaveURL(/\/login\?next=%2Foauth%2Fauthorize/);
  });

  test('/connect renders the three client tabs', async ({ page }) => {
    await page.goto('/connect');
    await expect(page.locator('h1').first()).toHaveText(/Connect your coding agent/);
    await expect(page.getByRole('tab', { name: 'Claude Code' })).toBeVisible();
    await expect(page.getByText(/claude mcp add --transport http/)).toBeVisible();
    await page.getByRole('tab', { name: 'Codex CLI' }).click();
    await expect(page.getByText(/codex mcp add vendx --url/)).toBeVisible();
    await page.getByRole('tab', { name: 'Cursor' }).click();
    await expect(page.getByRole('link', { name: 'open in Cursor' })).toHaveAttribute('href', /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=vendx&config=/);
    await page.screenshot({ path: 'test-results/connect.png', fullPage: true });
  });
});

test.describe('OAuth consent → token → MCP (real Supabase)', () => {
  test.skip(!process.env.E2E_SUPABASE, 'set E2E_SUPABASE=1 to run against real Supabase');

  test('full flow: sign up, consent, PKCE exchange, tools, refresh, dashboard, revoke', async ({ page, request, baseURL }) => {
    test.setTimeout(180_000);
    const email = `e2e-oauth+${Date.now()}@vendx.test`;
    const password = randomBytes(24).toString('base64url');

    // A client, as Claude Code would register it.
    const reg = await request.post('/api/oauth/register', { data: { client_name: 'Playwright Code', redirect_uris: ['http://localhost:39393/callback'] } });
    const { client_id } = await reg.json();
    const verifier = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier, 'ascii').digest('base64url');
    const authorizeUrl = `/oauth/authorize?client_id=${client_id}&redirect_uri=${encodeURIComponent('http://localhost:39393/callback')}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=xyz&scope=vendx%3Aread%20vendx%3Abuy`;

    // Bounced to login, sign up, come back to consent.
    await page.goto(authorizeUrl);
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('h1').first()).toHaveText(/Connect an agent/, { timeout: 20_000 });
    await expect(page.getByText(/Playwright Code/).first()).toBeVisible();

    // New agent with caps, approve.
    await page.getByRole('radio', { name: /new agent/i }).check();
    await page.getByLabel('Agent name').fill('pw agent');
    await page.locator('input[name="per_request_cap"]').fill('0.05');
    await page.locator('input[name="daily_cap"]').fill('0.20');
    await page.locator('[data-consent-approve]').click();
    await expect(page.locator('h1').first()).toHaveText(/is connected/, { timeout: 30_000 });
    const cont = page.locator('[data-fund-continue]');
    const back = await cont.getAttribute('href');
    expect(back).toMatch(/^http:\/\/localhost:39393\/callback\?code=[A-Za-z0-9_-]{43}&state=xyz$/);
    const code = new URL(back!).searchParams.get('code')!;
    const walletText = await page.locator('[data-fund] .readout.break-all').first().textContent();
    expect(walletText).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

    // Exchange with the wrong verifier first (must fail without consuming a second time), then the right one.
    const bad = await request.post('/api/oauth/token', { form: { grant_type: 'authorization_code', code, client_id, redirect_uri: 'http://localhost:39393/callback', code_verifier: 'x'.repeat(43) } });
    expect(bad.status()).toBe(400);
    // The code is consumed on first presentation, so the correct verifier now fails too: replay-safe.
    const replay = await request.post('/api/oauth/token', { form: { grant_type: 'authorization_code', code, client_id, redirect_uri: 'http://localhost:39393/callback', code_verifier: verifier } });
    expect(replay.status()).toBe(400);
    expect((await replay.json()).error).toBe('invalid_grant');

    // Run consent again (existing agent this time) and exchange correctly.
    await page.goto(authorizeUrl);
    await expect(page.locator('h1').first()).toHaveText(/Connect an agent/);
    await page.getByRole('radio', { name: /pw agent/ }).check();
    await page.locator('[data-consent-approve]').click();
    await expect(page.locator('[data-fund-continue]')).toBeVisible({ timeout: 30_000 });
    const code2 = new URL((await page.locator('[data-fund-continue]').getAttribute('href'))!).searchParams.get('code')!;
    const tok = await request.post('/api/oauth/token', { form: { grant_type: 'authorization_code', code: code2, client_id, redirect_uri: 'http://localhost:39393/callback', code_verifier: verifier } });
    expect(tok.status()).toBe(200);
    const tokens = await tok.json();
    expect(tokens.access_token).toMatch(/^vendx_at_/);
    expect(tokens.refresh_token).toMatch(/^vendx_rt_/);
    expect(tokens.token_type).toBe('Bearer');

    // MCP with the access token.
    const init = await rpc(request, baseURL!, tokens.access_token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'pw', version: '0' } });
    expect(init.status()).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe('vendx');
    const list = await rpc(request, baseURL!, tokens.access_token, 'tools/list', {}, 2);
    const names = ((await list.json()).result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(['vendx_budget_status', 'vendx_buy_reading', 'vendx_list_devices', 'vendx_reading_history', 'vendx_transactions']);
    const budget = await rpc(request, baseURL!, tokens.access_token, 'tools/call', { name: 'vendx_budget_status', arguments: {} }, 3);
    const budgetBody = await budget.json();
    expect(budgetBody.result.isError).toBeFalsy();
    const snapshot = JSON.parse(budgetBody.result.content[0].text);
    expect(snapshot.wallet.pubkey).toBe(walletText);
    expect(snapshot.caps.perRequestMicro).toBe('50000');
    expect(snapshot.caps.dailyMicro).toBe('200000');
    // An unfunded wallet refuses to buy before any money moves.
    const buy = await rpc(request, baseURL!, tokens.access_token, 'tools/call', { name: 'vendx_buy_reading', arguments: { device: 'definitely-not-a-device' } }, 4);
    const buyBody = await buy.json();
    expect(buyBody.result.isError).toBe(true);
    expect(JSON.parse(buyBody.result.content[0].text).error).toBe('device_not_found');

    // Dashboard shows the agent, its wallet and caps.
    await page.goto('/account');
    await expect(page.locator('h1').first()).toHaveText(/Account/);
    const card = page.locator('[data-agent="active"]').filter({ hasText: 'pw agent' });
    await expect(card).toBeVisible();
    await expect(card.getByText(/connected via Playwright Code/)).toBeVisible();
    await expect(card.getByText(walletText!)).toBeVisible();
    await page.screenshot({ path: 'test-results/account.png', fullPage: true });

    // Refresh rotates: the new pair works, the old access token is dead.
    const ref = await request.post('/api/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id } });
    expect(ref.status()).toBe(200);
    const rotated = await ref.json();
    expect(rotated.access_token).not.toBe(tokens.access_token);
    expect((await rpc(request, baseURL!, tokens.access_token, 'tools/list', {}, 5)).status()).toBe(401);
    expect((await rpc(request, baseURL!, rotated.access_token, 'tools/list', {}, 6)).status()).toBe(200);

    // Presenting the retired refresh token again is replay: the whole family is revoked.
    const reuse = await request.post('/api/oauth/token', { form: { grant_type: 'refresh_token', refresh_token: tokens.refresh_token, client_id } });
    expect(reuse.status()).toBe(400);
    expect((await rpc(request, baseURL!, rotated.access_token, 'tools/list', {}, 7)).status()).toBe(401);

    // Revoke on the dashboard: the card flips and a fresh grant can no longer be minted for it.
    await card.getByRole('button', { name: 'revoke' }).click();
    await expect(page.locator('[data-agent="revoked"]').filter({ hasText: 'pw agent' })).toBeVisible({ timeout: 15_000 });
    await page.goto(authorizeUrl);
    await expect(page.locator('h1').first()).toHaveText(/Connect an agent/);
    await expect(page.getByRole('radio', { name: /pw agent/ })).toHaveCount(0);
  });
});
