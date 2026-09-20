import { test, expect } from '@playwright/test';
import { installMockPhantom, loadKeypairFile } from './helpers/mock-phantom';

/*
  Phantom login, end to end against the real routes.

  The extension is replaced by helpers/mock-phantom.ts, which signs with a real
  Ed25519 key, so /api/auth/verify checks genuine signatures over genuine SIWS
  text. What is faked is only the popup. Balances come from devnet for real: a
  fresh key reads 0 SOL / 0 USDC, which is exactly the "no token account yet"
  path the pill has to survive.
*/

const RELAY = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3402';
const B58 = '[1-9A-HJ-NP-Za-km-z]';

test('without Phantom the pill links to the extension', async ({ page }) => {
  await page.goto('/');
  const link = page.locator('[data-wallet="get-phantom"]').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /phantom\.app/);
});

test('with Phantom the pill offers to connect', async ({ page }) => {
  await installMockPhantom(page);
  await page.goto('/');
  await expect(page.locator('[data-wallet="connect"]').first()).toHaveText(/connect phantom/i);
});

test('connect → address and detected balances, session cookie set', async ({ page }) => {
  const { address } = await installMockPhantom(page);
  await page.goto('/');
  await page.locator('[data-wallet="connect"]').first().click();

  const pill = page.locator('[data-wallet="connected"]').first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill.locator('[data-wallet="address"]')).toHaveText(
    new RegExp(`^${address.slice(0, 4)}…${address.slice(-4)}$`),
  );
  await expect(pill.locator('[data-wallet="usdc"]')).toHaveText(/USDC/, { timeout: 20_000 });
  await expect(pill.locator('[data-wallet="sol"]')).toHaveText(/◎/);

  const session = await page.request.get('/api/auth/session');
  expect(await session.json()).toMatchObject({ authenticated: true, wallet: address });

  const me = await page.request.get('/api/me');
  expect(me.status()).toBe(200);
  const body = (await me.json()) as { wallet: string; role: string };
  expect(body.wallet).toBe(address);
  expect(['vendor', 'visitor']).toContain(body.role);
});

test('reload keeps the login without a click', async ({ page }) => {
  const { address } = await installMockPhantom(page);
  await page.goto('/');
  await page.locator('[data-wallet="connect"]').first().click();
  await expect(page.locator('[data-wallet="connected"]').first()).toBeVisible({ timeout: 15_000 });

  await page.reload({ waitUntil: 'networkidle' });
  const pill = page.locator('[data-wallet="connected"]').first();
  await expect(pill).toBeVisible({ timeout: 15_000 });
  await expect(pill.locator('[data-wallet="address"]')).toHaveText(new RegExp(`^${address.slice(0, 4)}`));
});

test('menu shows the full address and Disconnect logs out', async ({ page }) => {
  const { address } = await installMockPhantom(page);
  await page.goto('/');
  await page.locator('[data-wallet="connect"]').first().click();
  const pill = page.locator('[data-wallet="connected"]').first();
  await expect(pill).toBeVisible({ timeout: 15_000 });

  await pill.click();
  const menu = page.getByRole('dialog', { name: /^wallet$/i });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[data-wallet="full-address"]')).toHaveText(address);
  await expect(menu.locator('[data-wallet="role"]')).toHaveText(/vendor|visitor/);

  await menu.locator('[data-wallet="disconnect"]').click();
  await expect(page.locator('[data-wallet="connect"]').first()).toBeVisible();
  expect(await (await page.request.get('/api/auth/session')).json()).toMatchObject({ authenticated: false });
});

