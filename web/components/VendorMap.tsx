import { Panel } from './Panel';
import DeviceCarousel from './DeviceCarousel';
import { fetchDevices, MULTI_RELAY, RELAYS } from '@/lib/relay';

/** Fleet on the landing page: one card per device, or an honest empty state. */
export default async function VendorMap() {
  const result = await fetchDevices();
  // The landing-page carousel is vending-shaped (price, earnings) — motion
  // sensors don't sell anything, so they stay off it and live on /devices only.
  const devices = result.ok ? result.data.filter((d) => d.kind === 'vendor') : [];

  if (devices.length === 0) {
    return (
      <Panel label="Fleet" stamp={result.ok ? 'no devices' : 'no link'} className="mt-16">
        <div className="px-4 py-10 text-center">
          <p className="readout text-sm text-ink-muted">
            {result.ok
              ? 'No devices registered. Attach the badge or start the simulator.'
              : 'No relay link. Start relay-proxy to see devices.'}
          </p>
          <a
            href="/devices"
            className="readout mt-3 inline-block text-sm text-ink underline underline-offset-4"
          >
            Open the fleet page
          </a>
        </div>
      </Panel>
    );
  }

  return (
    <section className="mt-16" aria-label="Fleet">
      <div className="flex items-center justify-between px-1">
        <span className="plate">Fleet</span>
        <span className="plate">
          {devices.length} online{MULTI_RELAY ? ` · ${RELAYS.length - result.failed.length}/${RELAYS.length} relays` : ''}
        </span>
      </div>
      <DeviceCarousel devices={devices} />
    </section>
  );
}
