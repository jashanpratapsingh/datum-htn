/**
 * Vendor or visitor?
 *
 * There is no role column. A wallet is a vendor when some relay lists a
 * registered device that sells for it: `/api/devices` entries carry `payTo`
 * for registered nodes (relay-proxy node registry). Anyone else is a visitor.
 * The relays are asked live, in parallel, with a short timeout; an offline
 * relay simply contributes nothing.
 */

import { RELAYS } from '@/lib/relays';

export type Role = 'vendor' | 'visitor';

export interface OwnedDevice {
  id: string;
  relayKey: string;
  relayLabel: string;
  source: string;
  nodeState?: string;
  url?: string;
}

interface WireDevice {
  id?: unknown;
  deviceId?: unknown;
  source?: unknown;
  payTo?: unknown;
  nodeState?: unknown;
  url?: unknown;
}

const TIMEOUT_MS = 4000;

export async function deriveRole(wallet: string): Promise<{ role: Role; devices: OwnedDevice[] }> {
  const results = await Promise.all(
    RELAYS.map(async (relay) => {
      try {
        const res = await fetch(`${relay.url}/api/devices`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { devices?: WireDevice[] };
        return (body.devices ?? [])
          .filter((d) => d.payTo === wallet)
          .map<OwnedDevice>((d) => ({
            id: String(d.id ?? d.deviceId ?? ''),
            relayKey: relay.key,
            relayLabel: relay.label,
            source: typeof d.source === 'string' ? d.source : 'unknown',
            nodeState: typeof d.nodeState === 'string' ? d.nodeState : undefined,
            url: typeof d.url === 'string' ? d.url : undefined,
          }))
          .filter((d) => d.id);
      } catch {
        return [];
      }
    }),
  );
  const devices = results.flat();
  return { role: devices.length ? 'vendor' : 'visitor', devices };
}
