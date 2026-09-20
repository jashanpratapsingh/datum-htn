/**
 * The relay registry: every facilitator the site talks to.
 *
 * Configured by NEXT_PUBLIC_RELAYS, a comma-separated list of `label=url` (or
 * bare `url`, labelled by hostname). Falls back to NEXT_PUBLIC_RELAY_URL, then
 * localhost, so a single-relay deploy needs no change.
 *
 *   NEXT_PUBLIC_RELAYS="jashan=https://relay.vendx.biz,teammate=https://relay.example.dev"
 *
 * Why a registry and not a load balancer: each relay-proxy keeps its nonces,
 * sales log and facilitator keypair in its own process. A 402 issued by one
 * relay can only be settled at that same relay, and a device only trusts the
 * key of the relay it was flashed for. So relays are separate vendors shown
 * side by side, never interchangeable replicas.
 *
 * This file is imported by client components too — keep it free of server-only
 * imports. NEXT_PUBLIC_* values are inlined at build time.
 */

export interface RelayInfo {
  /** URL-safe, unique; used in query strings and composite device ids. */
  key: string;
  /** Human label shown on tags. */
  label: string;
  /** Base URL with no trailing slash. */
  url: string;
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'relay';
}

function parse(spec: string): RelayInfo[] {
  const out: RelayInfo[] = [];
  for (const raw of spec.split(',')) {
    const item = raw.trim();
    if (!item) continue;
    const eq = item.indexOf('=');
    const proto = item.indexOf('://');
    let label: string;
    let url: string;
    if (eq > 0 && (proto < 0 || eq < proto)) {
      label = item.slice(0, eq).trim();
      url = item.slice(eq + 1).trim();
    } else {
      url = item;
      try {
        label = new URL(url).hostname;
      } catch {
        label = url;
      }
    }
    url = url.replace(/\/+$/, '');
    let key = slug(label);
    let n = 2;
    while (out.some((r) => r.key === key)) key = `${slug(label)}-${n++}`;
    out.push({ key, label, url });
  }
  return out;
}

const SPEC =
  process.env.NEXT_PUBLIC_RELAYS ?? process.env.NEXT_PUBLIC_RELAY_URL ?? 'http://localhost:3402';

export const RELAYS: RelayInfo[] = parse(SPEC);
export const PRIMARY_RELAY: RelayInfo = RELAYS[0];
/** True when more than one relay is configured; tags and pickers only show then. */
export const MULTI_RELAY = RELAYS.length > 1;

export function getRelay(key: string | null | undefined): RelayInfo | undefined {
  return key ? RELAYS.find((r) => r.key === key) : undefined;
}

/**
 * Device ids are only unique within one relay (two simulators both say
 * esp32-sim-001), so links carry `relayKey:deviceId`. A bare id still works:
 * the lookup then searches every relay.
 */
export function compositeId(relay: RelayInfo, id: string): string {
  return `${relay.key}:${id}`;
}

export function splitCompositeId(c: string): { relay?: RelayInfo; id: string } {
  const i = c.indexOf(':');
  if (i > 0) {
    const relay = getRelay(c.slice(0, i));
    if (relay) return { relay, id: c.slice(i + 1) };
  }
  return { id: c };
}
