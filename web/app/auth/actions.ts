'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { NONCE_COOKIE, SESSION_COOKIE } from '@/lib/server/session';

/** Ends both sessions: Supabase auth and the Phantom wallet cookie that may have opened it. */
export async function signOut(): Promise<void> {
  if (hasSupabaseEnv()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  jar.delete(NONCE_COOKIE);
  redirect('/');
}
