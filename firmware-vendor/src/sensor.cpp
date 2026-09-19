#include "sensor.h"
#include "config.h"

#include <Arduino.h>
#include <NimBLEDevice.h>

#include <algorithm>
#include <vector>

namespace vendx {
namespace {

// Scan duty cycle. WiFi and BLE share one radio on the C3, and there is no
// second core to hide the scan on, so we sample in short bursts and leave the
// radio to the HTTP server in between. window < interval is the rule; going
// continuous is a documented way to break the server.
constexpr uint32_t kScanBurstMs = 120;
constexpr uint32_t kScanPeriodMs = 900;
constexpr uint16_t kScanIntervalUnits = 160;  // 100ms, in 0.625ms units
constexpr uint16_t kScanWindowUnits = 64;     // 40ms

NimBLEScan* g_scan = nullptr;
uint32_t g_lastScan = 0;
uint32_t g_bucketStart = 0;

// Unique advertisers this bucket. Stored as 6-byte MACs packed into a u64 so
// the set stays cheap — this part has ~28KB of heap free with BLE up.
std::vector<uint64_t> g_seen;
std::vector<int8_t> g_rssi;

uint64_t packMac(const uint8_t* m) {
  uint64_t v = 0;
  for (int i = 0; i < 6; i++) v = (v << 8) | m[i];
  return v;
}

void rollBucketIfDue() {
  const uint32_t nowSec = millis() / 1000;
  if (g_bucketStart == 0) g_bucketStart = nowSec;
  if (nowSec - g_bucketStart >= (uint32_t)VENDX_BUCKET_SEC) {
    g_seen.clear();
    g_seen.shrink_to_fit();
    g_rssi.clear();
    g_rssi.shrink_to_fit();
    g_bucketStart = nowSec;
  }
}

void note(const uint8_t* mac, int rssi) {
  const uint64_t key = packMac(mac);
  if (std::find(g_seen.begin(), g_seen.end(), key) != g_seen.end()) return;
  // Cap the set so a busy room cannot exhaust the heap.
  if (g_seen.size() >= 512) return;
  g_seen.push_back(key);
  g_rssi.push_back((int8_t)rssi);
}

}  // namespace

void sensorBegin() {
  NimBLEDevice::init("");
  g_scan = NimBLEDevice::getScan();
  // Passive: we only count advertisers, we never solicit scan responses.
  g_scan->setActiveScan(false);
  g_scan->setInterval(kScanIntervalUnits);
  g_scan->setWindow(kScanWindowUnits);
  g_bucketStart = millis() / 1000;
  Serial.println("[vendx] ble passive scan up");
}

void sensorTick() {
  rollBucketIfDue();
  if (!g_scan) return;
  const uint32_t now = millis();
  if (now - g_lastScan < kScanPeriodMs) return;
  g_lastScan = now;

  // Blocking burst rather than callbacks: the polling API is stable across
  // NimBLE versions, and 120ms is short enough not to stall the async server.
  NimBLEScanResults results = g_scan->getResults(kScanBurstMs, false);
  for (int i = 0; i < results.getCount(); i++) {
    const NimBLEAdvertisedDevice* d = results.getDevice(i);
    if (!d) continue;
    note(d->getAddress().getBase()->val, d->getRSSI());
  }
  g_scan->clearResults();
}

uint32_t sensorCurrentBucket() { return (uint32_t)g_seen.size(); }

uint32_t sensorBucketStart() { return g_bucketStart; }

int sensorMedianRssi() {
  if (g_rssi.empty()) return 0;
  std::vector<int8_t> v = g_rssi;
  std::sort(v.begin(), v.end());
  return (int)v[v.size() / 2];
}

}  // namespace vendx
