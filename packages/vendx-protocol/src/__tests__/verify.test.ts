import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';

import { b64uDecode, b64uEncode, encodeReceipt, signReceipt } from '../codec.js';
import { NonceStore } from '../nonce.js';
import { verifyPaymentReceipt, explainFailure, type VerifyPolicy } from '../verify.js';
import type { ReceiptBody, VerifyFailure } from '../types.js';

/**
 * The verifier is the security boundary, and the ESP32 will reimplement it in C
 * against this behaviour. So every rejection branch gets a test, and so does the
 * rule that a failed check must not consume the nonce.
 */

const PAY_TO = 'FHcgXc3YvendorWalletAddressForTests1111111';
const PRICE = '50000'; // $0.05

const facilitator = nacl.sign.keyPair();
const impostor = nacl.sign.keyPair();

interface Harness {
  policy: VerifyPolicy;
  nonces: NonceStore;
  nonce: string;
  now: () => number;
  setNow: (t: number) => void;
}

function harness(overrides: Partial<VerifyPolicy> = {}): Harness {
  let t = 1_800_000_000;
  const now = (): number => t;
  const nonces = new NonceStore({ ttlSeconds: 300, now });
  const { nonce } = nonces.issue();

  return {
    nonces,
    nonce,
    now,
    setNow: (next: number) => {
      t = next;
    },
    policy: {
      facilitatorPubkey: facilitator.publicKey,
      payTo: PAY_TO,
      priceMicroUsdc: PRICE,
      network: 'solana-devnet',
      nonces,
      now,
      ...overrides,
    },
  };
}

function receipt(h: Harness, over: Partial<ReceiptBody> = {}): string {
  const issuedAt = h.now();
  const body: ReceiptBody = {
    v: 1,
    nonce: h.nonce,
    payTo: PAY_TO,
    amount: PRICE,
    signature: 'TxSigForTests',
    network: 'solana-devnet',
    issuedAt,
    expiresAt: issuedAt + 300,
    ...over,
  };
  return encodeReceipt(signReceipt(body, facilitator.secretKey));
}

function expectFail(header: string | null | undefined, h: Harness, reason: VerifyFailure): void {
  const v = verifyPaymentReceipt(header, h.policy);
  assert.equal(v.ok, false);
  assert.equal(v.reason, reason);
  // Every failure reason must have a human explanation; no silent enum leaks.
  assert.ok(explainFailure(reason).length > 0);
}

test('a well-formed receipt is accepted and burns its nonce', () => {
  const h = harness();
  const v = verifyPaymentReceipt(receipt(h), h.policy);
  assert.equal(v.ok, true);
  assert.equal(v.receipt?.nonce, h.nonce);
  assert.equal(h.nonces.check(h.nonce), 'replayed', 'the nonce must be spent');
});

test('overpaying is accepted', () => {
  const h = harness();
  const v = verifyPaymentReceipt(receipt(h, { amount: '99999999' }), h.policy);
  assert.equal(v.ok, true);
});

test('missing and malformed headers are distinguished', () => {
  const h = harness();
  expectFail(null, h, 'missing_header');
  expectFail(undefined, h, 'missing_header');
  expectFail('   ', h, 'missing_header');
  expectFail('not-a-receipt', h, 'malformed_header'); // no separator at all
  expectFail('.', h, 'malformed_header'); // empty body
  expectFail('eyJhIjoxfQ.', h, 'malformed_header'); // empty signature
  // `body.sig` with junk in both halves is structurally fine, so it gets as far
  // as the signature check and fails there. That ordering is deliberate.
  expectFail('only.two', h, 'bad_signature');
});

test('a receipt signed by the wrong key is rejected', () => {
  const h = harness();
  const forged = encodeReceipt(
    signReceipt(
      {
        v: 1,
        nonce: h.nonce,
        payTo: PAY_TO,
        amount: PRICE,
        signature: 'TxSigForTests',
        network: 'solana-devnet',
        issuedAt: h.now(),
        expiresAt: h.now() + 300,
      },
      impostor.secretKey,
    ),
  );
  expectFail(forged, h, 'bad_signature');
});

