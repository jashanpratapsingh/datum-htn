interface Props {
  endpoint: string;
  reason?: 'offline' | 'unimplemented' | 'not_found' | 'error';
}

export function RelayOffline({ endpoint, reason = 'offline' }: Props) {
  const label =
    reason === 'unimplemented'
      ? 'Endpoint not yet implemented'
      : reason === 'offline'
        ? 'Relay offline'
        : 'Data unavailable';

  const hint =
    reason === 'unimplemented'
      ? `The relay is up but ${endpoint} is not implemented yet — backend session is working on it.`
      : `Start relay-proxy to see live data from ${endpoint}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-12 text-center">
      <p className="font-[family-name:var(--font-inter)] text-xs text-white/30 uppercase tracking-wider mb-2">
        {label}
      </p>
      <p className="font-[family-name:var(--font-inter)] text-sm text-white/50 mb-1">{hint}</p>
      <p className="font-[family-name:var(--font-inter)] font-mono text-xs text-[#5ed29c]/60 mt-3">
        {endpoint}
      </p>
      <p className="font-[family-name:var(--font-inter)] text-xs text-white/20 mt-4">
        cd relay-proxy &amp;&amp; npm start
      </p>
    </div>
  );
}
