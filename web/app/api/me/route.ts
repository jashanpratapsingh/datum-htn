import { NextResponse, type NextRequest } from 'next/server';
import { readSession } from '@/lib/server/session';
import { getAccount } from '@/lib/server/supabase';
import { deriveRole } from '@/lib/server/role';

export const runtime = 'nodejs';

/** GET /api/me — the logged-in wallet, its account row and derived role. */
export async function GET(req: NextRequest) {
  const s = readSession(req);
  if (!s) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 });
  const [account, owned] = await Promise.all([getAccount(s.w), deriveRole(s.w)]);
  return NextResponse.json(
    { wallet: s.w, account, role: owned.role, devices: owned.devices, exp: s.exp },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
