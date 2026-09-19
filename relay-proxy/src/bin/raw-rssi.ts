/**
 * Raw radio diagnostic.
 *
 * Answers one question the motion estimator cannot: does this machine's WiFi
 * driver actually report a *changing* RSSI, or does it hand back a frozen value?
 * If the connected AP's RSSI never moves, WiFi sensing on this host is dead in
 * the water and there is no point tuning thresholds.
 *
 *   node relay-proxy/dist/bin/raw-rssi.js --seconds 30
 */
import { scanBssids, scanConnectedAp, wifiScanSupported } from '../wifi-scan.js';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const seconds = arg('seconds', 30);

async function main(): Promise<void> {
  if (!wifiScanSupported()) {
    console.error(`Windows only; platform is ${process.platform}`);
    process.exit(2);
  }

  // How many access points can we even see, and how fresh is a repeat scan?
  const scanA = await scanBssids();
  console.log(`full scan: ${scanA.observations.length} access points visible`);
  for (const o of scanA.observations.slice(0, 8)) {
    console.log(
      `  ${o.bssid}  ${String(o.signalPct).padStart(3)}%  ${String(o.rssiDbm).padStart(6)} dBm  ${o.band ?? '?'}  ${o.ssid || '(hidden)'}`,
    );
  }

  const t0 = Date.now();
  const scanB = await scanBssids();
  const changed = scanB.observations.filter((b) => {
    const a = scanA.observations.find((x) => x.bssid === b.bssid);
    return a && a.rssiDbm !== b.rssiDbm;
  }).length;
  console.log(
    `\nback-to-back rescan took ${Date.now() - t0}ms; ${changed}/${scanB.observations.length} APs changed value`,
  );
  console.log('(0 changed means the driver served a cached scan)\n');

  // Now watch the connected AP, which should be live.
  console.log(`watching the connected AP for ${seconds}s — move around to see if it responds`);
  console.log('     t   dBm   pct  delta');

  let prev: number | null = null;
  const seen: number[] = [];
  const started = Date.now();

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      void scanConnectedAp()
        .then((r) => {
          const ap = r.observations[0];
          const t = ((Date.now() - started) / 1000).toFixed(0).padStart(6);
          if (!ap) {
            console.log(`${t}   -- not connected --`);
            return;
          }
          seen.push(ap.rssiDbm);
          const delta = prev === null ? 0 : ap.rssiDbm - prev;
          prev = ap.rssiDbm;
          const bar = '#'.repeat(Math.min(30, Math.abs(delta) * 3));
          console.log(
            `${t} ${String(ap.rssiDbm).padStart(5)} ${String(ap.signalPct).padStart(4)}% ${delta >= 0 ? '+' : ''}${delta} ${bar}`,
          );
        })
        .catch((e: unknown) => console.log(`  scan error: ${(e as Error).message}`));

      if (Date.now() - started >= seconds * 1000) {
        clearInterval(timer);
        resolve();
      }
    }, 1000);
  });

  if (seen.length > 1) {
    const min = Math.min(...seen);
    const max = Math.max(...seen);
    const distinct = new Set(seen).size;
    const mean = seen.reduce((a, b) => a + b, 0) / seen.length;
    const sd = Math.sqrt(seen.reduce((a, b) => a + (b - mean) ** 2, 0) / seen.length);
    console.log(
      `\nsamples ${seen.length}  distinct ${distinct}  range ${min}..${max} dBm (${max - min} dB)  sd ${sd.toFixed(2)} dB`,
    );
    if (distinct === 1) {
      console.log('VERDICT: RSSI is frozen. The fast channel is unusable on this host.');
    } else if (max - min < 2) {
      console.log('VERDICT: RSSI moves but barely. Expect weak, slow motion detection.');
    } else {
      console.log('VERDICT: RSSI is live and responsive. WiFi sensing is viable here.');
    }
  }
}

void main();
