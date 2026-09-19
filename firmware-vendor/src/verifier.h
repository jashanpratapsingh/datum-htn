#pragma once
#include <Arduino.h>
#include <stdint.h>

// Wire format mirrors packages/vendx-protocol/src/{types,codec}.ts.
// If you change a field name here, change it there too. See docs/PROTOCOL.md.

namespace vendx {

enum class VerifyFailure : uint8_t {
  None = 0,
  MissingHeader,
  MalformedHeader,
  BadSignature,
  NonceUnknown,
  NonceReplayed,
  NonceExpired,
  WrongRecipient,
  InsufficientAmount,
  WrongNetwork,
  ReceiptExpired,
};

const char* failureName(VerifyFailure f);

struct Receipt {
  char nonce[33];
  char payTo[45];
  uint64_t amount;
  char signature[90];
  char network[16];
  uint32_t issuedAt;
  uint32_t expiresAt;
};

/** Decode base64url into `out`. Returns bytes written, or -1 on bad input. */
int b64uDecode(const char* in, size_t inLen, uint8_t* out, size_t outCap);

/**
 * Issue a fresh single-use nonce into `out` (33 bytes: 32 hex + NUL).
 * Backed by esp_random(), which is a true HRNG once WiFi/BT is running.
 */
void issueNonce(char* out, uint32_t ttlSeconds);

/**
 * Verify a receipt of the form "<base64url body>.<base64url sig>".
 *
 * Checks, in order: structural parse, Ed25519 signature over the TRANSMITTED
 * body bytes, then nonce known/unused/unexpired, recipient, amount, network
 * and receipt expiry. Signature first, so an attacker cannot probe which
 * nonces are live without a valid facilitator signature.
 *
 * Purely local: no TLS, no RPC, no heap spike. ~30-60ms on a 240MHz Xtensa.
 */
VerifyFailure verifyReceipt(const char* header, Receipt& out);

/** Burn a nonce after a successful dispense, so it cannot be reused. */
void consumeNonce(const char* nonce);

void verifierBegin(const uint8_t facilitatorPubkey[32], const char* selfPayTo,
                   uint64_t priceMicroUsdc, const char* network);

}  // namespace vendx
