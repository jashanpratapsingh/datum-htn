import 'server-only';
import { cookies } from 'next/headers';
import { getSessionUser } from '@/lib/supabase/server';
import { SESSION_COOKIE, sessionFromCookie } from '@/lib/server/session';
import { lookupWalletUserId, walletOf } from '@/lib/server/wallet-user';
import { displayNameOf } from '@/lib/auth/user';
import { shortAddress } from '@/lib/wallet/siws';

/**
 * Who is signed in, whichever way they signed in.
 *
 * The site has two logins that must count the same: an email + password
 * Supabase session, and a Phantom wallet session (the signed vendx_session
 * cookie). The wallet login also opens a Supabase session for the wallet's
 * synthetic user, and proxy.ts re-opens it when it is missing, so normally
 * the first branch below answers for both. The wallet branch is the
 * fallback for when that bridge could not run (Supabase unreachable, admin
 * key unset): a connected wallet is still a signed-in viewer, it just has no
 * account row to record purchases against.
 */
export interface Viewer {
  /** Stable key for this viewer: the Supabase user id, or `wallet:<address>`. */
  id: string;
  /** auth.users id when the viewer has an account row; null for a wallet without one. */
  userId: string | null;
  /** What to print: the email, or the short wallet address. */
  name: string;
  wallet: string | null;
  via: 'supabase' | 'wallet';
}

export async function getViewer(): Promise<Viewer | null> {
  const user = await getSessionUser();
  if (user) {
    return { id: user.id, userId: user.id, name: displayNameOf(user), wallet: walletOf(user), via: 'supabase' };
  }
  const jar = await cookies();
  const session = sessionFromCookie(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const userId = await lookupWalletUserId(session.w);
  return { id: userId ?? `wallet:${session.w}`, userId, name: shortAddress(session.w), wallet: session.w, via: 'wallet' };
}
