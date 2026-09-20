import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * Reading the host WiFi radio through `netsh`.
 *
 * Two sources, because they have very different latency:
 *
 *   `show networks mode=bssid`  every access point in range, but the Windows
 *                               driver caches results for roughly 10 seconds,
 *                               so this is the slow spatial picture.
 *   `show interfaces`           only the connected AP, but served live from the
 *                               driver, so this is the fast channel that makes
 *                               motion visible within a second.
 *
 * Output is locale-dependent. The parser matches on the structural shape
 * (`LABEL : VALUE` with a recognised key) and tolerates missing fields rather
 * than assuming English, but a non-English Windows install will degrade to
 * fewer parsed fields. That is reported, not hidden.
 */

export interface BssidObservation {
  bssid: string;
  ssid: string;
  /** 0-100, as Windows reports it. Quantised to whole percent. */
  signalPct: number;
  /** Derived: Windows' percentage is a linear map of dBm over [-100, -50]. */
  rssiDbm: number;
  band?: string;
  channel?: number;
  radioType?: string;
}

export interface ScanResult {
  observations: BssidObservation[];
  at: number;
  source: 'bssid-scan' | 'connected-ap';
}

/** Windows reports signal as a percentage; this is the documented inverse. */
export function pctToDbm(pct: number): number {
  return pct / 2 - 100;
}

/**
 * Linear amplitude from dBm, matching RuView's
 * `BssidObservation::amplitude` in wifi-densepose-wifiscan.
 */
export function dbmToAmplitude(dbm: number): number {
  return 10 ** ((dbm + 100) / 20);
}

/** Split a `Label : value` line. Returns null for anything else. */
function labelled(line: string): { label: string; value: string } | null {
  const idx = line.indexOf(':');
  if (idx < 0) return null;
  const label = line.slice(0, idx).trim();
  const value = line.slice(idx + 1).trim();
  if (label.length === 0) return null;
  return { label, value };
}

function parsePct(value: string): number | null {
  const m = /(\d+)\s*%/.exec(value);
  if (!m?.[1]) return null;
  const pct = Number(m[1]);
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : null;
}

const MAC_RE = /([0-9a-f]{2}:){5}[0-9a-f]{2}/i;

/**
 * Parse `netsh wlan show networks mode=bssid`.
 *
 * Structure, from this machine's real output:
 *
 *   SSID 1 : eduroam
 *       BSSID 1                 : 04:5f:b9:2e:65:ee
 *            Signal             : 22%
 *            Radio type         : 802.11ax
 *            Band               : 5 GHz
 *            Channel            : 64
 */
export function parseBssidScan(stdout: string): BssidObservation[] {
  const out: BssidObservation[] = [];
  let ssid = '';
  let current: Partial<BssidObservation> | null = null;

  const flush = (): void => {
    if (current?.bssid && typeof current.signalPct === 'number') {
      out.push({
        bssid: current.bssid,
        ssid: current.ssid ?? '',
        signalPct: current.signalPct,
        rssiDbm: pctToDbm(current.signalPct),
        ...(current.band !== undefined ? { band: current.band } : {}),
        ...(current.channel !== undefined ? { channel: current.channel } : {}),
        ...(current.radioType !== undefined ? { radioType: current.radioType } : {}),
      });
    }
    current = null;
  };

  for (const rawLine of stdout.split(/\r?\n/)) {
    const kv = labelled(rawLine);
    if (!kv) continue;
    const { label, value } = kv;

    // `SSID 3 : name` — note an empty SSID is legal (hidden network).
    if (/^SSID\s+\d+$/i.test(label)) {
      flush();
      ssid = value;
      continue;
    }

    // `BSSID 2 : 54:8a:ba:ce:f6:a1`
    if (/^BSSID\s+\d+$/i.test(label)) {
      flush();
      const mac = MAC_RE.exec(value);
      current = mac ? { bssid: mac[0].toLowerCase(), ssid } : null;
      continue;
    }

    if (!current) continue;

    if (/^Signal$/i.test(label)) {
      const pct = parsePct(value);
      if (pct !== null) current.signalPct = pct;
    } else if (/^Band$/i.test(label)) {
      current.band = value;
    } else if (/^Channel$/i.test(label)) {
      const ch = Number.parseInt(value, 10);
      if (Number.isFinite(ch)) current.channel = ch;
    } else if (/^Radio type$/i.test(label)) {
      current.radioType = value;
    }
  }
  flush();
  return out;
}

/**
 * Parse `netsh wlan show interfaces` for the connected AP only.
 * This one reports a real `Rssi` field as well as `Signal`, so we prefer it.
 */
export function parseConnectedAp(stdout: string): BssidObservation | null {
  let bssid: string | undefined;
  let ssid = '';
  let signalPct: number | undefined;
  let rssiDbm: number | undefined;
  let band: string | undefined;
  let channel: number | undefined;
  let radioType: string | undefined;
  let connected = false;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const kv = labelled(rawLine);
    if (!kv) continue;
    const { label, value } = kv;

    if (/^State$/i.test(label))
      connected = /connected/i.test(value) && !/disconnected/i.test(value);
    else if (/^(AP\s+)?BSSID$/i.test(label)) {
      const mac = MAC_RE.exec(value);
      if (mac) bssid = mac[0].toLowerCase();
    } else if (/^SSID$/i.test(label)) ssid = value;
    else if (/^Signal$/i.test(label)) {
      const pct = parsePct(value);
      if (pct !== null) signalPct = pct;
    } else if (/^Rssi$/i.test(label)) {
      const n = Number.parseInt(value, 10);
      if (Number.isFinite(n)) rssiDbm = n;
    } else if (/^Band$/i.test(label)) band = value;
    else if (/^Channel$/i.test(label)) {
      const ch = Number.parseInt(value, 10);
      if (Number.isFinite(ch)) channel = ch;
    } else if (/^Radio type$/i.test(label)) radioType = value;
  }

  if (!connected || !bssid) return null;

  // Prefer the driver's own dBm; fall back to deriving it from the percentage.
  const dbm = rssiDbm ?? (signalPct !== undefined ? pctToDbm(signalPct) : undefined);
  if (dbm === undefined) return null;

  return {
    bssid,
    ssid,
    signalPct: signalPct ?? Math.max(0, Math.min(100, (dbm + 100) * 2)),
    rssiDbm: dbm,
    ...(band !== undefined ? { band } : {}),
    ...(channel !== undefined ? { channel } : {}),
    ...(radioType !== undefined ? { radioType } : {}),
  };
}

export class WifiScanError extends Error {}

async function netsh(args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await run('netsh', args, {
      timeout: timeoutMs,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    throw new WifiScanError(`netsh ${args.join(' ')} failed: ${(err as Error).message}`);
  }
}

/** Full multi-AP scan. Slow (driver cache ~10s) but spatially rich. */
export async function scanBssids(timeoutMs = 15_000): Promise<ScanResult> {
  const stdout = await netsh(['wlan', 'show', 'networks', 'mode=bssid'], timeoutMs);
  return { observations: parseBssidScan(stdout), at: Date.now(), source: 'bssid-scan' };
}

/** Connected AP only. Fast, live from the driver. */
export async function scanConnectedAp(timeoutMs = 8_000): Promise<ScanResult> {
  const stdout = await netsh(['wlan', 'show', 'interfaces'], timeoutMs);
  const ap = parseConnectedAp(stdout);
  return { observations: ap ? [ap] : [], at: Date.now(), source: 'connected-ap' };
}

/** True when the platform can plausibly serve a scan at all. */
export function wifiScanSupported(): boolean {
  return process.platform === 'win32';
}
