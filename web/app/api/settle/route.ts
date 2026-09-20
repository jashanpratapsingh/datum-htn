import { type NextRequest, NextResponse } from 'next/server';
import { PRIMARY_RELAY } from '@/lib/relays';
import { resolveRelay } from '@/lib/relays.server';
import { getSessionUser } from '@/lib/supabase/server';

/**
 * Proxy to one relay's facilitator. Must match the relay that issued the 402.
 * When the caller is signed in, the settle is attributed to their account
 * (X-Vendx-Web-Secret + X-Vendx-User-Id, verified by the relay).
 */
export async function POST(req: NextRequest) {
  const relay = (await resolveRelay(req.nextUrl.searchParams.get('relay'))) ?? PRIMARY_RELAY;
  try {
    const body = await req.json() as unknown;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const user = await getSessionUser();
    if (user && process.env.VENDX_WEB_SECRET) {
      headers['x-vendx-web-secret'] = process.env.VENDX_WEB_SECRET;
      headers['x-vendx-user-id'] = user.id;
    }
    const res = await fetch(`${relay.url}/settle`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json();
    const out: Record<string, string> = { 'X-Vendx-Relay': relay.key };
    const settleHeader = res.headers.get('x-payment-response');
    if (settleHeader) out['X-Payment-Response'] = settleHeader;
    return NextResponse.json(data, { status: res.status, headers: out });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'relay unreachable';
    return NextResponse.json({ error: 'relay_offline', relay: relay.key, message: msg }, { status: 503 });
  }
}
