import { Panel } from './Panel';
import { fetchSales, MULTI_RELAY } from '@/lib/relay';
import { dbSales } from '@/lib/db';

/**
 * Last few settled sales, printed like a receipt. The paper surface.
 * History comes from Supabase (survives relay restarts); the relay is the
 * fallback when the database is not configured.
 */
export default async function TelemetryTicker() {
  const hist = await dbSales(4);
  const result = hist.ok ? { ok: true as const, data: hist.data } : await fetchSales();
  const sales = result.ok ? result.data.slice(0, 4) : [];

  return (
    <Panel label="Settled" stamp="devnet" className="mt-6">
      {sales.length === 0 ? (
        <p className="readout px-4 py-10 text-center text-sm text-ink-muted">
          Nothing settled yet.
        </p>
      ) : (
        <div className="paper  px-5 py-5">
          <div className="readout mb-3 text-[12px] text-ink-muted">
            Receipt, devnet
          </div>
          <ul className="readout space-y-1.5 text-[13px]">
            {sales.map((s, i) => (
              <li key={i} className="flex justify-between gap-4 border-b border-rule pb-1.5">
                <span className="truncate text-ink-muted">{s.deviceId}{MULTI_RELAY ? ` · via ${s.relay.label}` : ''}</span>
                <span className="shrink-0 tabular-nums text-ink">
                  {(Number(s.amount) / 1e6).toFixed(4)} USDC
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}
