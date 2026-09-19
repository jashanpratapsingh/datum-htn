/**
 * VENDX — ESP32 data vending machine.
 *
 * Sells BLE foot-traffic telemetry to AI agents over x402. See docs/PROTOCOL.md.
 *
 * Concurrency shape (this matters — see docs/ARCHITECTURE.md):
 *   core 0  NimBLE passive scan, duty-cycled so it never starves WiFi
 *   core 1  AsyncWebServer
 * Verification is deliberately local and cheap (~40ms Ed25519, no TLS, no RPC),
 * so it can run in the request path without pausing the scan or spiking heap.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include "verifier.h"
#include "sensor.h"
#include "config.h"

static AsyncWebServer server(80);

static void sendChallenge(AsyncWebServerRequest* req) {
  char nonce[33];
  vendx::issueNonce(nonce, VENDX_NONCE_TTL_SEC);

  JsonDocument doc;
  doc["x402Version"] = 1;
  doc["error"] = "Payment Required";
  JsonObject a = doc["accepts"].add<JsonObject>();
  a["scheme"] = "exact";
  a["network"] = VENDX_NETWORK;
  a["maxAmountRequired"] = String((unsigned long long)VENDX_PRICE_MICRO_USDC);
  a["resource"] = "/api/telemetry";
  a["description"] = "BLE foot-traffic index, 5-minute bucket";
  a["mimeType"] = "application/json";
  a["outputSchema"] = nullptr;
  a["payTo"] = VENDX_PAY_TO;
  a["maxTimeoutSeconds"] = VENDX_NONCE_TTL_SEC;
  a["asset"] = VENDX_USDC_MINT;
  a["extra"] = nullptr;
  doc["nonce"] = nonce;
  doc["expiresAt"] = (uint32_t)(millis() / 1000) + VENDX_NONCE_TTL_SEC;

  String body;
  serializeJson(doc, body);
  AsyncWebServerResponse* res = req->beginResponse(402, "application/json", body);
  res->addHeader("Cache-Control", "no-store");
  req->send(res);
}

static void sendTelemetry(AsyncWebServerRequest* req, const vendx::Receipt& r) {
  JsonDocument doc;
  doc["device"] = VENDX_DEVICE_ID;
  doc["network"] = VENDX_NETWORK;
  // Honest framing: BLE MAC randomisation (~15 min rotation on modern phones)
  // makes absolute unique-device counts unreliable, so we sell a bucketed
  // index, not a visitor count. See docs/ARCHITECTURE.md.
  doc["metric"] = "ble_advertisers_per_5min";
  doc["value"] = vendx::sensorCurrentBucket();
  doc["bucketStart"] = vendx::sensorBucketStart();
  doc["windowSec"] = VENDX_BUCKET_SEC;
  doc["rssiMedian"] = vendx::sensorMedianRssi();
  doc["paidBy"] = r.signature;

  String body;
  serializeJson(doc, body);
  AsyncWebServerResponse* res = req->beginResponse(200, "application/json", body);
  res->addHeader("Cache-Control", "no-store");
  req->send(res);
}

static void handleTelemetry(AsyncWebServerRequest* req) {
  if (!req->hasHeader("X-PAYMENT-RECEIPT")) { sendChallenge(req); return; }

  const String hdr = req->header("X-PAYMENT-RECEIPT");
  vendx::Receipt receipt;
  const vendx::VerifyFailure f = vendx::verifyReceipt(hdr.c_str(), receipt);

  if (f != vendx::VerifyFailure::None) {
    JsonDocument doc;
    doc["error"] = vendx::failureName(f);
    String body;
    serializeJson(doc, body);
    // A bad receipt gets a fresh challenge with a 402, not a 400 — the client's
    // correct next move is always "pay again", and this keeps the state machine
    // on the agent side trivial.
    AsyncWebServerResponse* res = req->beginResponse(402, "application/json", body);
    res->addHeader("X-Payment-Error", vendx::failureName(f));
    req->send(res);
    return;
  }

  vendx::consumeNonce(receipt.nonce);
  sendTelemetry(req, receipt);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  WiFi.mode(WIFI_STA);
  WiFi.begin(VENDX_WIFI_SSID, VENDX_WIFI_PASS);
  Serial.print("[vendx] wifi");
  for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) { delay(500); Serial.print("."); }
  Serial.printf("\n[vendx] ip=%s\n", WiFi.localIP().toString().c_str());

  vendx::verifierBegin(VENDX_FACILITATOR_PUBKEY, VENDX_PAY_TO,
                       VENDX_PRICE_MICRO_USDC, VENDX_NETWORK);
  vendx::sensorBegin();

  server.on("/api/telemetry", HTTP_GET, handleTelemetry);
  server.on("/health", HTTP_GET, [](AsyncWebServerRequest* r) {
    JsonDocument d;
    d["ok"] = true;
    d["device"] = VENDX_DEVICE_ID;
    d["heap"] = ESP.getFreeHeap();
    d["uptime"] = millis() / 1000;
    String b; serializeJson(d, b);
    r->send(200, "application/json", b);
  });
  server.begin();
  Serial.println("[vendx] vending on :80/api/telemetry");
}

void loop() {
  vendx::sensorTick();
  delay(50);
}
