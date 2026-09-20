/**
 * Signed, stateless cookies for the Phantom login.
 *
 *   vendx_session  {v:1, w:<wallet>, iat, exp}  7 days   — who is logged in
 *   vendx_siws     {n:<nonce>, exp}             5 min    — the SIWS nonce we issued
 *
 * Value format: base64url(JSON) "." base64url(HMAC-SHA256(secret, payload)).
 * No server state: a nonce is valid when its cookie verifies and has not
 * expired, so there is nothing to sweep and nothing to look up.
 *
 * Server only (node:crypto). Never import from a client component.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextRequest, NextResponse } from 'next/server';

export const SESSION_COOKIE = 'vendx_session';
export const NONCE_COOKIE = 'vendx_siws';
export const SESSION_TTL_SEC = 7 * 24 * 3600;
export const NONCE_TTL_SEC = 5 * 60;

let ephemeralSecret: string | undefined;

function secret(): string {
  const env = process.env.SESSION_SECRET;
  if (env && env.length >= 32) return env;
  if (process.env.VERCEL) {
    throw new Error('SESSION_SECRET is required on Vercel (openssl rand -hex 32)');
  }
  if (!ephemeralSecret) {
    ephemeralSecret = randomBytes(32).toString('hex');
    console.warn(
      '[web] SESSION_SECRET unset: using a per-process secret, sessions will not survive a restart',
    );
  }
  return ephemeralSecret;
}

const b64u = (b: Buffer): string => b.toString('base64url');
const mac = (payload: string): string =>
  b64u(createHmac('sha256', secret()).update(payload).digest());

export function signToken(obj: Record<string, unknown>): string {
  const payload = b64u(Buffer.from(JSON.stringify(obj), 'utf8'));
  return `${payload}.${mac(payload)}`;
}

export function verifyToken<T extends { exp?: number }>(token: string | undefined): T | null {
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot <= 0) return null;
  const payload = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = Buffer.from(mac(payload), 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let obj: T;
  try {
    obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
  if (typeof obj.exp === 'number' && obj.exp <= Math.floor(Date.now() / 1000)) return null;
  return obj;
}

export interface SessionClaims {
  v: 1;
  w: string;
  iat: number;
  exp: number;
}

export interface NonceClaims {
  n: string;
  exp: number;
}

const cookieOpts = (maxAge: number) => ({
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge,
});

export function readSession(req: NextRequest): SessionClaims | null {
  const claims = verifyToken<SessionClaims>(req.cookies.get(SESSION_COOKIE)?.value);
  return claims && claims.v === 1 && typeof claims.w === 'string' ? claims : null;
}

export function setSession(res: NextResponse, wallet: string): SessionClaims {
  const iat = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = { v: 1, w: wallet, iat, exp: iat + SESSION_TTL_SEC };
  res.cookies.set(SESSION_COOKIE, signToken({ ...claims }), cookieOpts(SESSION_TTL_SEC));
  return claims;
}

export function clearSession(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, '', cookieOpts(0));
}

export function issueNonce(res: NextResponse): string {
  const n = randomBytes(16).toString('hex');
  const exp = Math.floor(Date.now() / 1000) + NONCE_TTL_SEC;
  const claims: NonceClaims = { n, exp };
  res.cookies.set(NONCE_COOKIE, signToken({ ...claims }), cookieOpts(NONCE_TTL_SEC));
  return n;
}

export function readNonce(req: NextRequest): string | null {
  const claims = verifyToken<NonceClaims>(req.cookies.get(NONCE_COOKIE)?.value);
  return claims && typeof claims.n === 'string' ? claims.n : null;
}

export function clearNonce(res: NextResponse): void {
  res.cookies.set(NONCE_COOKIE, '', cookieOpts(0));
}
