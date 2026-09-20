import assert from 'node:assert/strict';
import { test } from 'node:test';

import { MotionEstimator, WARMUP_SAMPLES, fuseMotion, type MotionReading } from '../motion.js';
import { parseBssidScan, parseConnectedAp, pctToDbm, type BssidObservation } from '../wifi-scan.js';

/** Real output captured from this machine, trimmed to three access points. */
const REAL_SCAN = `
Interface name : Wi-Fi 
There are 5 networks currently visible. 

SSID 1 : eduroam
    Network type            : Infrastructure
    Authentication          : WPA2-Enterprise
    Encryption              : CCMP 
    BSSID 1                 : 04:5f:b9:2e:65:ee
         Signal             : 22%  
         Radio type         : 802.11ax
         Band               : 5 GHz
         Channel            : 64 
         Bss Load:
             Connected Stations:         2
             Channel Utilization:        18 (7 %)
         Basic rates (Mbps) : 12
    BSSID 2                 : 54:8a:ba:ce:f6:a1
         Signal             : 80%  
         Radio type         : 802.11ax
         Band               : 2.4 GHz
         Channel            : 11 
SSID 2 : 
    Network type            : Infrastructure
    BSSID 1                 : 54:8a:ba:db:44:01
         Signal             : 81%  
         Radio type         : 802.11ax
         Band               : 2.4 GHz
         Channel            : 11 
`;

const REAL_INTERFACE = `
There is 1 interface on the system: 

    Name                   : Wi-Fi
    Description            : Intel(R) Wi-Fi 6E AX211 160MHz
    State                  : connected
    SSID                   : eduroam
    AP BSSID               : 14:16:9d:2b:45:ae
    Band                   : 5 GHz
    Channel                : 132
    Receive rate (Mbps)    : 344
    Signal                 : 72% 
    Rssi                   : -70
    Profile                : eduroam 
`;

test('the real BSSID scan parses, including a hidden SSID', () => {
  const obs = parseBssidScan(REAL_SCAN);
  assert.equal(obs.length, 3);
  assert.deepEqual(obs[0], {
    bssid: '04:5f:b9:2e:65:ee',
    ssid: 'eduroam',
    signalPct: 22,
    rssiDbm: -89,
    band: '5 GHz',
    channel: 64,
    radioType: '802.11ax',
  });
  // The third AP belongs to the hidden network, and must not inherit 'eduroam'.
  assert.equal(obs[2]?.ssid, '');
  assert.equal(obs[2]?.bssid, '54:8a:ba:db:44:01');
  assert.equal(obs[2]?.signalPct, 81);
});

test('Bss Load noise lines do not corrupt the parse', () => {
  const obs = parseBssidScan(REAL_SCAN);
  // "Channel Utilization : 18 (7 %)" contains a colon and a percent sign and
  // sits inside a BSSID block, so a naive parser would read it as Signal.
  assert.equal(obs[0]?.signalPct, 22, 'signal must come from the Signal line only');
  assert.equal(obs[0]?.channel, 64, 'channel must not be overwritten by Bss Load');
});

test('the connected AP parses and prefers the driver dBm over the percentage', () => {
  const ap = parseConnectedAp(REAL_INTERFACE);
  assert.ok(ap);
  assert.equal(ap.bssid, '14:16:9d:2b:45:ae');
  assert.equal(ap.ssid, 'eduroam');
  // 72% would derive -64 dBm, but the driver reported -70. Trust the driver.
  assert.equal(ap.rssiDbm, -70);
  assert.equal(ap.signalPct, 72);
});

test('a disconnected interface yields no observation', () => {
  assert.equal(parseConnectedAp(REAL_INTERFACE.replace('connected', 'disconnected')), null);
  assert.equal(parseConnectedAp(''), null);
});

test('percentage to dBm follows the documented linear map', () => {
  assert.equal(pctToDbm(100), -50);
  assert.equal(pctToDbm(0), -100);
  assert.equal(pctToDbm(50), -75);
});

/* ---------- the estimator ---------- */

function aps(levels: number[]): BssidObservation[] {
  return levels.map((dbm, i) => ({
    bssid: `aa:bb:cc:dd:ee:${String(i).padStart(2, '0')}`,
    ssid: 'test',
    signalPct: Math.max(0, Math.min(100, (dbm + 100) * 2)),
    rssiDbm: dbm,
  }));
}

/**
 * Feed a settled baseline.
 *
 * The jitter is never zero and never repeats on consecutive frames, so no
 * settling frame can collide with a plain `aps(base)` fed afterwards. Without
 * that, the stale-scan detector would fire and silently mask the path the test
 * meant to exercise.
 */
function settle(est: MotionEstimator, base: number[], t0 = 1000): number {
  let t = t0;
  for (let i = 0; i < WARMUP_SAMPLES + 4; i++) {
    const offset = 0.01 * ((i % 3) + 1);
    est.update(
      aps(base.map((d, j) => d + offset * (j + 1))),
      t,
    );
    t += 1000;
  }
  return t;
}

