/**
 * Verify a Sign In With Solana result on the server.
 *
 * Order matters: the Ed25519 check comes first so nothing below runs on bytes
 * the wallet did not sign. Then the signed text is parsed and every field we
 * issued is compared: domain (the site the user saw in Phantom), address (the
 * key that signed), nonce (the one in the vendx_siws cookie) and issue time.
 */

import nacl from 'tweetnacl';
import { PublicKey } from '@solana/web3.js';
import { parseSiwsMessage, type ParsedSiws } from '@/lib/wallet/siws';

export type SiwsError =
  | 'bad_signature'
  | 'malformed_message'
  | 'domain_mismatch'
  | 'address_mismatch'
  | 'nonce_mismatch'
  | 'expired';

export type SiwsResult =
  | { ok: true; parsed: ParsedSiws }
  | { ok: false; error: SiwsError; detail?: string };

const ISSUED_AT_SKEW_SEC = 10 * 60;

export function verifySignIn(opts: {
  address: string;
  signedMessage: Uint8Array;
  signature: Uint8Array;
  expectedNonce: string;
  allowedDomains: string[];
  now?: number;
}): SiwsResult {
  let pubkey: Uint8Array;
  try {
    pubkey = new PublicKey(opts.address).toBytes();
  } catch {
    return { ok: false, error: 'address_mismatch', detail: 'address is not a public key' };
  }
  if (opts.signature.length !== nacl.sign.signatureLength) {
    return { ok: false, error: 'bad_signature', detail: 'signature length' };
  }
  if (!nacl.sign.detached.verify(opts.signedMessage, opts.signature, pubkey)) {
    return { ok: false, error: 'bad_signature' };
  }

  const parsed = parseSiwsMessage(new TextDecoder().decode(opts.signedMessage));
  if (!parsed) return { ok: false, error: 'malformed_message' };

  if (!opts.allowedDomains.includes(parsed.domain)) {
    return { ok: false, error: 'domain_mismatch', detail: parsed.domain };
  }
  if (parsed.address !== opts.address) {
    return { ok: false, error: 'address_mismatch', detail: 'signed address differs from the claimed one' };
  }
  if (!parsed.nonce || parsed.nonce !== opts.expectedNonce) {
    return { ok: false, error: 'nonce_mismatch' };
  }

  const now = opts.now ?? Date.now();
  if (parsed.issuedAt) {
    const t = Date.parse(parsed.issuedAt);
    if (Number.isNaN(t)) return { ok: false, error: 'malformed_message', detail: 'Issued At' };
    if (Math.abs(now - t) > ISSUED_AT_SKEW_SEC * 1000) return { ok: false, error: 'expired', detail: 'Issued At' };
  }
  if (parsed.expirationTime) {
    const t = Date.parse(parsed.expirationTime);
    if (Number.isNaN(t) || t <= now) return { ok: false, error: 'expired', detail: 'Expiration Time' };
  }
  if (parsed.notBefore) {
    const t = Date.parse(parsed.notBefore);
    if (Number.isNaN(t) || t > now) return { ok: false, error: 'expired', detail: 'Not Before' };
  }
  return { ok: true, parsed };
}

/** Hosts accepted in the SIWS domain line: the request's own Host plus SIWS_ALLOWED_DOMAINS. */
export function allowedDomains(host: string | null): string[] {
  const extra = (process.env.SIWS_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return host ? [host, ...extra] : extra;
}
