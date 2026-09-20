import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import type { PaymentRequiredBody } from '@vendx/protocol';
import { getSessionUser } from '@/lib/supabase/server';
import { PRIMARY_RELAY } from '@/lib/relays';
import { resolveRelay } from '@/lib/relays.server';
import { assertPayable, BuyGuardError, payFromSharedWallet } from '@/lib/solana/serverBuyer';

export const maxDuration = 60;

/**
 * Buy one reading for the signed-in user with the site's shared devnet wallet.
 *
 * Streams NDJSON: one `{step, status, detail}` line per handshake step (the
 * nine steps of the agent console) and a final `{done, result | error}`. The
 * server fetches its own 402, so a client cannot steer the wallet at an
 * arbitrary recipient; `assertPayable` caps what it will pay for.
 */

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function rateLimited(userId: string): number | null {
  const now = Date.now();
  const hits = (recent.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (hits.length >= MAX_PER_WINDOW) {
    recent.set(userId, hits);
    return Math.ceil((hits[0] + WINDOW_MS - now) / 1000);
  }
  hits.push(now);
  recent.set(userId, hits);
  return null;
}

type Line =
  | { step: number; status: 'running' | 'done' | 'error'; detail?: string }
  | { done: true; result: unknown }
  | { done: true; error: string; message: string; step: number };

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: 'unauthenticated', message: 'sign in to buy from the shared wallet' }, { status: 401 });

  const retry = rateLimited(user.id);
  if (retry !== null) {
    return NextResponse.json({ error: 'rate_limited', message: `at most ${MAX_PER_WINDOW} purchases a minute per account`, retryAfter: retry }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { relay?: string };
  const relay = (await resolveRelay(body.relay)) ?? PRIMARY_RELAY;
  const webSecret = process.env.VENDX_WEB_SECRET;
  const attribution: Record<string, string> = webSecret ? { 'x-vendx-web-secret': webSecret, 'x-vendx-user-id': user.id } : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (line: Line) => controller.enqueue(encoder.encode(JSON.stringify(line) + '\n'));
      let step = 0;
      const fail = (error: string, message: string) => {
        send({ step, status: 'error', detail: message });
        send({ done: true, error, message, step });
      };
      try {
        // 0 — request
        send({ step: 0, status: 'running' });
        const r1 = await fetch(`${relay.url}/api/telemetry`, { signal: AbortSignal.timeout(8000), cache: 'no-store' }).catch(() => null);
        if (!r1) return fail('relay_offline', `relay ${relay.label} is unreachable (${relay.url})`);
        if (r1.status !== 402) return fail('unexpected_status', `expected 402 from the relay, got ${r1.status}`);
        send({ step: 0, status: 'done', detail: `GET /api/telemetry via ${relay.label}` });

        // 1 — challenge
        step = 1;
        send({ step: 1, status: 'running' });
        const challenge = (await r1.json()) as PaymentRequiredBody;
        const offer = challenge.accepts[0];
        send({ step: 1, status: 'done', detail: `nonce ${challenge.nonce.slice(0, 12)}… · ${offer.maxAmountRequired} µUSDC` });

        // 2, 3 — guard
        step = 2;
        send({ step: 2, status: 'running' });
        assertPayable(offer);
        send({ step: 2, status: 'done', detail: `devnet USDC · ≤ ${process.env.VENDX_WEB_MAX_MICRO_USDC ?? '100000'} µUSDC · ${MAX_PER_WINDOW}/min` });
        step = 3;
        send({ step: 3, status: 'done', detail: `payTo ${offer.payTo.slice(0, 10)}…` });

        // 4, 5 — pay
        step = 4;
        send({ step: 4, status: 'running' });
        const t0 = Date.now();
        const paid = await payFromSharedWallet({ payTo: offer.payTo, amountMicroUsdc: offer.maxAmountRequired, nonce: challenge.nonce });
        send({ step: 4, status: 'done', detail: `sig ${paid.signature.slice(0, 16)}…` });
        step = 5;
        send({ step: 5, status: 'done', detail: `confirmed in ${((Date.now() - t0) / 1000).toFixed(1)} s` });

        // 6 — settle (attributed to this account)
        step = 6;
        send({ step: 6, status: 'running' });
        const settleRes = await fetch(`${relay.url}/settle`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...attribution },
          body: JSON.stringify({ nonce: challenge.nonce, txSignature: paid.signature, payTo: offer.payTo, amount: offer.maxAmountRequired, network: offer.network }),
          signal: AbortSignal.timeout(20_000),
        });
        const settled = (await settleRes.json().catch(() => ({}))) as { receipt?: string; attribution?: string; errorReason?: string; error?: string };
        if (!settleRes.ok || !settled.receipt) return fail('settle_failed', `relay refused to settle: ${settled.errorReason ?? settled.error ?? settleRes.status}`);
        send({ step: 6, status: 'done', detail: `receipt ${settled.receipt.slice(0, 18)}… · ${settled.attribution ?? 'anonymous'}` });

        // 7 — redeem
        step = 7;
        send({ step: 7, status: 'running' });
        const r2 = await fetch(`${relay.url}/api/telemetry`, { headers: { 'x-payment-receipt': settled.receipt }, signal: AbortSignal.timeout(8000), cache: 'no-store' });
        const telemetry = (await r2.json().catch(() => ({}))) as Record<string, unknown>;
        if (!r2.ok) return fail('device_rejected', `device rejected the receipt: ${String(telemetry.error ?? r2.status)}`);
        send({ step: 7, status: 'done', detail: 'Ed25519 verified, nonce burned' });

        // 8 — dispensed
        step = 8;
        send({ step: 8, status: 'done', detail: `source=${String(telemetry.source ?? 'unknown')}` });
        send({
          done: true,
          result: {
            relay: relay.key,
            challenge,
            signature: paid.signature,
            solscanUrl: paid.solscanUrl,
            payer: paid.payer,
            receipt: settled.receipt,
            attribution: settled.attribution ?? 'anonymous',
            telemetry,
          },
        });
      } catch (e) {
        if (e instanceof BuyGuardError) return fail(e.code, e.message);
        fail('internal', e instanceof Error ? e.message : String(e));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Vendx-Relay': relay.key },
  });
}
