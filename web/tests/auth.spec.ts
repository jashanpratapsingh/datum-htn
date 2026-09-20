import { test, expect } from '@playwright/test';
import { randomBytes } from 'node:crypto';

/**
 * Opt-in end-to-end: creates a real account, mints an agent key, buys one
 * reading with the shared devnet wallet (about 100 µUSDC), and checks the
 * purchase shows up on the account page. Needs a running relay, Supabase env
 * and the shared wallet configured. Run with E2E_SUPABASE=1.
 */
test.describe('accounts and purchases', () => {
  test.skip(!process.env.E2E_SUPABASE, 'set E2E_SUPABASE=1 to run against real Supabase');

  // Throwaway credentials for a throwaway account on the real Supabase project:
  // a fresh, cryptographically random pair every run. Never a fixed literal here,
  // both so no reusable credential lands in git and so secret scanners have
  // nothing to flag.
  const email = `e2e+${Date.now()}@vendx.test`;
  const password = freshPassword();

  test('sign up, register an agent, buy a reading, see it in the account', async ({ page }) => {
    test.setTimeout(180_000);

    await page.goto('/login');
    await page.getByRole('tab', { name: 'Create account' }).click();
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page).toHaveURL(/\/account$/);
    await expect(page.locator('h1').first()).toHaveText(/Account/);

    // Register an agent: the key is shown once and starts with the prefix.
    await page.getByPlaceholder(/claude-code/i).fill('e2e agent');
    await page.getByRole('button', { name: 'Register agent' }).click();
    const key = page.locator('code').filter({ hasText: /^vendx_sk_/ }).first();
    await expect(key).toBeVisible();
    const keyText = (await key.textContent()) ?? '';
    expect(keyText).toMatch(/^vendx_sk_[A-Za-z0-9_-]{43}$/);
    await expect(page.getByRole('button', { name: /copy vendx_sk_/i })).toBeVisible();

    // After a reload only the prefix remains.
    await page.reload();
    await expect(page.getByText(`${keyText.slice(0, 17)}…`, { exact: false })).toBeVisible();
    await expect(page.locator('code').filter({ hasText: /^vendx_sk_/ })).toHaveCount(0);

    // Buy from the agent console with the shared wallet.
    await page.goto('/agent');
    await page.getByRole('button', { name: /run handshake/i }).click();
    await expect(page.getByText('200 OK · dispensed')).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText('9/9 steps')).toBeVisible();
    const solscan = page.getByRole('link', { name: 'solscan' }).first();
    await expect(solscan).toHaveAttribute('href', /solscan\.io\/tx\//);

    // It is listed under the account and on the marketplace.
    await page.goto('/account');
    await expect(page.getByText(/1 reading/)).toBeVisible();
    await expect(page.getByText(/via web/)).toBeVisible();

    // Sign out from the nav; /account then redirects to /login.
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page).toHaveURL(/\/$/);
    await page.goto('/account');
    await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  });
});

/** 24 random bytes as base64url: 192 bits of entropy, 32 URL-safe characters. */
function freshPassword(): string {
  return randomBytes(24).toString('base64url');
}
