/**
 * USDC amounts for people. One telemetry read costs 100 µUSDC (0.0001), so a
 * two-decimal readout would show the same "9.99" before and after paying.
 * These keep at least two decimals and add up to six only when the amount
 * actually has them: 10 → "10.00", 9.5 → "9.50", 9.9998 → "9.9998".
 */

export const USDC_MICRO = 1_000_000n;

/** Format micro-USDC (bigint or decimal string) with 2–6 significant decimals. */
export function formatUsdcMicro(micro: bigint | string | number, minDecimals = 2, maxDecimals = 6): string {
  const m = typeof micro === 'bigint' ? micro : BigInt(Math.trunc(Number(micro)));
  const neg = m < 0n;
  const abs = neg ? -m : m;
  const whole = abs / USDC_MICRO;
  let frac = (abs % USDC_MICRO).toString().padStart(6, '0').slice(0, maxDecimals);
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1);
  return `${neg ? '-' : ''}${whole.toLocaleString('en-US')}.${frac}`;
}

/** Same rule for a plain USDC number (e.g. a remaining budget computed in dollars). */
export function formatUsdc(amount: number, minDecimals = 2, maxDecimals = 6): string {
  return formatUsdcMicro(BigInt(Math.round(amount * 1_000_000)), minDecimals, maxDecimals);
}

/** Percent of a budget used; sub-0.1 % values keep the digits that make them non-zero. */
export function formatPercent(fraction: number): string {
  const pct = fraction * 100;
  if (pct === 0) return '0.0%';
  if (pct < 0.1) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(1)}%`;
}
