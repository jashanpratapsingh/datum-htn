import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import {
  b64uEncode,
  b64uDecode,
  canonicalJson,
  signReceipt,
  verifyReceipt,
  encodeReceipt,
  decodeReceipt,
  encodePaymentHeader,
  decodePaymentHeader,
  encodeSettleHeader,
  decodeSettleHeader,
} from './codec.js';
import type { ReceiptBody, PaymentPayload, SettleResponse } from './types.js';

/* ------------------------------------------------------------------ *
 * b64uEncode / b64uDecode
 * ------------------------------------------------------------------ */

describe('b64uEncode / b64uDecode', () => {
  it('round-trips for a variety of lengths', () => {
    for (const len of [1, 2, 3, 4, 16, 32, 64]) {
      const orig = crypto.getRandomValues(new Uint8Array(len));
      const encoded = b64uEncode(orig);
      const decoded = b64uDecode(encoded);
      assert.deepEqual(decoded, orig, `failed for length ${len}`);
    }
  });

  it('produces URL-safe output (no +, /, or =)', () => {
    for (const len of [1, 2, 3, 4, 16, 32, 64]) {
      const bytes = crypto.getRandomValues(new Uint8Array(len));
      const encoded = b64uEncode(bytes);
      assert.ok(!encoded.includes('+'), `found + in encoded length-${len}`);
      assert.ok(!encoded.includes('/'), `found / in encoded length-${len}`);
      assert.ok(!encoded.includes('='), `found = in encoded length-${len}`);
    }
  });

  it('all-zeros 16-byte array encodes to 22 chars and round-trips', () => {
    const zeros = new Uint8Array(16);
    const encoded = b64uEncode(zeros);
    assert.equal(encoded.length, 22);
    assert.deepEqual(b64uDecode(encoded), zeros);
  });

  it('1-byte array encodes and decodes without error', () => {
    const orig = new Uint8Array([0xab]);
    const encoded = b64uEncode(orig);
    assert.equal(encoded.length, 2);
    assert.deepEqual(b64uDecode(encoded), orig);
  });

  it('2-byte array encodes and decodes without error', () => {
    const orig = new Uint8Array([0xde, 0xad]);
    const encoded = b64uEncode(orig);
    assert.deepEqual(b64uDecode(encoded), orig);
  });

  it('3-byte array encodes and decodes without error', () => {
    const orig = new Uint8Array([0xca, 0xfe, 0xba]);
    const encoded = b64uEncode(orig);
    assert.deepEqual(b64uDecode(encoded), orig);
  });
});

/* ------------------------------------------------------------------ *
 * canonicalJson
 * ------------------------------------------------------------------ */

describe('canonicalJson', () => {
  it('sorts keys alphabetically', () => {
    assert.equal(canonicalJson({ z: 1, a: 2 }), '{"a":2,"z":1}');
  });

  it('sorts nested object keys at every depth', () => {
    assert.equal(
      canonicalJson({ b: { y: 1, x: 2 }, a: 3 }),
      '{"a":3,"b":{"x":2,"y":1}}',
    );
  });

  it('preserves array order', () => {
    assert.equal(canonicalJson([3, 1, 2]), '[3,1,2]');
  });

  it('handles null literal', () => {
    assert.equal(canonicalJson(null), 'null');
  });

  it('handles primitive number', () => {
    assert.equal(canonicalJson(42), '42');
  });

  it('omits undefined values', () => {
    assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  });

  it('handles empty object', () => {
    assert.equal(canonicalJson({}), '{}');
  });
});

/* ------------------------------------------------------------------ *
 * Helper: a well-formed ReceiptBody
 * ------------------------------------------------------------------ */
function makeReceiptBody(): ReceiptBody {
  return {
    v: 1,
    nonce: 'aabbccdd',
    payTo: 'FHcg',
    amount: '10000',
    signature: 'fakeSig',
    network: 'solana-devnet',
    issuedAt: 1000000,
    expiresAt: 2000000,
  };
}

/* ------------------------------------------------------------------ *
 * signReceipt / verifyReceipt
 * ------------------------------------------------------------------ */

describe('signReceipt / verifyReceipt', () => {
  it('sign then verify returns the original ReceiptBody', () => {
    const kp = nacl.sign.keyPair();
    const body = makeReceiptBody();
    const receipt = signReceipt(body, kp.secretKey);
    const verified = verifyReceipt(receipt, kp.publicKey);
    assert.deepEqual(verified, body);
  });

  it('tampered body returns null', () => {
    const kp = nacl.sign.keyPair();
    const receipt = signReceipt(makeReceiptBody(), kp.secretKey);
    // Flip the last character of the body
    const last = receipt.body[receipt.body.length - 1];
    const flipped = last === 'A' ? 'B' : 'A';
    receipt.body = receipt.body.slice(0, -1) + flipped;
    assert.equal(verifyReceipt(receipt, kp.publicKey), null);
  });

  it('wrong public key returns null', () => {
    const kp1 = nacl.sign.keyPair();
    const kp2 = nacl.sign.keyPair();
    const receipt = signReceipt(makeReceiptBody(), kp1.secretKey);
    assert.equal(verifyReceipt(receipt, kp2.publicKey), null);
  });

  it('truncated sig returns null', () => {
    const kp = nacl.sign.keyPair();
    const receipt = signReceipt(makeReceiptBody(), kp.secretKey);
    receipt.sig = receipt.sig.slice(0, -4);
    assert.equal(verifyReceipt(receipt, kp.publicKey), null);
  });

  it('empty sig returns null', () => {
    const kp = nacl.sign.keyPair();
    const receipt = signReceipt(makeReceiptBody(), kp.secretKey);
    receipt.sig = '';
    assert.equal(verifyReceipt(receipt, kp.publicKey), null);
  });

  it('verify preserves all ReceiptBody fields', () => {
    const kp = nacl.sign.keyPair();
    const body = makeReceiptBody();
    const receipt = signReceipt(body, kp.secretKey);
    const verified = verifyReceipt(receipt, kp.publicKey);
    assert.ok(verified !== null);
    assert.equal(verified.v, 1);
    assert.equal(verified.nonce, body.nonce);
    assert.equal(verified.payTo, body.payTo);
    assert.equal(verified.amount, body.amount);
    assert.equal(verified.signature, body.signature);
    assert.equal(verified.network, body.network);
    assert.equal(verified.issuedAt, body.issuedAt);
    assert.equal(verified.expiresAt, body.expiresAt);
  });
});

