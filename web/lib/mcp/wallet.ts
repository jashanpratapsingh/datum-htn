import 'server-only';
import { Keypair, PublicKey } from '@solana/web3.js';
import { requireSupabaseAdmin } from '@/lib/supabase/admin';
import { byteaToBuffer, bufferToBytea, keypairFromSealed, newSealedKeypair } from '@/lib/wallet/keystore';
import { walletBalances } from '@/lib/solana/serverBuyer';

/**
 * The custodial wallet behind one agent. Created lazily the first time an
 * agent needs it (consent page, first tool call), so agents minted before
 * wallets existed get one too. The secret only exists unsealed inside the
 * call that pays.
 */

interface WalletRow {
  agent_id: string;
  pubkey: string;
  secret_enc: unknown;
  kek_id: string;
}

export async function ensureAgentWallet(agentId: string): Promise<{ pubkey: string; created: boolean }> {
  const sb = requireSupabaseAdmin();
  const existing = await sb.from('vendx_agent_wallets').select('pubkey').eq('agent_id', agentId).maybeSingle();
  if (existing.error) throw new Error(`wallet lookup failed: ${existing.error.message}`);
  if (existing.data) return { pubkey: (existing.data as { pubkey: string }).pubkey, created: false };

  const fresh = newSealedKeypair();
  const ins = await sb.from('vendx_agent_wallets').insert({
    agent_id: agentId,
    pubkey: fresh.pubkey,
    secret_enc: bufferToBytea(fresh.secretEnc),
    kek_id: fresh.kekId,
  });
  if (ins.error) {
    // Lost a race with a parallel call: read what won.
    const again = await sb.from('vendx_agent_wallets').select('pubkey').eq('agent_id', agentId).maybeSingle();
    if (again.data) return { pubkey: (again.data as { pubkey: string }).pubkey, created: false };
    throw new Error(`wallet create failed: ${ins.error.message}`);
  }
  await sb.from('vendx_agents').update({ wallet_pubkey: fresh.pubkey }).eq('id', agentId);
  return { pubkey: fresh.pubkey, created: true };
}

export async function loadAgentKeypair(agentId: string): Promise<Keypair> {
  const sb = requireSupabaseAdmin();
  const r = await sb.from('vendx_agent_wallets').select('agent_id, pubkey, secret_enc, kek_id').eq('agent_id', agentId).maybeSingle();
  if (r.error || !r.data) throw new Error('agent wallet missing');
  const row = r.data as WalletRow;
  const kp = keypairFromSealed(byteaToBuffer(row.secret_enc), row.kek_id);
  if (kp.publicKey.toBase58() !== row.pubkey) throw new Error('agent wallet integrity check failed');
  return kp;
}

export async function agentWalletBalances(pubkey: string): Promise<{ lamports: bigint; usdcMicro: bigint | null }> {
  return walletBalances(new PublicKey(pubkey));
}
