/**
 * USDC amounts for people.
 *
 * One telemetry read costs 100 µUSDC (0.0001), so a two-decimal readout would
 * show the same "9.99" before and after paying. These keep at least two
 * decimals and add up to six only when the amount actually has them:
 * 10 → "10.00", 9.5 → "9.50", 9.9998 → "9.9998".
 *
 * Shared by the relay (the `display` field of GET /api/earnings, which the
 * badge screens paint verbatim) and mirrored in web/lib/usdc.ts.
 */

export const USDC_MICRO = 1_000_000n;

function toMicroBigInt(micro: bigint | string | number): bigint {
  if (typeof micro === 'bigint') return micro;
  if (typeof micro === 'string' && /^-?\d+$/.test(micro)) return BigInt(micro);
  return BigInt(Math.trunc(Number(micro)));
}

/** Format micro-USDC (bigint or decimal string) with 2–6 significant decimals. */
export function formatUsdcMicro(micro: bigint | string | number, minDecimals = 2, maxDecimals = 6): string {
  const m = toMicroBigInt(micro);
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

/** What a screen shows for an earned total: "$0.00", "$0.0001", "$1.50". */
export function formatUsdDisplay(micro: bigint | string | number): string {
  return `$${formatUsdcMicro(micro)}`;
}
