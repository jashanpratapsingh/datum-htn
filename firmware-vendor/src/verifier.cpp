#include "verifier.h"
#include <ArduinoJson.h>
#include <string.h>

#if defined(ARDUINO_ARCH_ESP32)
#include <esp_random.h>
#endif

// Ed25519.
//
// IMPORTANT: mbedTLS does NOT implement Ed25519/EdDSA. It has been on their
// roadmap since 2019 and repeatedly slipped; do not reach for mbedtls_* here.
// We vendor TweetNaCl (public domain, ~1400 lines) in lib/tweetnacl/.
extern "C" {
#include "tweetnacl.h"
}

namespace vendx {
namespace {

constexpr size_t kNonceRing = 64;     // ~2KB of RAM, plenty for a vending node
constexpr uint32_t kMaxSkewSec = 120; // tolerated clock skew vs facilitator

struct NonceSlot {
  char nonce[33];
  uint32_t expiresAt;
  bool used;
};

NonceSlot g_ring[kNonceRing];
size_t g_ringHead = 0;

uint8_t g_pubkey[32];
char g_selfPayTo[45];
char g_network[16];
uint64_t g_price = 0;

uint32_t nowSec() { return (uint32_t)(millis() / 1000UL) + 1758240000UL; }

int b64uVal(char c) {
  if (c >= 'A' && c <= 'Z') return c - 'A';
  if (c >= 'a' && c <= 'z') return c - 'a' + 26;
  if (c >= '0' && c <= '9') return c - '0' + 52;
  if (c == '-') return 62;
  if (c == '_') return 63;
  return -1;
}

}  // namespace

const char* failureName(VerifyFailure f) {
  switch (f) {
    case VerifyFailure::None:               return "ok";
    case VerifyFailure::MissingHeader:      return "missing_header";
    case VerifyFailure::MalformedHeader:    return "malformed_header";
    case VerifyFailure::BadSignature:       return "bad_signature";
    case VerifyFailure::NonceUnknown:       return "nonce_unknown";
    case VerifyFailure::NonceReplayed:      return "nonce_replayed";
    case VerifyFailure::NonceExpired:       return "nonce_expired";
    case VerifyFailure::WrongRecipient:     return "wrong_recipient";
    case VerifyFailure::InsufficientAmount: return "insufficient_amount";
    case VerifyFailure::WrongNetwork:       return "wrong_network";
    case VerifyFailure::ReceiptExpired:     return "receipt_expired";
  }
  return "unknown";
}

int b64uDecode(const char* in, size_t inLen, uint8_t* out, size_t outCap) {
  uint32_t acc = 0;
  int bits = 0;
  size_t n = 0;
  for (size_t i = 0; i < inLen; i++) {
    int v = b64uVal(in[i]);
    if (v < 0) return -1;
    acc = (acc << 6) | (uint32_t)v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      if (n >= outCap) return -1;
      out[n++] = (uint8_t)((acc >> bits) & 0xFF);
    }
  }
  return (int)n;
}

void verifierBegin(const uint8_t facilitatorPubkey[32], const char* selfPayTo,
                   uint64_t priceMicroUsdc, const char* network) {
  memcpy(g_pubkey, facilitatorPubkey, 32);
  strncpy(g_selfPayTo, selfPayTo, sizeof(g_selfPayTo) - 1);
  g_selfPayTo[sizeof(g_selfPayTo) - 1] = '\0';
  strncpy(g_network, network, sizeof(g_network) - 1);
  g_network[sizeof(g_network) - 1] = '\0';
  g_price = priceMicroUsdc;
  memset(g_ring, 0, sizeof(g_ring));
}

void issueNonce(char* out, uint32_t ttlSeconds) {
  static const char* kHex = "0123456789abcdef";
  for (int i = 0; i < 32; i += 8) {
#if defined(ARDUINO_ARCH_ESP32)
    uint32_t r = esp_random();
#else
    uint32_t r = (uint32_t)random();
#endif
    for (int j = 0; j < 8; j++) out[i + j] = kHex[(r >> (4 * j)) & 0xF];
  }
  out[32] = '\0';

  NonceSlot& slot = g_ring[g_ringHead];
  g_ringHead = (g_ringHead + 1) % kNonceRing;
  memcpy(slot.nonce, out, 33);
  slot.expiresAt = nowSec() + ttlSeconds;
  slot.used = false;
}

