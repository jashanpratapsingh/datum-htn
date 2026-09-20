#pragma once
/**
 * Build-time configuration for the VENDX vending node.
 *
 * Nothing secret belongs in this file — it is committed. The facilitator
 * public key is public by definition (that is the point: the device holds only
 * a verifying key, never a signing key).
 *
 * Facilitator key: run `node scripts/gen-facilitator-key.mjs` from the repo
 * root. It reads keys/facilitator.json (the relay's keypair, git-ignored) and
 * writes firmware-vendor/src/facilitator_key.h (also git-ignored), which is
 * picked up below. Without it the placeholder zero key is compiled in and the
 * device rejects every receipt — the correct failure direction.
 *
 * WiFi: credentials are NOT compiled in. They are provisioned at runtime over
 * the USB serial console (`wifi <ssid> [pass]`) and persisted in NVS. If no
 * station connection is up after VENDX_AP_FALLBACK_SEC the node also opens its
 * own access point (`vendx-<mac4>` / VENDX_AP_PASS) so it is always reachable.
 * Compile-time defaults can still be set via the PLATFORMIO_BUILD_FLAGS env var:
 *
 *   PLATFORMIO_BUILD_FLAGS='-DVENDX_WIFI_SSID=\"my-ssid\" -DVENDX_WIFI_PASS=\"my-pass\"' \
 *     pio run -e esp32c3
 */

#if __has_include("facilitator_key.h")
#include "facilitator_key.h"
#endif

/** Default station credentials; NVS values set over serial take precedence. */
#ifndef VENDX_WIFI_SSID
#define VENDX_WIFI_SSID ""
#endif
#ifndef VENDX_WIFI_PASS
#define VENDX_WIFI_PASS ""
#endif

/** Fallback access point. Password must be >= 8 chars for WPA2. */
#ifndef VENDX_AP_PASS
#define VENDX_AP_PASS "vendx-setup"
#endif
/** Seconds without a station link before the AP comes up. 0 disables the AP. */
#ifndef VENDX_AP_FALLBACK_SEC
#define VENDX_AP_FALLBACK_SEC 20
#endif

#ifndef VENDX_DEVICE_ID
#define VENDX_DEVICE_ID "vendx-esp32c3-001"
#endif

#ifndef VENDX_NETWORK
#define VENDX_NETWORK "solana-devnet"
#endif

/** Circle's devnet USDC mint — verified on-chain. See docs/PROTOCOL.md. */
#ifndef VENDX_USDC_MINT
#define VENDX_USDC_MINT "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
#endif

/** Vendor wallet OWNER (not the associated token account). */
#ifndef VENDX_PAY_TO
#define VENDX_PAY_TO "FHcgXc3YzNnq8WKcH8GaDvbKhJ4ycKxHnR7jzA8zAHU"
#endif

/** Price per read, in micro-USDC. Overridable from platformio.ini. */
#ifndef VENDX_PRICE_MICRO_USDC
#define VENDX_PRICE_MICRO_USDC 10000ULL
#endif

/** How long a minted challenge nonce stays spendable. */
#ifndef VENDX_NONCE_TTL_SEC
#define VENDX_NONCE_TTL_SEC 300
#endif

/**
 * Foot-traffic bucket width.
 *
 * Deliberately shorter than the ~15 minute MAC-rotation interval of modern
 * phones: counting unique advertisers over a longer window over-reports badly.
 * See docs/BADGE.md.
 */
#ifndef VENDX_BUCKET_SEC
#define VENDX_BUCKET_SEC 300
#endif

/**
 * Facilitator Ed25519 public key, 32 raw bytes.
 *
 * Normally provided by the generated facilitator_key.h (see above). The
 * placeholder below verifies nothing real — a device flashed with it will
 * reject every receipt, which is the correct failure direction.
 */
#ifndef VENDX_FACILITATOR_PUBKEY_INIT
#define VENDX_FACILITATOR_PUBKEY_INIT                                       \
  { 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,                          \
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,                          \
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,                          \
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00 }
#endif

static const uint8_t VENDX_FACILITATOR_PUBKEY[32] = VENDX_FACILITATOR_PUBKEY_INIT;
