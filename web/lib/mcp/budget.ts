import 'server-only';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';

/** Cap enforcement lives in Postgres (migration 0007); this is the thin client. */

export type ReserveStatus = 'ok' | 'per_request_cap' | 'daily_cap' | 'agent_revoked' | 'agent_unknown';

export interface Reservation {
  status: ReserveStatus;
  reservationId: string | null;
  remainingToday: bigint | null;
  spentToday: bigint;
}

export async function reserveSpend(agentId: string, amountMicroUsdc: bigint): Promise<Reservation> {
  const sb = requireSupabaseAdmin();
  const { data, error } = await sb.rpc('vendx_reserve_spend', { p_agent_id: agentId, p_amount: Number(amountMicroUsdc) });
  if (error) throw new Error(`vendx_reserve_spend: ${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as { status: ReserveStatus; reservation_id: string | null; remaining_today: number | string | null; spent_today: number | string } | undefined;
  if (!row) throw new Error('vendx_reserve_spend returned nothing');
  return {
    status: row.status,
    reservationId: row.reservation_id,
    remainingToday: row.remaining_today === null || row.remaining_today === undefined ? null : BigInt(row.remaining_today),
    spentToday: BigInt(row.spent_today ?? 0),
  };
}

export async function commitSpend(reservationId: string, txSignature: string): Promise<void> {
  const sb = requireSupabaseAdmin();
  const { error } = await sb.rpc('vendx_commit_spend', { p_reservation_id: reservationId, p_tx_signature: txSignature });
  if (error) console.error(`[mcp] vendx_commit_spend failed for ${reservationId}: ${error.message}`);
}

export async function releaseSpend(reservationId: string, reason: string): Promise<void> {
  const sb = requireSupabaseAdmin();
  const { error } = await sb.rpc('vendx_release_spend', { p_reservation_id: reservationId, p_reason: reason.slice(0, 200) });
  if (error) console.error(`[mcp] vendx_release_spend failed for ${reservationId}: ${error.message}`);
}

export async function linkSpendSale(reservationId: string, saleId: string): Promise<void> {
  const sb = requireSupabaseAdmin();
  await sb.rpc('vendx_link_spend_sale', { p_reservation_id: reservationId, p_sale_id: saleId });
}

export interface BudgetPolicy {
  dailyCapMicro: bigint | null;
  perRequestCapMicro: bigint;
  spentTotalMicro: bigint;
  spentTodayMicro: bigint;
  revoked: boolean;
  name: string;
  clientName: string | null;
  createdVia: 'key' | 'oauth';
}

export async function budgetPolicy(agentId: string): Promise<BudgetPolicy> {
  const sb = requireSupabaseAdmin();
  const day = new Date().toISOString().slice(0, 10);
  const [agent, today] = await Promise.all([
    sb.from('vendx_agents').select('name, client_name, created_via, daily_cap_micro_usdc, per_request_cap_micro_usdc, spent_micro_usdc, revoked_at').eq('id', agentId).maybeSingle(),
    sb.from('vendx_spend_reservations').select('amount_micro_usdc').eq('agent_id', agentId).eq('day', day).neq('status', 'released'),
  ]);
  if (agent.error || !agent.data) throw new Error(`agent ${agentId} not found`);
  const a = agent.data as { name: string; client_name: string | null; created_via: 'key' | 'oauth'; daily_cap_micro_usdc: number | string | null; per_request_cap_micro_usdc: number | string; spent_micro_usdc: number | string; revoked_at: string | null };
  const spentToday = ((today.data ?? []) as Array<{ amount_micro_usdc: number | string }>).reduce((s, r) => s + BigInt(r.amount_micro_usdc), 0n);
  return {
    dailyCapMicro: a.daily_cap_micro_usdc === null ? null : BigInt(a.daily_cap_micro_usdc),
    perRequestCapMicro: BigInt(a.per_request_cap_micro_usdc),
    spentTotalMicro: BigInt(a.spent_micro_usdc),
    spentTodayMicro: spentToday,
    revoked: a.revoked_at !== null,
    name: a.name,
    clientName: a.client_name,
    createdVia: a.created_via,
  };
}

export const microToUsd = (m: bigint | number | string): number => Number(m) / 1_000_000;