test('a quiet room settles to no motion', () => {
  const est = new MotionEstimator();
  const t = settle(est, [-60, -65, -70]);
  const reading = est.update(aps([-60, -65, -70]), t);
  assert.equal(reading.warmingUp, false);
  assert.equal(reading.level, 'None');
  assert.ok(reading.energy < 0.02, `expected quiet, got ${reading.energy}`);
});

test('warming up is reported until a baseline exists', () => {
  const est = new MotionEstimator();
  const first = est.update(aps([-60, -65, -70]), 1000);
  assert.equal(first.warmingUp, true);
  assert.equal(first.apCount, 0, 'no AP can be judged on its first sighting');
});

test('a coherent multi-AP swing registers real motion', () => {
  const est = new MotionEstimator();
  const t = settle(est, [-60, -65, -70]);
  // A body crossing several paths: every AP moves a few dB at once.
  let reading = est.update(aps([-66, -71, -64]), t);
  reading = est.update(aps([-67, -70, -65]), t + 1000);
  assert.equal(reading.coherence, 1, 'all tracked APs moved together');
  assert.ok(reading.energy > 0.02, `expected motion, got ${reading.energy}`);
});

test('one flapping AP is damped by the coherence factor', () => {
  const lone = new MotionEstimator();
  const tl = settle(lone, [-60, -65, -70]);
  const loneReading = lone.update(aps([-72, -65, -70]), tl);

  const many = new MotionEstimator();
  const tm = settle(many, [-60, -65, -70]);
  const manyReading = many.update(aps([-64, -69, -74]), tm);

  // The lone AP moved 12 dB; the coherent case only 4 dB each. Coherence
  // weighting must stop the single noisy AP dominating the coherent event.
  assert.ok(
    manyReading.energy > loneReading.energy,
    `coherent ${manyReading.energy} should beat lone ${loneReading.energy}`,
  );
  assert.ok(loneReading.coherence < manyReading.coherence);
});

test('one AP dropping out cannot fake unlimited motion', () => {
  const est = new MotionEstimator();
  const t = settle(est, [-60, -65, -70]);
  // A 60 dB collapse is clamped to MAX_RESIDUAL_DB.
  const reading = est.update(aps([-60, -65, -130]), t);
  assert.ok(reading.meanDeviationDb <= 12, `clamped, got ${reading.meanDeviationDb}`);
});

test('an identical repeated scan is reported stale and does not move the baseline', () => {
  const est = new MotionEstimator();
  const t = settle(est, [-60, -65, -70]);
  const same = aps([-60, -65, -70]);
  const first = est.update(same, t);
  const second = est.update(same, t + 1000);
  assert.equal(first.stale, false, 'the first sighting of a frame is fresh');
  assert.equal(second.stale, true, 'the ~10s driver cache must be detected');
  assert.equal(second.energy, first.energy, 'a cached scan cannot change the verdict');
});

test('an unseen AP is eventually forgotten', () => {
  const est = new MotionEstimator({ forgetAfterMs: 5_000 });
  settle(est, [-60, -65, -70]);
  assert.equal(est.trackedAps, 3);
  est.update(aps([-60]), 1_000_000);
  assert.equal(est.trackedAps, 1, 'stale APs dropped');
});

/* ---------- fusion ---------- */

const QUIET: MotionReading = {
  energy: 0.01,
  level: 'None',
  apCount: 1,
  coherence: 0,
  meanDeviationDb: 0.1,
  warmingUp: false,
  stale: false,
  at: 1,
};

const LOUD: MotionReading = {
  energy: 0.25,
  level: 'Moderate',
  apCount: 12,
  coherence: 0.8,
  meanDeviationDb: 3,
  warmingUp: false,
  stale: false,
  at: 1,
};

test('fusion takes the louder of the two trustworthy channels', () => {
  const fused = fuseMotion({ ...QUIET }, { ...LOUD });
  assert.equal(fused?.energy, 0.25);
  assert.equal(fused?.apCount, 13, 'AP counts combine');
});

test('a stale or warming channel never wins the fusion', () => {
  const trustworthy: MotionReading = {
    energy: 0.03,
    level: 'Minimal',
    apCount: 1,
    coherence: 0.5,
    meanDeviationDb: 1,
    warmingUp: false,
    stale: false,
    at: 1,
  };
  const staleLoud: MotionReading = {
    energy: 0.9,
    level: 'High',
    apCount: 9,
    coherence: 1,
    meanDeviationDb: 9,
    warmingUp: false,
    stale: true,
    at: 1,
  };
  const warmLoud: MotionReading = { ...staleLoud, stale: false, warmingUp: true };

  assert.equal(fuseMotion({ ...trustworthy }, { ...staleLoud })?.energy, 0.03);
  assert.equal(fuseMotion({ ...trustworthy }, { ...warmLoud })?.energy, 0.03);
});

test('fusion with nothing trustworthy still surfaces state', () => {
  assert.equal(fuseMotion(null, null), null);
  const warming: MotionReading = {
    energy: 0,
    level: 'None',
    apCount: 0,
    coherence: 0,
    meanDeviationDb: 0,
    warmingUp: true,
    stale: false,
    at: 1,
  };
  assert.equal(fuseMotion({ ...warming }, null)?.warmingUp, true);
});
