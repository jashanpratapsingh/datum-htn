import { Panel } from './Panel';
import { fetchSales } from '@/lib/relay';

/** Last few settled sales, printed like a receipt. The paper surface. */
export default async function TelemetryTicker() {
  const result = await fetchSales();
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
                <span className="truncate text-ink-muted">{s.deviceId}</span>
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
