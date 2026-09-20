import { NextResponse, type NextRequest } from 'next/server';
import { issueNonce } from '@/lib/server/session';
import { buildSiwsMessage, isBase58Address, type SiwsInput } from '@/lib/wallet/siws';

export const runtime = 'nodejs';

/**
 * POST /api/auth/nonce  { address?: string }
 *
 * Issues the Sign In With Solana input for Phantom's `signIn`, and the same
 * fields as a prebuilt message for the connect + signMessage fallback (only
 * when the address is already known). The nonce also goes into a short-lived
 * signed cookie so /api/auth/verify can check it without any server state.
 */
export async function POST(req: NextRequest) {
  let address: string | undefined;
  try {
    const body = (await req.json().catch(() => ({}))) as { address?: unknown };
    if (body.address !== undefined) {
      if (!isBase58Address(body.address)) {
        return NextResponse.json({ error: 'bad_request', detail: 'address' }, { status: 400 });
      }
      address = body.address;
    }
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const host = req.headers.get('host') ?? 'localhost';
  const proto = req.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  const res = NextResponse.json({}, { headers: { 'Cache-Control': 'no-store' } });
  const nonce = issueNonce(res);

  const input: SiwsInput = {
    domain: host,
    ...(address ? { address } : {}),
    statement: 'Sign in to VENDX. No transaction, no fee.',
    uri: `${proto}://${host}`,
    version: '1',
    nonce,
    issuedAt: new Date().toISOString(),
  };

  const payload: { input: SiwsInput; message?: string } = { input };
  if (address) payload.message = buildSiwsMessage({ ...input, address });

  return NextResponse.json(payload, { status: 200, headers: res.headers });
}
