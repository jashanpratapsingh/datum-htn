import 'server-only';
import type { PaymentRequiredBody, PaymentRequirements } from '@vendx/protocol';
import { dbDirectory, type DirectoryDevice } from '@/lib/db';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import { assertPayable, BuyGuardError, payFromKeypair } from '@/lib/solana/serverBuyer';
import { commitSpend, linkSpendSale, releaseSpend, reserveSpend } from './budget';
import { agentWalletBalances, ensureAgentWallet, loadAgentKeypair } from './wallet';
import type { McpIdentity } from './auth';

/**
 * One purchase on behalf of an MCP identity.
 *
 *   resolve device (Supabase directory) → GET <relay>/api/telemetry expecting 402
 *   → check the offer against the directory (payTo, price) and the site guard
 *   → check the agent wallet's USDC → reserve against the caps (Postgres)
 *   → pay from the agent wallet → commit (money moved; irreversible)
 *   → POST <relay>/settle with web secret + user + agent → GET with the receipt
 *   → store the reading for the dashboard.
 *
 * Anything that fails after the payment still reports the tx signature: the
 * buyer must be able to see where the money went.
 */

export class BuyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly txSignature?: string,
    public readonly solscanUrl?: string,
  ) {
    super(message);
    this.name = 'BuyError';
  }
}

export interface DeviceListing {
  id: string;
  deviceId: string;
  relayKey: string;
  relayLabel: string;
  relayUrl: string;
  relayId: string;
  source: DirectoryDevice['source'];
  resource: string;
  priceMicroUsdc: string;
  priceUsd: number;
  payTo: string;
  network: string;
  chip?: string;
  state: DirectoryDevice['state'];
  lastSeen: number;
  ageSeconds: number;
  metric: string;
  stats?: Record<string, unknown>;
}

/** What a device sells, in the buyer's words. */
function metricOf(d: DirectoryDevice): string {
  if (d.source === 'esp32c3') return 'ble_advertisers_per_5min (nearby BLE devices = foot traffic)';
  if (d.source === 'simulator') return 'footTraffic + temperature (simulated 5-minute bucket)';
  return 'badge health (heap, BLE state, resets)';
}

export function toListing(d: DirectoryDevice, now = Math.floor(Date.now() / 1000)): DeviceListing {
  return {
    id: `${d.relay.key}:${d.id}`,
    deviceId: d.id,
    relayKey: d.relay.key,
    relayLabel: d.relay.label,
    relayUrl: d.relay.url,
    relayId: d.relayId,
    source: d.source,
    resource: d.resource,
    priceMicroUsdc: d.priceMicroUsdc,
    priceUsd: Number(d.priceMicroUsdc) / 1_000_000,
    payTo: d.payTo,
    network: d.network,
    chip: d.chip,
    state: d.state,
    lastSeen: d.lastSeen,
    ageSeconds: now - d.lastSeen,
    metric: metricOf(d),
    stats: d.stats,
  };
}

export async function listDevices(relayKey?: string): Promise<DeviceListing[]> {
  const dir = await dbDirectory();
  if (!dir.ok) throw new BuyError('directory_unavailable', `marketplace directory unavailable: ${dir.message}`);
  return dir.data.devices.filter((d) => !relayKey || d.relay.key === relayKey).map((d) => toListing(d));
}

export async function resolveDevice(ref: string): Promise<DeviceListing> {
  const all = await listDevices();
  const exact = all.find((d) => d.id === ref);
  if (exact) return exact;
  const bare = all.filter((d) => d.deviceId === ref);
  if (bare.length === 1) return bare[0];
  if (bare.length > 1) throw new BuyError('device_ambiguous', `"${ref}" exists on ${bare.length} relays; use one of: ${bare.map((d) => d.id).join(', ')}`);
  throw new BuyError('device_not_found', `no device "${ref}" in the marketplace; call vendx_list_devices`);
}

export interface ReadingExtract {
  metric: string | null;
  value: number | null;
}

