import { test, expect } from '@playwright/test';

/*
  /ledger: the rent argument on the records actually settled. Every settled
  reading saves the same 0.004795 USDC of rent (0.0048 as a standard account
  against 0.000005 compressed), so the totals follow from the line count.
*/

const SAVED_PER_RECORD = 0.004795;

test('/ledger sums the rent saved, charts it per reading and as a running total, and prints it on the receipt', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));

  await page.goto('/ledger');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('h1')).toHaveText(/On-chain ledger/i);

  const lines = page.getByTestId('receipt-line');
  const n = await lines.count();
  if (n === 0) {
    // Nothing settled: the argument is made on ten thousand records instead.
    await expect(page.getByText(/the rent argument/i)).toBeVisible();
    await expect(page.getByTestId('rent-charts')).toHaveCount(0);
    expect(errors.filter((e) => !e.includes('Warning:'))).toHaveLength(0);
    return;
  }

  // Hero: kept by compressing = n × 0.004795, trailing zeros trimmed.
  const expected = (n * SAVED_PER_RECORD).toFixed(6).replace(/0+$/, '');
  await expect(page.getByTestId('rent-saved-total')).toHaveText(expected);

  // Per reading: one row per settled record, capped at twelve; the sale tick
  // and both bars are drawn, and hovering a row answers with a tooltip.
  const rows = page.getByTestId('rent-row');
  await expect(rows).toHaveCount(Math.min(n, 12));
  await rows.first().hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('standard account rent');
  await expect(tip).toContainText('0.004795 USDC');

  // Running total: three series, end-labelled, and the keyboard walks the points.
  const chart = page.getByTestId('rent-lines');
  await expect(chart).toBeVisible();
  for (const id of ['standard', 'revenue', 'compressed']) {
    await expect(page.getByTestId(`rent-line-${id}`)).toHaveCount(1);
  }
  await expect(chart).toContainText('standard');
  await expect(chart).toContainText('earned');
  await expect(chart).toContainText('compressed');
  await page.mouse.move(0, 0);
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tooltip')).toContainText('reading #1');
  await expect(page.getByRole('tooltip')).toContainText('saved so far');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);

  // Receipt: every line says what it saved, and the total matches the hero.
  const saved = page.getByTestId('receipt-saved');
  await expect(saved).toHaveCount(n);
  await expect(saved.first()).toHaveText('0.004795');
  await expect(page.getByTestId('receipt-saved-total')).toHaveText(`${(n * SAVED_PER_RECORD).toFixed(6)} USDC`);

  expect(errors.filter((e) => !e.includes('Warning:'))).toHaveLength(0);
});