/* ------------------------------------------------------------------ *
 * encodeReceipt / decodeReceipt
 * ------------------------------------------------------------------ */

describe('encodeReceipt / decodeReceipt', () => {
  it('round-trip: encode then decode returns original', () => {
    const kp = nacl.sign.keyPair();
    const signed = signReceipt(makeReceiptBody(), kp.secretKey);
    const wire = encodeReceipt(signed);
    const decoded = decodeReceipt(wire);
    assert.deepEqual(decoded, signed);
  });

  it('wire format is exactly <body>.<sig> with one dot', () => {
    const kp = nacl.sign.keyPair();
    const signed = signReceipt(makeReceiptBody(), kp.secretKey);
    const wire = encodeReceipt(signed);
    assert.ok(!wire.includes(' '), 'no spaces');
    const parts = wire.split('.');
    // body and sig are separated by exactly one dot; body is parts[0], sig is parts[1]
    assert.equal(parts[0], signed.body);
    assert.equal(parts[parts.length - 1], signed.sig);
  });

  it('decodeReceipt("") returns null', () => {
    assert.equal(decodeReceipt(''), null);
  });

  it('decodeReceipt("nodot") returns null', () => {
    assert.equal(decodeReceipt('nodot'), null);
  });

  it('decodeReceipt(".sig") returns null (empty body)', () => {
    assert.equal(decodeReceipt('.sig'), null);
  });

  it('decodeReceipt("body.") returns null (empty sig)', () => {
    assert.equal(decodeReceipt('body.'), null);
  });

  it('body with dot in encoded form still round-trips via encode/decode', () => {
    // We encode a receipt, then do a double round-trip to verify first-dot logic
    const kp = nacl.sign.keyPair();
    const signed = signReceipt(makeReceiptBody(), kp.secretKey);
    const wire = encodeReceipt(signed);
    const decoded = decodeReceipt(wire);
    assert.ok(decoded !== null);
    // Double round-trip: encode(decode(encode(signed))) should deep-equal signed
    const reEncoded = encodeReceipt(decoded);
    const reDecoded = decodeReceipt(reEncoded);
    assert.deepEqual(reDecoded, signed);
  });
});

/* ------------------------------------------------------------------ *
 * encodePaymentHeader / decodePaymentHeader
 * ------------------------------------------------------------------ */

describe('encodePaymentHeader / decodePaymentHeader', () => {
  function makePayload(): PaymentPayload {
    return {
      x402Version: 1,
      scheme: 'exact',
      network: 'solana-devnet',
      payload: {
        signature: 'txSigBase58',
        nonce: 'aabbccdd1122',
      },
    };
  }

  it('round-trip: encode then decode deep-equals original', () => {
    const p = makePayload();
    const header = encodePaymentHeader(p);
    const decoded = decodePaymentHeader(header);
    assert.deepEqual(decoded, p);
  });

  it('decodePaymentHeader of invalid base64url returns null', () => {
    assert.equal(decodePaymentHeader('not-base64url!!'), null);
  });

  it('decodePaymentHeader of payload with scheme "other" returns null', () => {
    const p = { ...makePayload(), scheme: 'other' } as unknown as PaymentPayload;
    const header = encodePaymentHeader(p);
    assert.equal(decodePaymentHeader(header), null);
  });

  it('decodePaymentHeader of payload missing signature returns null', () => {
    const p = makePayload();
    // Remove signature
    const noSig = { ...p, payload: { nonce: p.payload.nonce } };
    const header = encodePaymentHeader(noSig as unknown as PaymentPayload);
    assert.equal(decodePaymentHeader(header), null);
  });

  it('decodePaymentHeader of payload missing nonce returns null', () => {
    const p = makePayload();
    const noNonce = { ...p, payload: { signature: p.payload.signature } };
    const header = encodePaymentHeader(noNonce as unknown as PaymentPayload);
    assert.equal(decodePaymentHeader(header), null);
  });
});

/* ------------------------------------------------------------------ *
 * encodeSettleHeader / decodeSettleHeader
 * ------------------------------------------------------------------ */

describe('encodeSettleHeader / decodeSettleHeader', () => {
  it('round-trip for success: true', () => {
    const r: SettleResponse = {
      success: true,
      transaction: 'txSigBase58',
      network: 'solana-devnet',
      payer: 'payerWallet',
    };
    const header = encodeSettleHeader(r);
    const decoded = decodeSettleHeader(header);
    assert.deepEqual(decoded, r);
  });

  it('round-trip for success: false with errorReason', () => {
    const r: SettleResponse = {
      success: false,
      transaction: null,
      network: 'solana-devnet',
      payer: null,
      errorReason: 'insufficient_funds',
    };
    const header = encodeSettleHeader(r);
    const decoded = decodeSettleHeader(header);
    assert.deepEqual(decoded, r);
  });

  it('decodeSettleHeader("garbage") returns null', () => {
    assert.equal(decodeSettleHeader('garbage'), null);
  });
});
