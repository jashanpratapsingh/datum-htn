import 'server-only';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import type { McpIdentity } from './auth';
import { BuyError, buyOneReading, listDevices, resolveDevice, type PurchasedReading } from './buy';
import { budgetPolicy, microToUsd } from './budget';
import { agentWalletBalances, ensureAgentWallet } from './wallet';

/**
 * The VENDX marketplace as MCP tools. One McpServer per request (the
 * stateless transport cannot be reused), bound to the authenticated agent.
 *
 * Tool results are text JSON. `source` is always present on a reading and
 * the descriptions ask the model to surface it: a simulated reading must
 * never be presented as hardware.
 */

const VERSION = '0.2.0';
const BURST_BUDGET_MS = 45_000;

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const ok = (v: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(v, bigintSafe, 2) }] });
const fail = (code: string, message: string, extra?: Record<string, unknown>): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify({ error: code, message, ...extra }, bigintSafe, 2) }],
  isError: true,
});
function bigintSafe(_k: string, v: unknown) {
  return typeof v === 'bigint' ? v.toString() : v;
}
function errorResult(e: unknown): ToolResult {
  if (e instanceof BuyError) return fail(e.code, e.message, e.txSignature ? { txSignature: e.txSignature, solscanUrl: e.solscanUrl } : undefined);
  return fail('internal', e instanceof Error ? e.message : String(e));
}

async function budgetSnapshot(identity: McpIdentity, origin: string) {
  const [policy, wallet] = await Promise.all([budgetPolicy(identity.agentId), ensureAgentWallet(identity.agentId)]);
  const bal = await agentWalletBalances(wallet.pubkey);
  return {
    agent: { id: identity.agentId, name: policy.name, connectedVia: identity.via, client: policy.clientName ?? identity.clientId },
    wallet: {
      pubkey: wallet.pubkey,
      usdcMicro: bal.usdcMicro ?? 0n,
      usd: microToUsd(bal.usdcMicro ?? 0n),
      sol: Number(bal.lamports) / 1e9,
      network: 'solana-devnet',
      solscanUrl: `https://solscan.io/account/${wallet.pubkey}?cluster=devnet`,
    },
    caps: {
      perRequestMicro: policy.perRequestCapMicro,
      perRequestUsd: microToUsd(policy.perRequestCapMicro),
      dailyMicro: policy.dailyCapMicro,
      dailyUsd: policy.dailyCapMicro === null ? null : microToUsd(policy.dailyCapMicro),
      remainingTodayMicro: policy.dailyCapMicro === null ? null : policy.dailyCapMicro - policy.spentTodayMicro,
    },
    spent: { todayMicro: policy.spentTodayMicro, todayUsd: microToUsd(policy.spentTodayMicro), totalMicro: policy.spentTotalMicro, totalUsd: microToUsd(policy.spentTotalMicro) },
    revoked: policy.revoked,
    fundUrl: `${origin}/account#agent-${identity.agentId}`,
    note: 'The wallet balance is the hard budget; caps are what the owner set on the dashboard. Every purchase is a real devnet USDC transfer.',
  };
}

