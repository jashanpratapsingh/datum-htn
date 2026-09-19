import { type NextRequest, NextResponse } from 'next/server';

const RELAY_URL = process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3402';

export async function GET(req: NextRequest) {
  try {
    const headers: Record<string, string> = {};
    const receipt = req.headers.get('x-payment-receipt');
    if (receipt) headers['x-payment-receipt'] = receipt;

    const res = await fetch(`${RELAY_URL}/api/telemetry`, {
      headers,
      signal: AbortSignal.timeout(8000),
    });

    const body = await res.json();
    return NextResponse.json(body, {
      status: res.status,
      headers: {
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'relay unreachable';
    return NextResponse.json({ error: 'relay_offline', message: msg }, { status: 503 });
  }
}
