import type { User } from '@supabase/supabase-js';

const WALLET_DOMAIN = '@wallets.vendx.biz';

/** What to print for a signed-in account: the email, or a short wallet address for Phantom logins. */
export function displayNameOf(user: Pick<User, 'email' | 'id'> & { user_metadata?: Record<string, unknown> | null }): string {
  const wallet =
    typeof user.user_metadata?.wallet === 'string'
      ? (user.user_metadata.wallet as string)
      : user.email?.endsWith(WALLET_DOMAIN)
        ? user.email.slice(0, -WALLET_DOMAIN.length)
        : null;
  if (wallet) return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  return user.email ?? `account ${user.id.slice(0, 8)}`;
}