export function buildVendxServer(identity: McpIdentity, origin: string): McpServer {
  const server = new McpServer({ name: 'vendx', version: VERSION });

  server.registerTool(
    'vendx_list_devices',
    {
      title: 'List sensors on the VENDX marketplace',
      description:
        'Sensors currently for sale, from the marketplace directory. Each entry has an `id` to pass to vendx_buy_reading, the `metric` it sells, the price per reading in micro-USDC (1 USDC = 1,000,000), the relay that serves it and its liveness `state` (live / stale / lost). ' +
        '`source` says what the device really is: "esp32c3" = a WiFi ESP32 node, "badge" = the Hack the North ESP32-C3 badge read over USB, "simulator" = synthetic data. Always tell the user which it is.',
      inputSchema: { relay: z.string().optional().describe('Only devices served by this relay key') },
    },
    async ({ relay }) => {
      try {
        const devices = await listDevices(relay);
        return ok({ count: devices.length, devices, hint: devices.length ? 'Pass a device `id` to vendx_buy_reading.' : 'No relay has heartbeated into the directory; the marketplace is empty right now.' });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'vendx_buy_reading',
    {
      title: 'Buy one or more readings from a sensor',
      description:
        'Pays for a live reading with real devnet USDC from this connection\'s agent wallet, settles through the relay and returns the telemetry plus the on-chain transaction (txSignature, solscanUrl). ' +
        'Budget is enforced server-side: the wallet balance is the hard limit and the owner\'s per-request and daily caps apply; a refusal comes back as an error with the reason and never moves money. ' +
        'Use `count` (1-5) to sample a short series; purchases run one after another and stop early if the call would exceed ~45 s. Check vendx_budget_status before a burst. Surface `source` to the user.',
      inputSchema: {
        device: z.string().min(1).describe('Device id from vendx_list_devices (relayKey:deviceId, or a bare deviceId if unique)'),
        count: z.number().int().min(1).max(5).optional().describe('How many readings to buy in sequence (default 1)'),
        maxMicroUsdc: z.string().regex(/^\d+$/).optional().describe('Refuse if one reading costs more than this many micro-USDC'),
      },
    },
    async ({ device, count, maxMicroUsdc }) => {
      const t0 = Date.now();
      const readings: PurchasedReading[] = [];
      try {
        const target = await resolveDevice(device);
        const n = count ?? 1;
        for (let i = 0; i < n; i++) {
          if (i > 0 && Date.now() - t0 > BURST_BUDGET_MS) {
            return ok({ readings, stoppedEarly: true, reason: `time budget of ${BURST_BUDGET_MS / 1000}s reached after ${readings.length} of ${n}`, device: target.id, source: target.source });
          }
          const remaining = BURST_BUDGET_MS - (Date.now() - t0);
          readings.push(await buyOneReading(identity, target, { maxMicroUsdc: maxMicroUsdc ? BigInt(maxMicroUsdc) : undefined, confirmMs: Math.max(15_000, Math.min(45_000, remaining)) }));
        }
        const spent = readings.reduce((s, r) => s + BigInt(r.amountMicroUsdc), 0n);
        return ok({ readings, count: readings.length, spentMicroUsdc: spent, spentUsd: microToUsd(spent), device: target.id, source: target.source, budget: await budgetSnapshot(identity, origin).then((b) => b.caps).catch(() => undefined) });
      } catch (e) {
        const base = errorResult(e);
        if (readings.length) {
          const partial = JSON.parse(base.content[0].text) as Record<string, unknown>;
          return { ...base, content: [{ type: 'text', text: JSON.stringify({ ...partial, completedReadings: readings }, bigintSafe, 2) }] };
        }
        return base;
      }
    },
  );

  server.registerTool(
    'vendx_reading_history',
    {
      title: 'Readings this connection already bought',
      description:
        'Your own purchased readings (newest first) with the extracted `metric`/`value` per reading and summary stats (count, min, max, mean, first, last, trend per hour) so you can reason about activity over time without buying again. `activity` is the number of people/BLE devices moving near the sensor per 5-minute bucket.',
      inputSchema: {
        device: z.string().optional().describe('Restrict to one device id (relayKey:deviceId or bare deviceId)'),
        limit: z.number().int().min(1).max(500).optional().describe('Max rows (default 100)'),
        sinceMinutes: z.number().int().min(1).max(7 * 24 * 60).optional().describe('Only readings from the last N minutes'),
      },
    },
    async ({ device, limit, sinceMinutes }) => {
      try {
        const sb = requireSupabaseAdmin();
        let q = sb
          .from('vendx_readings')
          .select('id, device_id, relay_id, source, metric, value, payload, amount_micro_usdc, tx_signature, fetched_at')
          .eq('agent_id', identity.agentId)
          .order('fetched_at', { ascending: false })
          .limit(limit ?? 100);
        if (device) q = q.eq('device_id', device.includes(':') ? device.slice(device.indexOf(':') + 1) : device);
        if (sinceMinutes) q = q.gte('fetched_at', new Date(Date.now() - sinceMinutes * 60_000).toISOString());
        const { data, error } = await q;
        if (error) return fail('history_unavailable', error.message);
        const rows = (data ?? []) as Array<{ id: string; device_id: string; relay_id: string; source: string; metric: string | null; value: number | string | null; payload: Record<string, unknown>; amount_micro_usdc: number | string; tx_signature: string; fetched_at: string }>;
        const series = rows.filter((r) => r.value !== null).map((r) => ({ t: Date.parse(r.fetched_at), v: Number(r.value) })).sort((a, b) => a.t - b.t);
        let stats: Record<string, unknown> | null = null;
        if (series.length) {
          const vals = series.map((p) => p.v);
          const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
          const spanH = (series[series.length - 1].t - series[0].t) / 3_600_000;
          stats = {
            count: vals.length,
            min: Math.min(...vals),
            max: Math.max(...vals),
            mean: Number(mean.toFixed(2)),
            first: { at: new Date(series[0].t).toISOString(), value: series[0].v },
            last: { at: new Date(series[series.length - 1].t).toISOString(), value: series[series.length - 1].v },
            trendPerHour: spanH > 0 ? Number(((series[series.length - 1].v - series[0].v) / spanH).toFixed(2)) : null,
            spanMinutes: Number((spanH * 60).toFixed(1)),
          };
        }
        return ok({
          count: rows.length,
          spentMicroUsdc: rows.reduce((s, r) => s + BigInt(r.amount_micro_usdc), 0n),
          stats,
          readings: rows.map((r) => ({ at: r.fetched_at, device: r.device_id, source: r.source, metric: r.metric, value: r.value, amountMicroUsdc: String(r.amount_micro_usdc), txSignature: r.tx_signature, telemetry: r.payload })),
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'vendx_budget_status',
    {
      title: 'Budget, wallet balance and caps for this connection',
      description:
        'The agent wallet that pays for readings (address, devnet SOL and USDC balance), the owner\'s per-request and daily caps, what was spent today and in total, and where the owner tops the wallet up. Call it before a burst of purchases and when a purchase is refused.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await budgetSnapshot(identity, origin));
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  server.registerTool(
    'vendx_transactions',
    {
      title: 'On-chain purchases made by this connection',
      description: 'Settled sales attributed to this agent: device, amount, Solana transaction signature with a Solscan link, relay and time. This is the money trail behind vendx_reading_history.',
      inputSchema: { limit: z.number().int().min(1).max(200).optional().describe('Max rows (default 50)') },
    },
    async ({ limit }) => {
      try {
        const sb = requireSupabaseAdmin();
        const { data, error } = await sb
          .from('vendx_sales')
          .select('id, device_id, relay_id, source, amount_micro_usdc, tx_signature, network, payer, settled_at')
          .eq('agent_id', identity.agentId)
          .order('settled_at', { ascending: false })
          .limit(limit ?? 50);
        if (error) return fail('history_unavailable', error.message);
        const rows = (data ?? []) as Array<{ id: string; device_id: string | null; relay_id: string; source: string; amount_micro_usdc: number | string; tx_signature: string; network: string; payer: string | null; settled_at: string }>;
        return ok({
          count: rows.length,
          totalMicroUsdc: rows.reduce((s, r) => s + BigInt(r.amount_micro_usdc), 0n),
          transactions: rows.map((r) => ({
            at: r.settled_at,
            device: r.device_id,
            source: r.source,
            amountMicroUsdc: String(r.amount_micro_usdc),
            usd: microToUsd(r.amount_micro_usdc),
            txSignature: r.tx_signature,
            solscanUrl: `https://solscan.io/tx/${r.tx_signature}?cluster=devnet`,
            payer: r.payer,
            network: r.network,
            nonce: r.id,
          })),
        });
      } catch (e) {
        return errorResult(e);
      }
    },
  );

  return server;
}
