import type { User } from '@supabase/supabase-js';

const WALLET_DOMAIN = '@wallets.vendx.biz';

type AccountLike = Pick<User, 'email'> & { user_metadata?: Record<string, unknown> | null };

/** The Phantom wallet behind a Supabase user created by the wallet login, or null for an email account. Client-safe. */
export function walletOfUser(user: AccountLike): string | null {
  if (typeof user.user_metadata?.wallet === 'string' && user.user_metadata.wallet) return user.user_metadata.wallet as string;
  return user.email?.endsWith(WALLET_DOMAIN) ? user.email.slice(0, -WALLET_DOMAIN.length) : null;
}

/** What to print for a signed-in account: the email, or a short wallet address for Phantom logins. */
export function displayNameOf(user: AccountLike & Pick<User, 'id'>): string {
  const wallet = walletOfUser(user);
  if (wallet) return `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;
  return user.email ?? `account ${user.id.slice(0, 8)}`;
}
