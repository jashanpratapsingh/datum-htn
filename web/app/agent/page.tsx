import AgentConsole from '@/components/agent/AgentConsole';
import { getSessionUser } from '@/lib/supabase/server';
import { hasSupabaseEnv } from '@/lib/supabase/env';
import { displayNameOf } from '@/lib/auth/user';

export const dynamic = 'force-dynamic';

/** Server wrapper: who is signed in decides whether the console can spend. */
export default async function AgentPage() {
  const user = await getSessionUser();
  return <AgentConsole viewer={user ? { id: user.id, name: displayNameOf(user) } : null} authConfigured={hasSupabaseEnv()} />;
}
