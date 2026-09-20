import { type NextRequest, NextResponse } from 'next/server';
import { getRelay, PRIMARY_RELAY } from '@/lib/relays';

/** Proxy to one relay's facilitator. Must match the relay that issued the 402. */
export async function POST(req: NextRequest) {
  const relay = getRelay(req.nextUrl.searchParams.get('relay')) ?? PRIMARY_RELAY;
  try {
    const body = await req.json() as unknown;
    const res = await fetch(`${relay.url}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status, headers: { 'X-Vendx-Relay': relay.key } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'relay unreachable';
    return NextResponse.json({ error: 'relay_offline', relay: relay.key, message: msg }, { status: 503 });
  }
}
