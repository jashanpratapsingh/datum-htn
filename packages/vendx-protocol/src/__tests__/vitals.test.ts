import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CSI_FRAME_MAGIC,
  EDGE_VITALS_MAGIC,
  EDGE_VITALS_SIZE,
  decodeCsiHeader,
  decodeVitals,
  encodeVitals,
  packetKind,
  type EdgeVitals,
} from '../vitals.js';
import { capabilityOf, describeProvenance, isMeasured } from '../provenance.js';
import { caveatFor, motionLevelOf, sealPayload } from '../telemetry.js';

/**
 * These bytes have to match `edge_vitals_pkt_t` exactly, because real firmware is
 * on the other end of the socket. The struct carries a
 * `_Static_assert(sizeof(edge_vitals_pkt_t) == 32)`, so the size is a hard
 * requirement, not a convention.
 */

const SAMPLE: EdgeVitals = {
  nodeId: 7,
  presence: true,
  fall: false,
  motion: true,
  breathingRate: 14.25,
  heartRate: 62.5,
  rssi: -67,
  nPersons: 3,
  motionEnergy: 0.375,
  presenceScore: 0.75,
  timestampMs: 123_456_789,
};

test('a vitals packet is exactly 32 bytes', () => {
  assert.equal(encodeVitals(SAMPLE).byteLength, EDGE_VITALS_SIZE);
  assert.equal(EDGE_VITALS_SIZE, 32);
});

test('the magic is little-endian at offset 0', () => {
  const buf = encodeVitals(SAMPLE);
  const dv = new DataView(buf.buffer);
  assert.equal(dv.getUint32(0, true), EDGE_VITALS_MAGIC);
  assert.equal(EDGE_VITALS_MAGIC, 0xc5110002);
});

test('vitals round-trip through the wire format', () => {
  const decoded = decodeVitals(encodeVitals(SAMPLE));
  assert.ok(decoded);
  assert.equal(decoded.nodeId, 7);
  assert.equal(decoded.presence, true);
  assert.equal(decoded.fall, false);
  assert.equal(decoded.motion, true);
  assert.equal(decoded.rssi, -67);
  assert.equal(decoded.nPersons, 3);
  assert.equal(decoded.timestampMs, 123_456_789);
  // Chosen so the fixed-point encodings are exact.
  assert.equal(decoded.breathingRate, 14.25);
  assert.equal(decoded.heartRate, 62.5);
  assert.equal(decoded.motionEnergy, 0.375);
  assert.equal(decoded.presenceScore, 0.75);
});

test('the flag bits sit where the firmware puts them', () => {
  const bits = (v: Partial<EdgeVitals>): number => {
    const buf = encodeVitals({ ...SAMPLE, presence: false, fall: false, motion: false, ...v });
    return new DataView(buf.buffer).getUint8(5);
  };
  assert.equal(bits({ presence: true }), 0x01);
  assert.equal(bits({ fall: true }), 0x02);
  assert.equal(bits({ motion: true }), 0x04);
  assert.equal(bits({ presence: true, fall: true, motion: true }), 0x07);
});

test('a negative RSSI survives as a signed byte', () => {
  for (const rssi of [-1, -30, -95, -128, 0]) {
    assert.equal(decodeVitals(encodeVitals({ ...SAMPLE, rssi }))?.rssi, rssi);
  }
});

test('an out-of-range RSSI is clamped rather than wrapped', () => {
  // Wrapping would turn a bad reading into a plausible-looking good one.
  assert.equal(decodeVitals(encodeVitals({ ...SAMPLE, rssi: -200 }))?.rssi, -128);
  assert.equal(decodeVitals(encodeVitals({ ...SAMPLE, rssi: 500 }))?.rssi, 127);
});

test('garbage and truncated buffers decode to null, never to a guess', () => {
  assert.equal(decodeVitals(new Uint8Array(0)), null);
  assert.equal(decodeVitals(new Uint8Array(31)), null);
  assert.equal(decodeVitals(new Uint8Array(32)), null, 'zeroed magic is not a vitals packet');

  const wrongMagic = encodeVitals(SAMPLE);
  new DataView(wrongMagic.buffer).setUint32(0, 0xdeadbeef, true);
  assert.equal(decodeVitals(wrongMagic), null);
});

test('decoding respects a byteOffset, so a pooled read buffer is safe', () => {
  const packet = encodeVitals(SAMPLE);
  const pool = new Uint8Array(64);
  pool.set(packet, 16);
  const view = pool.subarray(16, 16 + EDGE_VITALS_SIZE);
  assert.equal(decodeVitals(view)?.nodeId, 7);
});