test('opening the menu floats it under the pill and leaves the navbar in place', async ({ page }) => {
  await installMockPhantom(page);
  await page.goto('/');
  await page.locator('[data-wallet="connect"]').first().click();
  const pill = page.locator('[data-wallet="connected"]').first();
  await expect(pill).toBeVisible({ timeout: 15_000 });

  const brand = page.getByRole('link', { name: /vendx home/i });
  const contact = page.getByRole('link', { name: /get in touch/i });
  const before = { brand: await brand.boundingBox(), contact: await contact.boundingBox(), pill: await pill.boundingBox() };

  await pill.click();
  const menu = page.getByRole('dialog', { name: /^wallet$/i });
  await expect(menu).toBeVisible();

  // The menu is a popover: it must not take part in the header's layout.
  expect(await brand.boundingBox()).toEqual(before.brand);
  expect(await contact.boundingBox()).toEqual(before.contact);
  expect(await pill.boundingBox()).toEqual(before.pill);
  const box = (await menu.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(before.pill!.y + before.pill!.height);
  expect(box.x + box.width).toBeLessThanOrEqual(before.pill!.x + before.pill!.width + 1);
});

test('a different account in Phantom logs the site out', async ({ page }) => {
  await installMockPhantom(page);
  await page.goto('/');
  await page.locator('[data-wallet="connect"]').first().click();
  await expect(page.locator('[data-wallet="connected"]').first()).toBeVisible({ timeout: 15_000 });

  await page.evaluate(() => {
    const w = window as unknown as { __mockPhantomEmit: (ev: string, a?: unknown) => void };
    const other = `${'1'.repeat(43)}`;
    w.__mockPhantomEmit('accountChanged', { toBase58: () => other, toString: () => other });
  });
  await expect(page.locator('[data-wallet="connect"]').first()).toBeVisible();
  expect(await (await page.request.get('/api/auth/session')).json()).toMatchObject({ authenticated: false });
});

test('tampered signature is refused by /api/auth/verify', async ({ page }) => {
  const { address } = await installMockPhantom(page);
  await page.goto('/');
  const nonce = await page.request.post('/api/auth/nonce', { data: { address } });
  expect(nonce.status()).toBe(200);
  const { message } = (await nonce.json()) as { message: string };
  const host = new URL(page.url()).host;
  expect(message).toMatch(new RegExp(`^${host.replace('.', '\\.')} wants you to sign in with your Solana account:\\n${address}\\n`));

  const bogus = Buffer.alloc(64, 7).toString('base64url');
  const res = await page.request.post('/api/auth/verify', {
    data: {
      address,
      signedMessage: Buffer.from(message, 'utf8').toString('base64url'),
      signature: bogus,
      method: 'signMessage',
    },
  });
  expect(res.status()).toBe(401);
  expect(await res.json()).toMatchObject({ error: 'bad_signature' });
  expect(await (await page.request.get('/api/auth/session')).json()).toMatchObject({ authenticated: false });
});

test('mobile menu contains the wallet control and still traps focus', async ({ page }) => {
  await installMockPhantom(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: /open navigation/i }).click();
  const menu = page.getByRole('dialog', { name: /navigation menu/i });
  await expect(menu.locator('[data-wallet="connect"]')).toBeVisible();
  // Tab from the last link lands on the wallet pill, then on Close, then wraps.
  const focusables = await menu.locator('a[href], button').count();
  for (let i = 0; i < focusables; i++) await page.keyboard.press('Tab');
  expect(await menu.evaluate((el) => el.contains(document.activeElement))).toBe(true);
});

/*
  The real payment. Needs a funded devnet key (VENDX_E2E_KEYPAIR, Solana CLI
  format) and a relay. The mock signs the exact transaction the page built and
  sends it to devnet; the relay then verifies it on-chain before issuing the
  receipt (VENDX_SETTLEMENT=verify) or trusts it (demo). Skips otherwise.
*/
test.describe('paying the 402 with the connected wallet', () => {
  test.beforeEach(async () => {
    const keyPath = process.env.VENDX_E2E_KEYPAIR;
    test.skip(!keyPath, 'VENDX_E2E_KEYPAIR unset (funded devnet keypair, Solana CLI JSON)');
    let up = false;
    try {
      up = (await fetch(`${RELAY}/health`, { signal: AbortSignal.timeout(1500) })).ok;
    } catch {
      up = false;
    }
    test.skip(!up, `relay-proxy not reachable at ${RELAY}`);
  });

  test('Phantom signs a real devnet USDC transfer and the relay dispenses telemetry', async ({ page }) => {
    test.setTimeout(120_000);
    const keypair = loadKeypairFile(process.env.VENDX_E2E_KEYPAIR!);
    await installMockPhantom(page, { keypair, payments: true });
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/agent', { waitUntil: 'networkidle' });
    await page.locator('[data-wallet="connect"]').first().click();
    await expect(page.locator('[data-wallet="connected"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-agent="payer"]')).toHaveText(/Paying real devnet USDC/);

    await page.getByRole('button', { name: /run handshake/i }).click();
    await expect(page.getByText(/signed by Phantom/)).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText('200 OK · dispensed')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/confirmed · https:\/\/explorer\.solana\.com\/tx\//)).toBeVisible();
    expect(errors).toHaveLength(0);
  });
});

// Keep the base58 alphabet referenced so the regex fragment above stays honest if reused.
void B58;
