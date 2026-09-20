import { MULTI_RELAY, type RelayInfo } from '@/lib/relays';

/**
 * Which relay (vendor) a row came from. Renders nothing on a single-relay
 * deploy, so the one-vendor UI is unchanged; with two or more relays every
 * device, sale and receipt says whose it is.
 */
export function RelayTag({ relay, always = false }: { relay: RelayInfo; always?: boolean }) {
  if (!MULTI_RELAY && !always) return null;
  return (
    <span
      className="plate inline-flex items-center gap-1.5 rounded-[2px] border border-dashed border-ink/30 px-1.5 py-0.5 text-ink-muted"
      title={`Sold through relay ${relay.label} (${relay.url})`}
    >
      via {relay.label}
    </span>
  );
}

/** Inline notice for one dark relay while others still answer. */
export function RelayDark({ relay, message }: { relay: RelayInfo; message?: string }) {
  return (
    <p className="readout flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-ink-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-alarm" aria-hidden="true" />
      relay <span className="text-ink">{relay.label}</span> unreachable
      {message ? <span className="text-ink-muted/70">· {message}</span> : null}
    </p>
  );
}
