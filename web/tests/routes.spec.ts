import { test, expect } from '@playwright/test';

const ROUTES = [
  { path: '/', heading: /YOUR SENSORS\. THEIR WALLETS\./i },
  { path: '/devices', heading: /Device Fleet/i },
  { path: '/marketplace', heading: /Data marketplace/i },
  { path: '/agent', heading: /Agent Console/i },
  { path: '/policy', heading: /Policy engine/i },
  { path: '/ledger', heading: /On-chain Ledger/i },
  { path: '/protocol', heading: /Protocol Explorer/i },
  { path: '/docs', heading: /Documentation/i },
  { path: '/login', heading: /Sign in/i },
  // Redirects to /login when Supabase is configured; renders the account page otherwise never (no session).
  { path: '/account', heading: /Sign in|Account/i },
];

for (const { path, heading } of ROUTES) {
  test(`${path} renders without crash`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const response = await page.goto(path);
    expect(response?.status()).toBeLessThan(500);
    await page.waitForLoadState('networkidle');

    // Should contain an h1
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();

    // No uncaught JS errors
    expect(errors.filter((e) => !e.includes('Warning:'))).toHaveLength(0);
  });
}

test('mobile menu opens, traps focus, closes on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.waitForLoadState('networkidle');

  // Hamburger should be visible on mobile
  const hamburger = page.getByRole('button', { name: /open navigation/i });
  await expect(hamburger).toBeVisible();

  // Open the menu
  await hamburger.click();
  const menu = page.getByRole('dialog', { name: /navigation menu/i });
  await expect(menu).toBeVisible();

  // Focus should be inside the dialog (first link focused)
  const firstLink = menu.getByRole('link').first();
  await expect(firstLink).toBeFocused();

  // Tab should stay inside (focus trap — Tab wraps)
  await page.keyboard.press('Tab');
  const menuContainsFocus = await menu.evaluate((el) =>
    el.contains(document.activeElement)
  );
  expect(menuContainsFocus).toBe(true);

  // Escape closes the menu
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
});

test('/agent page shows all 9 handshake steps', async ({ page }) => {
  await page.goto('/agent');
  await page.waitForLoadState('networkidle');
  const steps = page.getByRole('list', { name: /handshake steps/i }).getByRole('listitem');
  await expect(steps).toHaveCount(9);
});

test('/account without a session lands on /login when auth is configured', async ({ page }) => {
  test.skip(!process.env.NEXT_PUBLIC_SUPABASE_URL, 'Supabase env not set');
  await page.goto('/account');
  await expect(page).toHaveURL(/\/login\?next=%2Faccount/);
  await expect(page.locator('h1').first()).toHaveText(/Sign in/i);
});

test('nav exposes the Account link on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.getByRole('button', { name: /open navigation/i }).click();
  const menu = page.getByRole('dialog', { name: /navigation menu/i });
  await expect(menu.getByRole('link', { name: 'Account' })).toBeVisible();
});

test('/protocol page has 4 step sections', async ({ page }) => {
  await page.goto('/protocol');
  await page.waitForLoadState('networkidle');
  // Four StaticSection components: Step 1, Step 2, Step 3, Step 4 badges
  const stepBadges = page.locator('span').filter({ hasText: /^Step [1-4]$/ });
  await expect(stepBadges).toHaveCount(4);
});
