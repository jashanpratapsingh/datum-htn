import { type NextRequest, NextResponse } from 'next/server';
import { PRIMARY_RELAY } from '@/lib/relays';
import { resolveRelay } from '@/lib/relays.server';

/**
 * Proxy to one relay's device endpoint. `?relay=<key>` picks the relay; the
 * agent must use the same key for /api/settle, because a nonce only exists in
 * the process that minted it.
 */
export async function GET(req: NextRequest) {
  const relay = (await resolveRelay(req.nextUrl.searchParams.get('relay'))) ?? PRIMARY_RELAY;
  try {
    const headers: Record<string, string> = {};
    const receipt = req.headers.get('x-payment-receipt');
    if (receipt) headers['x-payment-receipt'] = receipt;

    const res = await fetch(`${relay.url}/api/telemetry`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    const body = await res.json();
    return NextResponse.json(body, {
      status: res.status,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-Vendx-Relay': relay.key,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'relay unreachable';
    return NextResponse.json({ error: 'relay_offline', relay: relay.key, message: msg }, { status: 503 });
  }
}
