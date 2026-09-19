import { RELAY_URL } from '@/lib/relay';

interface Props {
  /** Path only, e.g. `/api/devices`. The host comes from NEXT_PUBLIC_RELAY_URL. */
  path: string;
  reason?: 'offline' | 'unimplemented' | 'not_found' | 'error';
}

/**
 * The empty state when the relay cannot be reached.
 *
 * Previously every call site hardcoded `http://localhost:3402/...` here, so in
 * production the page told you to check a URL that was not the one it had
 * actually tried. It now reads the same base URL the fetch helper used.
 */
export function RelayOffline({ path, reason = 'offline' }: Props) {
  const endpoint = `${RELAY_URL}${path}`;
  const heading =
    reason === 'unimplemented'
      ? 'Endpoint not implemented yet'
      : reason === 'offline'
        ? 'No relay link'
        : 'Data unavailable';
  const hint =
    reason === 'unimplemented'
      ? 'The relay answered, but does not serve this path yet.'
      : 'Start relay-proxy, then reload this page.';

  return (
    <div className="panel px-6 py-12 text-center">
      <p className="plate mb-3">{heading}</p>
      <p className="text-[15px] text-phosphor/80">{hint}</p>
      <p className="readout mt-4 text-xs text-phosphor-dim">{endpoint}</p>
      <p className="readout mt-5 text-xs text-phosphor-dim/70">
        cd relay-proxy &amp;&amp; npm start
      </p>
    </div>
  );
}
