import { NextResponse, type NextRequest } from 'next/server';
import { clearNonce, readNonce, setSession } from '@/lib/server/session';
import { allowedDomains, verifySignIn } from '@/lib/server/siws-verify';
import { touchAccount } from '@/lib/server/supabase';
import { deriveRole } from '@/lib/server/role';
import { isBase58Address } from '@/lib/wallet/siws';

export const runtime = 'nodejs';

interface VerifyBody {
  address?: unknown;
  signedMessage?: unknown; // base64url
  signature?: unknown; // base64url
  method?: unknown; // 'signIn' | 'signMessage'
}

function b64uBytes(v: unknown): Uint8Array | null {
  if (typeof v !== 'string' || !v || v.length > 8192) return null;
  try {
    return new Uint8Array(Buffer.from(v, 'base64url'));
  } catch {
    return null;
  }
}

/**
 * POST /api/auth/verify
 *   { address, signedMessage: b64u, signature: b64u, method }
 *
 * Verifies the Phantom signature over the SIWS text, compares the text to what
 * /api/auth/nonce issued, then sets the session cookie and touches the
 * vendx_accounts row. Supabase being down does not block the login.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as VerifyBody | null;
  if (!body) return NextResponse.json({ error: 'bad_request' }, { status: 400 });

  const address = body.address;
  const signedMessage = b64uBytes(body.signedMessage);
  const signature = b64uBytes(body.signature);
  const method = body.method === 'signMessage' ? 'signMessage' : 'signIn';
  if (!isBase58Address(address) || !signedMessage || !signature) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const expectedNonce = readNonce(req);
  if (!expectedNonce) {
    return NextResponse.json({ error: 'nonce_mismatch', detail: 'no nonce cookie or it expired' }, { status: 401 });
  }

  const check = verifySignIn({
    address,
    signedMessage,
    signature,
    expectedNonce,
    allowedDomains: allowedDomains(req.headers.get('host')),
  });
  if (!check.ok) {
    return NextResponse.json({ error: check.error, detail: check.detail }, { status: 401 });
  }

  const [account, owned] = await Promise.all([
    touchAccount(address, check.parsed.domain, method),
    deriveRole(address),
  ]);

  const res = NextResponse.json(
    {
      ok: true,
      wallet: address,
      account,
      role: owned.role,
      devices: owned.devices,
      ...(account ? {} : { warning: 'accounts_unavailable' as const }),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
  setSession(res, address);
  clearNonce(res);
  return res;
}