/** The chartable number in a payload. Activity = people/devices moving near the sensor. */
export function extractMetric(t: Record<string, unknown>): ReadingExtract {
  if (typeof t.footTraffic === 'number') return { metric: 'activity', value: t.footTraffic };
  if (t.metric === 'ble_advertisers_per_5min' && typeof t.value === 'number') return { metric: 'activity', value: t.value };
  if (typeof t.metric === 'string' && typeof t.value === 'number') return { metric: t.metric, value: t.value };
  return { metric: null, value: null };
}

export interface PurchasedReading {
  device: string;
  relay: string;
  source: string;
  telemetry: Record<string, unknown>;
  metric: string | null;
  value: number | null;
  amountMicroUsdc: string;
  usd: number;
  txSignature: string;
  solscanUrl: string;
  receiptPrefix: string;
  attribution: string;
  fetchedAt: string;
  elapsedMs: number;
}

const GET_TIMEOUT = 8_000;
const SETTLE_TIMEOUT = 20_000;

export async function buyOneReading(
  identity: McpIdentity,
  device: DeviceListing,
  opts: { maxMicroUsdc?: bigint; confirmMs?: number },
): Promise<PurchasedReading> {
  const t0 = Date.now();
  if (device.state === 'lost') throw new BuyError('device_offline', `${device.id} has not heartbeated for ${device.ageSeconds}s (state: lost)`);
  if (!device.relayUrl) throw new BuyError('relay_offline', `relay ${device.relayLabel} has no public URL in the directory`);

  // 1. challenge
  const r1 = await fetch(`${device.relayUrl}${device.resource}`, { signal: AbortSignal.timeout(GET_TIMEOUT), cache: 'no-store' }).catch(() => null);
  if (!r1) throw new BuyError('relay_offline', `relay ${device.relayLabel} is unreachable at ${device.relayUrl}`);
  if (r1.status !== 402) throw new BuyError('unexpected_status', `expected 402 from ${device.relayLabel}, got ${r1.status}`);
  const challenge = (await r1.json()) as PaymentRequiredBody;
  const offer: PaymentRequirements | undefined = challenge.accepts?.[0];
  if (!offer) throw new BuyError('unexpected_status', 'the 402 carried no payment requirements');

  // 2. the offer must be what the directory advertised
  if (offer.payTo !== device.payTo) throw new BuyError('price_mismatch', `relay asks to pay ${offer.payTo} but the directory lists ${device.payTo}`);
  const amount = BigInt(offer.maxAmountRequired);
  if (amount > BigInt(device.priceMicroUsdc)) throw new BuyError('price_mismatch', `relay asks ${amount} µUSDC, directory price is ${device.priceMicroUsdc}`);
  if (opts.maxMicroUsdc !== undefined && amount > opts.maxMicroUsdc) throw new BuyError('over_max', `offer is ${amount} µUSDC, above your maxMicroUsdc of ${opts.maxMicroUsdc}`);
  try {
    assertPayable(offer);
  } catch (e) {
    if (e instanceof BuyGuardError) throw new BuyError(e.code, e.message);
    throw e;
  }

  // 3. wallet + caps
  const wallet = await ensureAgentWallet(identity.agentId);
  const bal = await agentWalletBalances(wallet.pubkey);
  if (bal.usdcMicro === null || bal.usdcMicro < amount) {
    throw new BuyError('insufficient_funds', `agent wallet ${wallet.pubkey} holds ${bal.usdcMicro ?? 0n} µUSDC, offer needs ${amount}. Fund it from the dashboard.`);
  }
  if (bal.lamports < 10_000n) {
    throw new BuyError('insufficient_funds', `agent wallet ${wallet.pubkey} has ${bal.lamports} lamports; it needs SOL for fees. Fund it from the dashboard.`);
  }
  const reservation = await reserveSpend(identity.agentId, amount);
  if (reservation.status !== 'ok' || !reservation.reservationId) {
    const why: Record<string, string> = {
      per_request_cap: `offer of ${amount} µUSDC is above this agent's per-request cap`,
      daily_cap: `daily cap reached: ${reservation.spentToday} µUSDC spent today, ${reservation.remainingToday ?? 0} left`,
      agent_revoked: 'this connection was revoked on the dashboard',
      agent_unknown: 'agent not found',
    };
    throw new BuyError(reservation.status, why[reservation.status] ?? reservation.status);
  }

  // 4. pay (irreversible from here)
  let paid;
  try {
    const kp = await loadAgentKeypair(identity.agentId);
    paid = await payFromKeypair(kp, { payTo: offer.payTo, amountMicroUsdc: offer.maxAmountRequired, nonce: challenge.nonce, confirmMs: opts.confirmMs, who: 'the agent wallet' });
  } catch (e) {
    const code = e instanceof BuyGuardError ? e.code : 'payment_failed';
    await releaseSpend(reservation.reservationId, code);
    throw new BuyError(code, e instanceof Error ? e.message : String(e));
  }
  await commitSpend(reservation.reservationId, paid.signature);

  // 5. settle, attributed to this account and agent
  const webSecret = process.env.VENDX_WEB_SECRET;
  const attribution: Record<string, string> = webSecret
    ? { 'x-vendx-web-secret': webSecret, 'x-vendx-user-id': identity.userId, 'x-vendx-agent-id': identity.agentId }
    : {};
  const settleRes = await fetch(`${device.relayUrl}/settle`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...attribution },
    body: JSON.stringify({ nonce: challenge.nonce, txSignature: paid.signature, payTo: offer.payTo, amount: offer.maxAmountRequired, network: offer.network }),
    signal: AbortSignal.timeout(SETTLE_TIMEOUT),
  }).catch(() => null);
  const settled = settleRes ? ((await settleRes.json().catch(() => ({}))) as { receipt?: string; attribution?: string; errorReason?: string; error?: string; detail?: string }) : {};
  if (!settleRes || !settleRes.ok || !settled.receipt) {
    throw new BuyError('settle_failed', `paid ${amount} µUSDC (tx ${paid.signature}) but the relay refused to settle: ${settled.errorReason ?? settled.error ?? settleRes?.status ?? 'unreachable'}${settled.detail ? ` (${settled.detail})` : ''}`, paid.signature, paid.solscanUrl);
  }

  // 6. redeem
  const r2 = await fetch(`${device.relayUrl}${device.resource}`, { headers: { 'x-payment-receipt': settled.receipt }, signal: AbortSignal.timeout(GET_TIMEOUT), cache: 'no-store' }).catch(() => null);
  const telemetry = r2 ? ((await r2.json().catch(() => ({}))) as Record<string, unknown>) : {};
  if (!r2 || !r2.ok) throw new BuyError('device_rejected', `paid and settled (tx ${paid.signature}) but the device rejected the receipt: ${String(telemetry.error ?? r2?.status ?? 'unreachable')}`, paid.signature, paid.solscanUrl);

  // 7. remember it for the dashboard
  const { metric, value } = extractMetric(telemetry);
  const source = typeof telemetry.source === 'string' ? telemetry.source : device.source;
  const sb = requireSupabaseAdmin();
  const ins = await sb.from('vendx_readings').insert({
    agent_id: identity.agentId,
    user_id: identity.userId,
    sale_id: challenge.nonce,
    relay_id: device.relayId,
    device_id: device.deviceId,
    source: ['badge', 'simulator', 'esp32c3'].includes(source) ? source : device.source,
    metric,
    value,
    payload: telemetry,
    amount_micro_usdc: Number(amount),
    tx_signature: paid.signature,
  });
  if (ins.error) console.error(`[mcp] reading insert failed: ${ins.error.message}`);
  void linkSpendSale(reservation.reservationId, challenge.nonce);
  // Older relays attribute the sale to the user only; make sure the agent is on it.
  void sb.from('vendx_sales').update({ agent_id: identity.agentId }).eq('id', challenge.nonce).is('agent_id', null).then(() => undefined, () => undefined);

  return {
    device: device.id,
    relay: device.relayLabel,
    source,
    telemetry,
    metric,
    value,
    amountMicroUsdc: amount.toString(),
    usd: Number(amount) / 1_000_000,
    txSignature: paid.signature,
    solscanUrl: paid.solscanUrl,
    receiptPrefix: settled.receipt.slice(0, 18) + '…',
    attribution: settled.attribution ?? 'anonymous',
    fetchedAt: new Date().toISOString(),
    elapsedMs: Date.now() - t0,
  };
}
