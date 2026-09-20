import { NextResponse, type NextRequest } from 'next/server';
import { readSession } from '@/lib/server/session';

export const runtime = 'nodejs';

/** GET /api/auth/session — who the cookie says is logged in. */
export async function GET(req: NextRequest) {
  const s = readSession(req);
  const body = s ? { authenticated: true, wallet: s.w, exp: s.exp } : { authenticated: false };
  return NextResponse.json(body, { headers: { 'Cache-Control': 'no-store' } });
}
