#pragma once
#include <stdint.h>

namespace vendx {

/** Bring up passive BLE scanning. Safe to call once from setup(). */
void sensorBegin();

/**
 * Advance the scan. Call from loop().
 *
 * Duty-cycled on purpose: the ESP32-C3 is single core with one 2.4GHz radio
 * shared between WiFi and BLE, so a continuous scan starves the HTTP server.
 */
void sensorTick();

/** Unique BLE advertisers seen in the current bucket. */
uint32_t sensorCurrentBucket();

/** Unix-ish seconds marking the start of the current bucket. */
uint32_t sensorBucketStart();

/** Median RSSI across the current bucket, or 0 if nothing was seen. */
int sensorMedianRssi();

}  // namespace vendx