test('flipping a bit in the signature is rejected', () => {
  const h = harness();
  const [body, sig] = receipt(h).split('.') as [string, string];
  const bytes = b64uDecode(sig);
  bytes[0] = (bytes[0] ?? 0) ^ 0xff;
  expectFail(`${body}.${b64uEncode(bytes)}`, h, 'bad_signature');
});

test('editing the body after signing is rejected', () => {
  const h = harness();
  const [, sig] = receipt(h).split('.') as [string, string];
  // A buyer trying to pay less than they claimed.
  const tampered: ReceiptBody = {
    v: 1,
    nonce: h.nonce,
    payTo: PAY_TO,
    amount: '1',
    signature: 'TxSigForTests',
    network: 'solana-devnet',
    issuedAt: h.now(),
    expiresAt: h.now() + 300,
  };
  const body = b64uEncode(new TextEncoder().encode(JSON.stringify(tampered)));
  expectFail(`${body}.${sig}`, h, 'bad_signature');
});

test('a nonce this device never issued is rejected', () => {
  const h = harness();
  expectFail(receipt(h, { nonce: 'a'.repeat(32) }), h, 'nonce_unknown');
});

test('a nonce cannot be spent twice', () => {
  const h = harness();
  const r = receipt(h);
  assert.equal(verifyPaymentReceipt(r, h.policy).ok, true);
  expectFail(r, h, 'nonce_replayed');
});

test('an expired nonce is rejected', () => {
  const h = harness();
  const r = receipt(h);
  h.setNow(h.now() + 600); // past the 300s nonce TTL
  expectFail(r, h, 'nonce_expired');
});

test('payment to the wrong wallet is rejected', () => {
  const h = harness();
  expectFail(receipt(h, { payTo: 'SomeoneElsesWallet22222222222222222222222' }), h, 'wrong_recipient');
});

test('payment on the wrong network is rejected', () => {
  const h = harness();
  expectFail(receipt(h, { network: 'solana' }), h, 'wrong_network');
});

test('underpaying is rejected', () => {
  const h = harness();
  expectFail(receipt(h, { amount: '49999' }), h, 'insufficient_amount');
});

test('a non-numeric amount is malformed, not insufficient', () => {
  const h = harness();
  expectFail(receipt(h, { amount: 'fifty thousand' }), h, 'malformed_header');
});

test('a receipt past its own expiry is rejected', () => {
  // Expire the RECEIPT while leaving the nonce fresh, so this isolates receipt
  // expiry from nonce expiry — the nonce is checked first, and would otherwise
  // mask this branch entirely.
  const h = harness({ clockSkewSeconds: 0 });
  expectFail(receipt(h, { expiresAt: h.now() - 1 }), h, 'receipt_expired');
});

test('the skew window tolerates a device clock running slightly fast', () => {
  const h = harness(); // default skew is 120s
  const v = verifyPaymentReceipt(receipt(h, { expiresAt: h.now() - 60 }), h.policy);
  assert.equal(v.ok, true, 'a 60s disagreement must not cost a paying customer their data');
});

test('a failed check does NOT burn the nonce', () => {
  // The important one. If a rejection consumed the nonce, anyone who could see a
  // challenge could destroy a paying customer's ticket by sending junk.
  const cases: (() => void)[] = [];

  for (const [label, make] of [
    ['wrong recipient', (h: Harness) => receipt(h, { payTo: 'Other111111111111111111111111111111111111' })],
    ['wrong network', (h: Harness) => receipt(h, { network: 'solana' as const })],
    ['underpaid', (h: Harness) => receipt(h, { amount: '1' })],
    ['bad signature', (h: Harness) => {
      const [body, sig] = receipt(h).split('.') as [string, string];
      const bytes = b64uDecode(sig);
      bytes[1] = (bytes[1] ?? 0) ^ 0xff;
      return `${body}.${b64uEncode(bytes)}`;
    }],
  ] as [string, (h: Harness) => string][]) {
    cases.push(() => {
      const h = harness();
      const bad = make(h);
      assert.equal(verifyPaymentReceipt(bad, h.policy).ok, false, label);
      assert.equal(h.nonces.check(h.nonce), 'valid', `${label} must leave the nonce spendable`);
      // And the honest receipt still works afterwards.
      assert.equal(verifyPaymentReceipt(receipt(h), h.policy).ok, true, label);
    });
  }

  for (const c of cases) c();
});
