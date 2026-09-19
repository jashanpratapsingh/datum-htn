#pragma once
/**
 * Build-time configuration for the VENDX vending node.
 *
 * Nothing secret belongs in this file — it is committed. The facilitator
 * public key is public by definition (that is the point: the device holds only
 * a verifying key, never a signing key). WiFi credentials come from build
 * flags so they stay out of git:
 *
 *   pio run -e esp32c3 \
 *     --build-flag '-DVENDX_WIFI_SSID="\"my-ssid\""' \
 *     --build-flag '-DVENDX_WIFI_PASS="\"my-pass\""'
 */

#ifndef VENDX_WIFI_SSID
#define VENDX_WIFI_SSID "vendx-setup"
#endif
#ifndef VENDX_WIFI_PASS
#define VENDX_WIFI_PASS ""
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
 * Replace with your relay's key: `node relay-proxy/dist/keys.js --print-c`.
 * The placeholder below verifies nothing real — a device flashed with it will
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