test('packetKind separates the two RuView streams', () => {
  assert.equal(packetKind(encodeVitals(SAMPLE)), 'vitals');

  const csi = new Uint8Array(20);
  new DataView(csi.buffer).setUint32(0, CSI_FRAME_MAGIC, true);
  assert.equal(packetKind(csi), 'csi');

  assert.equal(packetKind(new Uint8Array(3)), null);
  assert.equal(packetKind(new Uint8Array(20)), null);
});

test('a CSI header decodes its fields', () => {
  const buf = new Uint8Array(20);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, CSI_FRAME_MAGIC, true);
  dv.setUint8(4, 2); // nodeId
  dv.setUint8(5, 3); // antennas
  dv.setUint16(6, 64, true); // subcarriers
  dv.setUint32(8, 5210, true); // freqMhz
  dv.setUint32(12, 999, true); // sequence
  dv.setInt8(16, -55); // rssi
  dv.setInt8(17, -92); // noiseFloor

  const h = decodeCsiHeader(buf);
  assert.ok(h);
  assert.equal(h.nodeId, 2);
  assert.equal(h.antennas, 3);
  assert.equal(h.subcarriers, 64);
  assert.equal(h.freqMhz, 5210);
  assert.equal(h.sequence, 999);
  assert.equal(h.rssi, -55);
  assert.equal(h.noiseFloor, -92);

  assert.equal(decodeCsiHeader(new Uint8Array(19)), null);
});

/* ---------- honesty rules ---------- */

test('RSSI tier withholds the head count instead of guessing it', () => {
  const cap = capabilityOf('MEASURED_RSSI');
  assert.equal(cap.nPersons, false);
  assert.equal(cap.breathingRate, false);
  assert.equal(cap.motion, true);

  const sealed = sealPayload({
    nodeId: 1,
    resource: '/api/telemetry',
    observedAt: Date.now(),
    provenance: 'MEASURED_RSSI',
    footTraffic: 12,
    presence: true,
    motionEnergy: 0.2,
    motionLevel: 'Moderate',
    rssi: -60,
    nPersons: 4, // a caller trying to sell an unsupported number
    breathingRate: 15,
  });

  assert.equal('nPersons' in sealed, false, 'an unsupported field must be dropped');
  assert.equal('breathingRate' in sealed, false);
  assert.equal(sealed.footTraffic, 12);
});

test('CSI tier may carry the fields RSSI cannot', () => {
  const sealed = sealPayload({
    nodeId: 1,
    resource: '/api/telemetry',
    observedAt: Date.now(),
    provenance: 'MEASURED_CSI',
    footTraffic: 3,
    presence: true,
    motionEnergy: 0.2,
    motionLevel: 'Moderate',
    rssi: -60,
    nPersons: 2,
    breathingRate: 15,
  });
  assert.equal(sealed.nPersons, 2);
  assert.equal(sealed.breathingRate, 15);
});

test('every payload carries a caveat, and only CSI omits "not camera-grade"', () => {
  assert.match(caveatFor('MEASURED_RSSI'), /not camera-grade/);
  assert.match(caveatFor('SIMULATED'), /not camera-grade/);
  assert.doesNotMatch(caveatFor('MEASURED_CSI'), /not camera-grade/);
  for (const p of ['MEASURED_CSI', 'MEASURED_RSSI', 'SIMULATED'] as const) {
    assert.match(caveatFor(p), /heuristic/, 'footfall must always be labelled a heuristic');
    assert.ok(describeProvenance(p).length > 0);
  }
});

test('only real radios count as measured', () => {
  assert.equal(isMeasured('MEASURED_CSI'), true);
  assert.equal(isMeasured('MEASURED_RSSI'), true);
  assert.equal(isMeasured('SIMULATED'), false);
});

test('motion bands match the ported thresholds', () => {
  assert.equal(motionLevelOf(0), 'None');
  assert.equal(motionLevelOf(0.019), 'None');
  assert.equal(motionLevelOf(0.02), 'Minimal');
  assert.equal(motionLevelOf(0.099), 'Minimal');
  assert.equal(motionLevelOf(0.1), 'Moderate');
  assert.equal(motionLevelOf(0.299), 'Moderate');
  assert.equal(motionLevelOf(0.3), 'High');
  assert.equal(motionLevelOf(99), 'High');
});
