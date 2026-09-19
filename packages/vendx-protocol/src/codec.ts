import nacl from 'tweetnacl';
import type {
  PaymentPayload,
  ReceiptBody,
  SettleResponse,
  SignedReceipt,
} from './types.js';

/* ------------------------------------------------------------------ *
 * base64url — the firmware mirrors this exactly (see verifier.cpp).
 * We use base64url, not base64, so receipts survive being put in a
 * header, a query string or a QR code without re-encoding.
 * ------------------------------------------------------------------ */

export function b64uEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

/* ------------------------------------------------------------------ *
 * Canonical JSON.
 *
 * Receipts are signed over bytes, so both signer and verifier must agree
 * byte-for-byte. JSON.stringify key order follows insertion order, which
 * is too fragile to rely on across languages — so we sort keys and emit
 * a fixed field order. The ESP32 never re-serializes a receipt; it
 * verifies the transmitted bytes directly, which sidesteps the problem
 * on the constrained side.
 * ------------------------------------------------------------------ */

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/* ------------------------------------------------------------------ *
 * X-PAYMENT header
 * ------------------------------------------------------------------ */

export function encodePaymentHeader(p: PaymentPayload): string {
  return b64uEncode(new TextEncoder().encode(canonicalJson(p)));
}

export function decodePaymentHeader(header: string): PaymentPayload | null {
  try {
    const json = new TextDecoder().decode(b64uDecode(header.trim()));
    const parsed = JSON.parse(json) as PaymentPayload;
    if (parsed?.scheme !== 'exact') return null;
    if (typeof parsed?.payload?.signature !== 'string') return null;
    if (typeof parsed?.payload?.nonce !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * X-PAYMENT-RESPONSE header
 * ------------------------------------------------------------------ */

export function encodeSettleHeader(r: SettleResponse): string {
  return b64uEncode(new TextEncoder().encode(canonicalJson(r)));
}

export function decodeSettleHeader(header: string): SettleResponse | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64uDecode(header.trim()))) as SettleResponse;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Signed receipts
 * ------------------------------------------------------------------ */

/** Sign a receipt body with the facilitator's Ed25519 secret key (64 bytes). */
export function signReceipt(body: ReceiptBody, secretKey: Uint8Array): SignedReceipt {
  const bodyBytes = new TextEncoder().encode(canonicalJson(body));
  const encodedBody = b64uEncode(bodyBytes);
  // Sign the TRANSMITTED bytes (the base64url text), not the pre-encoding JSON.
  // That way the device verifies exactly what arrived on the wire and never has
  // to reproduce our JSON serialization to check the signature.
  const sig = nacl.sign.detached(new TextEncoder().encode(encodedBody), secretKey);
  return { body: encodedBody, sig: b64uEncode(sig) };
}

/** Verify a signed receipt against the facilitator's 32-byte public key. */
export function verifyReceipt(
  receipt: SignedReceipt,
  publicKey: Uint8Array,
): ReceiptBody | null {
  try {
    const ok = nacl.sign.detached.verify(
      new TextEncoder().encode(receipt.body),
      b64uDecode(receipt.sig),
      publicKey,
    );
    if (!ok) return null;
    return JSON.parse(new TextDecoder().decode(b64uDecode(receipt.body))) as ReceiptBody;
  } catch {
    return null;
  }
}

/** Wire form of a receipt: `<body>.<sig>`, compact and header-safe. */
export function encodeReceipt(r: SignedReceipt): string {
  return `${r.body}.${r.sig}`;
}

export function decodeReceipt(s: string): SignedReceipt | null {
  const dot = s.indexOf('.');
  if (dot <= 0 || dot === s.length - 1) return null;
  return { body: s.slice(0, dot), sig: s.slice(dot + 1) };
}
