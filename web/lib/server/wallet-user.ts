import 'server-only';
import type { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { createSupabaseRoute } from '@/lib/supabase/route';
import { hasSupabaseEnv } from '@/lib/supabase/env';

/**
 * A Phantom wallet as a Supabase auth user.
 *
 * `vendx_agents`, `vendx_sales`, budgets and OAuth grants all hang off
 * auth.users, so a wallet login must resolve to one. The mapping lives in
 * vendx_accounts.user_id (migration 0006). Missing → admin.generateLink
 * (type magiclink) creates the user for us — with a synthetic, confirmed
 * address nobody ever mails — and hands back a token hash. verifyOtp on a
 * cookie-bound client turns that hash into an ordinary Supabase session, so
 * from here on the wallet viewer and the email viewer are the same thing.
 *
 * Failures never block the SIWS login itself; callers get `null` and report
 * `warning: 'accounts_unavailable'` as they already do for vendx_accounts.
 */

export const WALLET_EMAIL_DOMAIN = 'wallets.vendx.biz';

export function walletEmail(wallet: string): string {
  return `${wallet}@${WALLET_EMAIL_DOMAIN}`;
}

export function walletOf(user: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null | undefined): string | null {
  const meta = user?.user_metadata?.wallet;
  if (typeof meta === 'string' && meta) return meta;
  const email = user?.email ?? '';
  return email.endsWith(`@${WALLET_EMAIL_DOMAIN}`) ? email.slice(0, -(WALLET_EMAIL_DOMAIN.length + 1)) : null;
}

export interface WalletSession {
  userId: string;
  created: boolean;
}

/**
 * Ensure an auth.users row for `wallet`, record the mapping, and open a
 * Supabase session on `res`. Returns null when Supabase is not configured or
 * the bridge failed (logged, never thrown).
 */
export async function openWalletSession(wallet: string, req: NextRequest, res: NextResponse): Promise<WalletSession | null> {
  const admin = getSupabaseAdmin();
  if (!admin || !hasSupabaseEnv()) return null;
  try {
    const existing = await admin.from('vendx_accounts').select('user_id').eq('wallet', wallet).maybeSingle();
    const knownUserId = (existing.data as { user_id?: string | null } | null)?.user_id ?? null;

    const link = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: walletEmail(wallet),
      options: { data: { wallet, login: 'phantom' } },
    });
    if (link.error || !link.data.user || !link.data.properties?.hashed_token) {
      console.warn(`[web] wallet bridge: generateLink failed: ${link.error?.message ?? 'no token'}`);
      return null;
    }
    const userId = link.data.user.id;
    if (knownUserId !== userId) {
      const upd = await admin.from('vendx_accounts').update({ user_id: userId }).eq('wallet', wallet);
      if (upd.error) console.warn(`[web] wallet bridge: mapping write failed: ${upd.error.message}`);
    }

    const session = createSupabaseRoute(req, res);
    const verified = await session.auth.verifyOtp({ type: 'magiclink', token_hash: link.data.properties.hashed_token });
    if (verified.error) {
      console.warn(`[web] wallet bridge: verifyOtp failed: ${verified.error.message}`);
      return null;
    }
    return { userId, created: knownUserId === null };
  } catch (e) {
    console.warn(`[web] wallet bridge unreachable: ${(e as Error).message}`);
    return null;
  }
}