namespace {
NonceSlot* findNonce(const char* nonce) {
  for (size_t i = 0; i < kNonceRing; i++) {
    if (g_ring[i].nonce[0] && strncmp(g_ring[i].nonce, nonce, 32) == 0) return &g_ring[i];
  }
  return nullptr;
}
}  // namespace

void consumeNonce(const char* nonce) {
  NonceSlot* s = findNonce(nonce);
  if (s) s->used = true;
}

VerifyFailure verifyReceipt(const char* header, Receipt& out) {
  if (!header || !*header) return VerifyFailure::MissingHeader;

  const char* dot = strchr(header, '.');
  if (!dot || dot == header || !dot[1]) return VerifyFailure::MalformedHeader;

  const size_t bodyLen = (size_t)(dot - header);
  const char* sigB64 = dot + 1;
  const size_t sigLen = strlen(sigB64);
  if (bodyLen > 512 || sigLen > 128) return VerifyFailure::MalformedHeader;

  uint8_t sig[64];
  if (b64uDecode(sigB64, sigLen, sig, sizeof(sig)) != 64) return VerifyFailure::MalformedHeader;

  // Verify the signature over the TRANSMITTED body bytes. We never
  // re-serialize the JSON, so we cannot disagree with the signer about key
  // order or whitespace. Signature is checked BEFORE any field is trusted.
  //
  // crypto_sign_open needs a combined sig||msg buffer and an equally sized
  // output buffer. 64 + 512 is comfortably within our stack budget.
  uint8_t sm[64 + 512];
  uint8_t m[64 + 512];
  memcpy(sm, sig, 64);
  memcpy(sm + 64, header, bodyLen);
  unsigned long long mlen = 0;
  if (crypto_sign_open(m, &mlen, sm, 64 + bodyLen, g_pubkey) != 0) {
    return VerifyFailure::BadSignature;
  }

  uint8_t json[512];
  int jsonLen = b64uDecode(header, bodyLen, json, sizeof(json) - 1);
  if (jsonLen <= 0) return VerifyFailure::MalformedHeader;
  json[jsonLen] = '\0';

  JsonDocument doc;
  if (deserializeJson(doc, (const char*)json, (size_t)jsonLen)) {
    return VerifyFailure::MalformedHeader;
  }

  const char* nonce = doc["nonce"] | "";
  const char* payTo = doc["payTo"] | "";
  const char* amountStr = doc["amount"] | "0";
  const char* network = doc["network"] | "";
  const char* signature = doc["signature"] | "";
  uint32_t expiresAt = doc["expiresAt"] | 0;

  if (!*nonce || !*payTo) return VerifyFailure::MalformedHeader;

  NonceSlot* slot = findNonce(nonce);
  if (!slot) return VerifyFailure::NonceUnknown;
  if (slot->used) return VerifyFailure::NonceReplayed;
  if (nowSec() > slot->expiresAt + kMaxSkewSec) return VerifyFailure::NonceExpired;

  if (strcmp(payTo, g_selfPayTo) != 0) return VerifyFailure::WrongRecipient;
  if (strcmp(network, g_network) != 0) return VerifyFailure::WrongNetwork;

  uint64_t amount = strtoull(amountStr, nullptr, 10);
  if (amount < g_price) return VerifyFailure::InsufficientAmount;

  if (expiresAt && nowSec() > expiresAt + kMaxSkewSec) return VerifyFailure::ReceiptExpired;

  memset(&out, 0, sizeof(out));
  strncpy(out.nonce, nonce, sizeof(out.nonce) - 1);
  strncpy(out.payTo, payTo, sizeof(out.payTo) - 1);
  strncpy(out.signature, signature, sizeof(out.signature) - 1);
  strncpy(out.network, network, sizeof(out.network) - 1);
  out.amount = amount;
  out.issuedAt = doc["issuedAt"] | 0;
  out.expiresAt = expiresAt;
  return VerifyFailure::None;
}

}  // namespace vendx
