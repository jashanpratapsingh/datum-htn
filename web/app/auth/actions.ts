'use server';

import { redirect } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';

export async function signOut(): Promise<void> {
  if (hasSupabaseEnv()) {
    const supabase = await createSupabaseServer();
    await supabase.auth.signOut();
  }
  redirect('/');
}
