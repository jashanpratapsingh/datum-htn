import { NextResponse, type NextRequest } from 'next/server';
import { clearNonce, clearSession } from '@/lib/server/session';
import { createSupabaseRoute } from '@/lib/supabase/route';
import { hasSupabaseEnv } from '@/lib/supabase/env';

export const runtime = 'nodejs';

/** POST /api/auth/logout — drop the wallet session cookie and the Supabase session it opened. */
export async function POST(req: NextRequest) {
  const res = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  clearSession(res);
  clearNonce(res);
  if (hasSupabaseEnv()) {
    await createSupabaseRoute(req, res).auth.signOut().catch(() => undefined);
  }
  return res;
}
