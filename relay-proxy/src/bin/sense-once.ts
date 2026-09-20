/**
 * Live sensing probe.
 *
 * Not part of the demo — this is the instrument for calibrating and sanity
 * checking the radio on a given machine and in a given room. Run it, stand
 * still, then walk around, and read whether the bands actually separate.
 *
 *   npm run sense -w @vendx/relay-proxy -- --seconds 40
 */
import { FootfallCounter } from '../footfall.js';
import { MotionEstimator, fuseMotion, type MotionReading } from '../motion.js';
import { scanBssids, scanConnectedAp, wifiScanSupported } from '../wifi-scan.js';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const seconds = arg('seconds', 30);
const fastMs = arg('fast-ms', 1000);
const slowMs = arg('slow-ms', 6000);

async function main(): Promise<void> {
  if (!wifiScanSupported()) {
    console.error(`WiFi scanning is Windows-only here; platform is ${process.platform}`);
    process.exit(2);
  }

  // The fast channel watches one AP whose quantised RSSI legitimately repeats,
  // so it must not treat a repeat as a cached scan.
  const fast = new MotionEstimator({ dedupeIdentical: false });
  const slow = new MotionEstimator({ dedupeIdentical: true });
  const footfall = new FootfallCounter();

  let lastFast: MotionReading | null = null;
  let lastSlow: MotionReading | null = null;
  let fastErrors = 0;
  let slowErrors = 0;

  console.log(
    `probing for ${seconds}s  (connected AP every ${fastMs}ms, full scan every ${slowMs}ms)`,
  );
  console.log('walk around after the baseline settles\n');
  console.log('    t  tier          energy  band      APs  coh   devDb  footfall');

  const started = Date.now();

  const fastTimer = setInterval(() => {
    void scanConnectedAp()
      .then((r) => {
        lastFast = fast.update(r.observations);
      })
      .catch(() => {
        fastErrors++;
      });
  }, fastMs);

  const slowTimer = setInterval(() => {
    void scanBssids()
      .then((r) => {
        lastSlow = slow.update(r.observations);
      })
      .catch(() => {
        slowErrors++;
      });
  }, slowMs);

  const report = setInterval(() => {
    const fused = fuseMotion(lastFast, lastSlow);
    if (!fused) return;
    if (!fused.warmingUp && !fused.stale) footfall.observe(fused.energy);

    const t = ((Date.now() - started) / 1000).toFixed(0).padStart(5);
    const tier = fused.warmingUp
      ? 'warming-up  '
      : fused.stale
        ? 'stale       '
        : 'MEASURED_RSSI';

    console.log(
      [
        t,
        tier.padEnd(13),
        fused.energy.toFixed(4).padStart(7),
        fused.level.padEnd(9),
        String(fused.apCount).padStart(4),
        fused.coherence.toFixed(2).padStart(5),
        fused.meanDeviationDb.toFixed(2).padStart(6),
        String(footfall.state().today).padStart(6),
      ].join(' '),
    );
  }, 1000);

  await new Promise((r) => setTimeout(r, seconds * 1000));
  clearInterval(fastTimer);
  clearInterval(slowTimer);
  clearInterval(report);

  const s = footfall.state();
  console.log(`\ncrossings counted: ${s.today}   impulses rejected: ${s.rejectedImpulses}`);
  console.log(`tracked APs: fast=${fast.trackedAps} slow=${slow.trackedAps}`);
  if (fastErrors || slowErrors) {
    console.log(`scan errors: fast=${fastErrors} slow=${slowErrors}`);
  }
}

void main();
