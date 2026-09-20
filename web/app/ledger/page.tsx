import PageShell from '@/components/PageShell';
import { Panel, Readout } from '@/components/Panel';
import { Pill } from '@/components/Pill';
import { RelayOffline } from '@/components/RelayOffline';
import { SalesReceipt } from '@/components/SalesReceipt';
import RentSavingsCharts from '@/components/RentSavingsCharts';
import { fetchLedger, MULTI_RELAY, type LedgerEntry } from '@/lib/relay';
import { dbLedger } from '@/lib/db';
import {
  COMPRESSED_RENT_PER_RECORD,
  COMPRESSED_RENT_QUOTED_USDC,
  QUOTED_RECORDS,
  RENT_MULTIPLE,
  STANDARD_RENT_PER_RECORD,
  STANDARD_RENT_QUOTED_USDC,
  ratio,
  summarizeSavings,
  usdc,
  type SavingsSummary,
} from '@/lib/rent';

export const dynamic = 'force-dynamic';

const quoted = QUOTED_RECORDS.toLocaleString('en-US').replace(',', ' ');

/**
 * The rent argument, on the records actually settled. Three readouts: what was
 * kept (the hero), what standard accounts would have charged, what compressed
 * storage did charge. The sentence beneath carries the per-reading and the
 * ten-thousand-record versions of the same comparison.
 */
function RentSaved({ s }: { s: SavingsSummary }) {
  const price = s.revenue / s.count;
  return (
    <Panel label="Rent saved by compressing" stamp={`${s.count} settled · model`}>
      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_1fr_1fr]">
        <Readout
          label="kept by compressing"
          value={<span data-testid="rent-saved-total">{usdc(s.saved)}</span>}
          unit="USDC"
          tone="amber"
          size="lg"
        />
        <div className="panel-divide md:panel-divide-x md:border-t-0">
          <Readout label="standard Solana accounts" value={usdc(s.standard)} unit="USDC rent" tone="alarm" size="md" />
        </div>
        <div className="panel-divide md:panel-divide-x md:border-t-0">
          <Readout label="ZK-compressed via Light Protocol" value={usdc(s.compressed)} unit="USDC rent" tone="ink" size="md" />
        </div>
      </div>
      <p className="panel-divide px-4 py-3.5 text-[15px] leading-relaxed text-ink/85">
        <span className="readout text-ink">{RENT_MULTIPLE}×</span> cheaper. Each reading sold for about{' '}
        <span className="readout text-ink">{usdc(price)}</span> USDC. Holding it in a standard account would have cost{' '}
        <span className="readout text-ink">{usdc(STANDARD_RENT_PER_RECORD)}</span> in rent, {ratio(s.standardOverRevenue)} the
        sale; compressed it costs <span className="readout text-ink">{usdc(COMPRESSED_RENT_PER_RECORD)}</span>,{' '}
        {ratio(s.compressedOverRevenue)}. At {quoted} records that is {usdc(STANDARD_RENT_QUOTED_USDC)} against{' '}
        {usdc(COMPRESSED_RENT_QUOTED_USDC)} — the reason this project exists.
      </p>
    </Panel>
  );
}

/** With nothing settled yet there is nothing to sum, so the argument is made at scale. */
function RentArgument() {
  return (
    <Panel label="The rent argument" stamp={`${quoted} records · model`}>
      <div className="grid grid-cols-1 md:grid-cols-2">
        <Readout label="standard Solana accounts" value={usdc(STANDARD_RENT_QUOTED_USDC)} unit="USDC rent" tone="alarm" size="lg" />
        <div className="panel-divide md:panel-divide-x md:border-t-0">
          <Readout
            label="ZK-compressed via Light Protocol"
            value={usdc(COMPRESSED_RENT_QUOTED_USDC)}
            unit="USDC rent"
            tone="amber"
            size="lg"
          />
        </div>
      </div>
      <p className="panel-divide px-4 py-3.5 text-[15px] text-ink/85">
        <span className="readout text-ink">{RENT_MULTIPLE}×</span> cheaper. Thousands of readings a day per device is only
        viable if storing them costs nearly nothing — that is the reason this project exists.
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

  const keyOf = (e: LedgerEntry) => `${e.relay.key}:${e.nonce}`;
  const summary = summarizeSavings(
    entries.map((e) => ({ key: keyOf(e), signature: e.signature, amount: e.amount, timestamp: e.issuedAt })),
  );
  const savedByKey = new Map(summary.points.map((p) => [p.key, p.saved]));

  return (
    <PageShell
      title="On-chain ledger"
      subtitle="Every settled payment, linked to Solscan devnet, and the rent each one avoided by being stored compressed."
      stamp={ok ? `${entries.length} settled · ${source}` : 'no link'}
    >
      <div className="flex flex-col gap-5">
        {summary.count > 0 ? <RentSaved s={summary} /> : <RentArgument />}

        {summary.count > 0 && (
          <Panel label="Reading by reading" stamp="model · from the settled list">
            <RentSavingsCharts summary={summary} />
          </Panel>
        )}

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
              key: keyOf(e),
              signature: e.signature,
              amount: e.amount,
              network: e.network,
              nonce: e.nonce,
              timestamp: e.issuedAt,
              note: MULTI_RELAY || source === 'supabase' ? `via ${e.relay.label}` : undefined,
              saved: savedByKey.get(keyOf(e)),
            }))}
          />
        )}
      </div>
    </PageShell>
  );
}
