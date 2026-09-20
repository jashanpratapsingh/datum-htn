import { createHash, timingSafeEqual } from 'node:crypto';

/** RFC 7636 S256: base64url(sha256(ascii(code_verifier))). */
export function s256(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidVerifier(v: unknown): v is string {
  return typeof v === 'string' && VERIFIER_RE.test(v);
}

export function isValidChallenge(c: unknown): c is string {
  return typeof c === 'string' && /^[A-Za-z0-9\-_]{43}$/.test(c);
}

/** Constant-time comparison of the derived challenge with the stored one. */
export function verifyPkce(verifier: unknown, challenge: string, method: string): boolean {
  if (method !== 'S256' || !isValidVerifier(verifier)) return false;
  const a = Buffer.from(s256(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}
