import { test, expect } from '@playwright/test';

/*
  The fleet-economics popup off the hero. Defaults are 100 nodes × 1,440 reads
  × 0.0001 USDC, committing every 10 minutes: $14.40 a day against $0.432 of
  power and ledger fees, so $500 of hardware breaks even on day 36.
*/

test('economics popup opens from the hero, recomputes on a slider, closes on Escape', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/');
  await page.waitForLoadState('networkidle');

  const trigger = page.getByRole('button', { name: /run the numbers/i });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const dialog = page.getByRole('dialog', { name: /fleet of five-dollar sensors/i });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('econ-revenue')).toHaveText('$14.40');
  await expect(dialog.getByTestId('econ-cost')).toHaveText('$0.432');
  await expect(dialog.getByTestId('econ-breakeven')).toHaveText('36');
  await expect(dialog.getByTestId('econ-verdict')).toContainText('100 nodes pay for themselves in 36 days');

  // Focus lands on the close button and Tab stays inside.
  await expect(dialog.getByRole('button', { name: /close fleet economics/i })).toBeFocused();
  await page.keyboard.press('Tab');
  expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);

  // Ten times the nodes: revenue, cost and hardware all scale, break-even does not.
  const nodes = dialog.getByLabel(/nodes deployed/i);
  await nodes.focus();
  await page.keyboard.press('End');
  await expect(dialog.getByTestId('econ-revenue')).toHaveText('$144.00');
  await expect(dialog.getByTestId('econ-cost')).toHaveText('$4.32');
  await expect(dialog.getByTestId('econ-breakeven')).toHaveText('36');
  await expect(dialog.getByTestId('econ-verdict')).toContainText('1,000 nodes pay for themselves in 36 days');

  // Reads down to one a day: the fleet never earns back its hardware.
  const reads = dialog.getByLabel(/reads per node per day/i);
  await reads.focus();
  await page.keyboard.press('Home');
  await expect(dialog.getByTestId('econ-breakeven')).toHaveText('never');
  await expect(dialog.getByTestId('econ-verdict')).toContainText('Underwater');

  // Committing once a day cuts the ledger fees to almost nothing.
  await dialog.getByRole('radio', { name: '24h' }).click();
  await expect(dialog.getByTestId('econ-cost')).toHaveText('$1.46');

  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();

  expect(errors.filter((e) => !e.includes('Warning:'))).toHaveLength(0);
});
