/**
 * RuView wire formats, so VENDX speaks the device's language today and does not
 * have to change when a board replaces the host radio.
 *
 * Two packet types arrive on UDP 5005 from `firmware/esp32-csi-node`:
 *
 *   0xC5110002  edge vitals, 32 bytes, 1 Hz  — presence, motion, n_persons
 *   0xC5110001  raw CSI, 20-byte header + I/Q, ~20 Hz
 *
 * Struct layout is taken from `main/edge_processing.h` (which carries a
 * `_Static_assert(sizeof(edge_vitals_pkt_t) == 32)`) and `main/csi_collector.c`.
 * ESP32 is little-endian and the struct is `__attribute__((packed))`.
 */

export const EDGE_VITALS_MAGIC = 0xc5110002;
export const EDGE_VITALS_SIZE = 32;
export const CSI_FRAME_MAGIC = 0xc5110001;
export const CSI_HEADER_SIZE = 20;

/** Flag bits in `edge_vitals_pkt_t.flags` (edge_processing.c:914-916). */
export const VITALS_FLAG_PRESENCE = 0x01;
export const VITALS_FLAG_FALL = 0x02;
export const VITALS_FLAG_MOTION = 0x04;

export interface EdgeVitals {
  nodeId: number;
  presence: boolean;
  fall: boolean;
  motion: boolean;
  /** Breaths per minute. Transmitted as BPM * 100. */
  breathingRate: number;
  /** Beats per minute. Transmitted as BPM * 10000. */
  heartRate: number;
  rssi: number;
  /** Instantaneous occupancy. A slot-capacity heuristic, not a learned count. */
  nPersons: number;
  motionEnergy: number;
  presenceScore: number;
  /** Device uptime in milliseconds, not a wall clock. */
  timestampMs: number;
}

export function encodeVitals(v: EdgeVitals): Uint8Array {
  const buf = new Uint8Array(EDGE_VITALS_SIZE);
  const dv = new DataView(buf.buffer);

  let flags = 0;
  if (v.presence) flags |= VITALS_FLAG_PRESENCE;
  if (v.fall) flags |= VITALS_FLAG_FALL;
  if (v.motion) flags |= VITALS_FLAG_MOTION;

  dv.setUint32(0, EDGE_VITALS_MAGIC, true);
  dv.setUint8(4, v.nodeId & 0xff);
  dv.setUint8(5, flags);
  dv.setUint16(6, Math.round(v.breathingRate * 100) & 0xffff, true);
  dv.setUint32(8, Math.round(v.heartRate * 10000) >>> 0, true);
  dv.setInt8(12, clampInt8(v.rssi));
  dv.setUint8(13, Math.max(0, Math.min(255, Math.round(v.nPersons))));
  // bytes 14-15 reserved
  dv.setFloat32(16, v.motionEnergy, true);
  dv.setFloat32(20, v.presenceScore, true);
  dv.setUint32(24, v.timestampMs >>> 0, true);
  // bytes 28-31 reserved2

  return buf;
}

export function decodeVitals(buf: Uint8Array): EdgeVitals | null {
  if (buf.byteLength < EDGE_VITALS_SIZE) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== EDGE_VITALS_MAGIC) return null;

  const flags = dv.getUint8(5);
  return {
    nodeId: dv.getUint8(4),
    presence: (flags & VITALS_FLAG_PRESENCE) !== 0,
    fall: (flags & VITALS_FLAG_FALL) !== 0,
    motion: (flags & VITALS_FLAG_MOTION) !== 0,
    breathingRate: dv.getUint16(6, true) / 100,
    heartRate: dv.getUint32(8, true) / 10000,
    rssi: dv.getInt8(12),
    nPersons: dv.getUint8(13),
    motionEnergy: dv.getFloat32(16, true),
    presenceScore: dv.getFloat32(20, true),
    timestampMs: dv.getUint32(24, true),
  };
}

/** Header of an ADR-018 raw CSI frame. The I/Q payload follows it. */
export interface CsiFrameHeader {
  nodeId: number;
  antennas: number;
  subcarriers: number;
  freqMhz: number;
  sequence: number;
  rssi: number;
  noiseFloor: number;
  ppduType: number;
  flags: number;
}

export function decodeCsiHeader(buf: Uint8Array): CsiFrameHeader | null {
  if (buf.byteLength < CSI_HEADER_SIZE) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== CSI_FRAME_MAGIC) return null;

  return {
    nodeId: dv.getUint8(4),
    antennas: dv.getUint8(5),
    subcarriers: dv.getUint16(6, true),
    freqMhz: dv.getUint32(8, true),
    sequence: dv.getUint32(12, true),
    rssi: dv.getInt8(16),
    noiseFloor: dv.getInt8(17),
    ppduType: dv.getUint8(18),
    flags: dv.getUint8(19),
  };
}

/** Which RuView packet is this? Returns null for anything unrecognised. */
export function packetKind(buf: Uint8Array): 'vitals' | 'csi' | null {
  if (buf.byteLength < 4) return null;
  const magic = new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(0, true);
  if (magic === EDGE_VITALS_MAGIC) return 'vitals';
  if (magic === CSI_FRAME_MAGIC) return 'csi';
  return null;
}

function clampInt8(n: number): number {
  return Math.max(-128, Math.min(127, Math.round(n)));
}
