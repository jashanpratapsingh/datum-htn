import type { User } from '@supabase/supabase-js';

/** What to print for a signed-in account: the email. */
export function displayNameOf(user: Pick<User, 'email' | 'id'>): string {
  return user.email ?? `account ${user.id.slice(0, 8)}`;
}
