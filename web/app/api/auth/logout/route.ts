import { NextResponse } from 'next/server';
import { clearNonce, clearSession } from '@/lib/server/session';

export const runtime = 'nodejs';

/** POST /api/auth/logout — drop the session cookie. */
export async function POST() {
  const res = new NextResponse(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  clearSession(res);
  clearNonce(res);
  return res;
}
