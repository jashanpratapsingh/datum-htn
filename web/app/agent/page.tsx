import AgentConsole from '@/components/agent/AgentConsole';
import { getViewer } from '@/lib/auth/viewer';
import { hasSupabaseEnv } from '@/lib/supabase/env';

export const dynamic = 'force-dynamic';

/** Server wrapper: who is signed in — by email or by Phantom — decides whether the console can spend. */
export default async function AgentPage() {
  const viewer = await getViewer();
  return <AgentConsole viewer={viewer ? { id: viewer.id, name: viewer.name } : null} authConfigured={hasSupabaseEnv()} />;
}
