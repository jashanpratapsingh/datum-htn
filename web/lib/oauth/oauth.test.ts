import { test } from 'node:test';
import assert from 'node:assert/strict';
import { s256, verifyPkce, isValidVerifier } from './pkce.ts';
import { validateRedirectUris, redirectMatches, parseRedirectUri } from './redirect.ts';
import { classifyBearer, bearerFrom, hashToken, newAccessToken, newRefreshToken, newClientId, newCode, CODE_RE, CLIENT_ID_RE } from './tokens.ts';

test('S256 matches the RFC 7636 appendix B vector', () => {
  // verifier and challenge from RFC 7636 §B
  const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  assert.equal(s256(verifier), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  assert.equal(verifyPkce(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'S256'), true);
  assert.equal(verifyPkce(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cX', 'S256'), false);
  assert.equal(verifyPkce(verifier, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', 'plain'), false);
  assert.equal(isValidVerifier('short'), false);
});

test('redirect URIs: loopback http and https accepted, everything else refused', () => {
  assert.equal(validateRedirectUris(['http://localhost:51234/callback', 'https://app.example/cb']).ok, true);
  assert.equal(validateRedirectUris(['http://evil.example/cb']).ok, false);
  assert.equal(validateRedirectUris(['https://app.example/cb#frag']).ok, false);
  assert.equal(validateRedirectUris([]).ok, false);
  assert.equal(validateRedirectUris('nope').ok, false);
  assert.equal(parseRedirectUri('http://127.0.0.1/cb')?.hostname, '127.0.0.1');
});

test('redirect match: loopback ignores the port, https is exact', () => {
  const reg = ['http://localhost:51234/callback', 'https://app.example/cb'];
  assert.equal(redirectMatches(reg, 'http://localhost:9999/callback'), true);
  assert.equal(redirectMatches(reg, 'http://localhost:9999/other'), false);
  assert.equal(redirectMatches(reg, 'https://app.example/cb'), true);
  assert.equal(redirectMatches(reg, 'https://app.example/cb2'), false);
  assert.equal(redirectMatches(reg, 'http://app.example/cb'), false);
});

test('tokens: shapes, classification, hashing', () => {
  const at = newAccessToken();
  const rt = newRefreshToken();
  assert.equal(classifyBearer(at), 'access');
  assert.equal(classifyBearer(rt), 'refresh');
  assert.equal(classifyBearer('vendx_sk_' + 'A'.repeat(43)), 'agent_key');
  assert.equal(classifyBearer('garbage'), 'unknown');
  assert.equal(classifyBearer(undefined), 'unknown');
  assert.match(newCode(), CODE_RE);
  assert.match(newClientId(), CLIENT_ID_RE);
  assert.equal(hashToken(at).length, 64);
  assert.notEqual(hashToken(at), hashToken(rt));
  assert.equal(bearerFrom(`Bearer ${at}`), at);
  assert.equal(bearerFrom(`bearer  ${at}`), at);
  assert.equal(bearerFrom('Basic abc'), null);
  assert.equal(bearerFrom(null), null);
});
