import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { RelayOffline } from '@/components/RelayOffline';
import { SalesReceipt } from '@/components/SalesReceipt';
import { fetchLedger, MULTI_RELAY, type LedgerEntry } from '@/lib/relay';
import { dbLedger } from '@/lib/db';

export const dynamic = 'force-dynamic';

function RentArgument() {
  return (
    <Panel label="The rent argument" stamp="10 000 records">
      <div className="grid grid-cols-1 md:grid-cols-2">
        <Readout label="standard Solana accounts" value="48.00" unit="USDC rent" tone="alarm" size="lg" />
        <div className="panel-divide md:panel-divide-x md:border-t-0">
          <Readout label="ZK-compressed via Light Protocol" value="0.05" unit="USDC rent" tone="amber" size="lg" />
        </div>
      </div>
      <p className="panel-divide px-4 py-3.5 text-[15px] text-ink/85">
        <span className="readout text-ink">960×</span> cheaper. Thousands of readings a day per device
        is only viable if storing them costs nearly nothing — that is the reason this project exists.
      </p>
    </Panel>
  );
}

export default async function LedgerPage() {
  // Settled payments live in Supabase, written by every relay; the relay's own
  // /api/ledger is the fallback when the database is not configured.
  const hist = await dbLedger();
  const live = hist.ok ? null : await fetchLedger();
  const ok = hist.ok || (live?.ok ?? false);
  const entries: LedgerEntry[] = hist.ok ? hist.data : live?.ok ? live.data : [];
  const source = hist.ok ? 'supabase' : 'relay';

  return (
    <PageShell
      title="On-chain ledger"
      subtitle="Every settled payment, linked to Solscan devnet. Printed the way a receipt is."
      stamp={ok ? `${entries.length} settled · ${source}` : 'no link'}
    >
      <div className="flex flex-col gap-5">
        <RentArgument />

        {!ok ? (
          <RelayOffline path="/api/ledger" reason={live && !live.ok ? live.reason : 'offline'} />
        ) : entries.length === 0 ? (
          <Panel label="Settled">
            <div className="px-4 py-12 text-center">
              <p className="readout mb-4 text-sm text-ink-muted">Nothing settled yet.</p>
              <Pill href="/agent">Buy the first reading</Pill>
            </div>
          </Panel>
        ) : (
          <SalesReceipt
            lines={entries.map((e) => ({
              key: `${e.relay.key}:${e.nonce}`,
              signature: e.signature,
              amount: e.amount,
              network: e.network,
              nonce: e.nonce,
              timestamp: e.issuedAt,
              note: MULTI_RELAY || source === 'supabase' ? `via ${e.relay.label}` : undefined,
            }))}
          />
        )}
      </div>
    </PageShell>
  );
}
