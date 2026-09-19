import { Panel, Readout } from './Panel';
import { fetchDevices } from '@/lib/relay';
import { SourceBadge } from './SourceBadge';

/** Fleet summary on the landing page. Real relay data or an honest empty state. */
export default async function VendorMap() {
  const result = await fetchDevices();

  if (!result.ok) {
    return (
      <Panel label="Fleet" stamp="no link" className="mt-16">
        <div className="px-4 py-10 text-center">
          <p className="readout text-sm text-phosphor-dim">
            No relay link. Start relay-proxy to see devices.
          </p>
          <a
            href="/devices"
            className="readout mt-3 inline-block text-sm text-phosphor underline underline-offset-4"
          >
            Open the fleet page
          </a>
        </div>
      </Panel>
    );
  }

  const devices = result.data.slice(0, 3);

  return (
    <Panel label="Fleet" stamp={`${result.data.length} online`} live className="mt-16">
      <div className="grid grid-cols-1 sm:grid-cols-3">
        {devices.map((d, i) => (
          <div key={d.id} className={i > 0 ? 'panel-divide sm:panel-divide-x sm:border-t-0' : ''}>
            <Readout
              label={d.id.slice(0, 22)}
              value={(Number(d.earningsMicroUsdc ?? '0') / 1e6).toFixed(4)}
              unit="USDC earned"
              tone="amber"
            />
            <div className="px-4 pb-3.5">
              <SourceBadge source={d.source} />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
