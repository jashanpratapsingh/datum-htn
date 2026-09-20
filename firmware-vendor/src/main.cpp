/**
 * VENDX node — an ESP32 that sells its own sensor data over x402.
 *
 * The node mints 402 challenges, verifies relay-signed receipts offline and
 * serves BLE foot-traffic telemetry to AI agents. See docs/PROTOCOL.md.
 *
 * Concurrency shape (this matters — see docs/ARCHITECTURE.md):
 *   The target is an ESP32-C3: a SINGLE-core RISC-V part at 160MHz. There is
 *   no second core to hide the BLE scan on, so the scan and the server are
 *   time-sliced on one core and the scan must be duty-cycled (window <
 *   interval) or it starves the WiFi stack.
 * Verification is deliberately local and cheap (~40ms Ed25519, no TLS, no RPC),
 * so it can run in the request path without pausing the scan or spiking heap.
 *
 * Connectivity:
 *   - Station credentials live in NVS and are set over the USB serial console
 *     (`wifi <ssid> [pass]`, `scan`, `status`, `help`). Nothing is compiled in.
 *   - If no station link is up after VENDX_AP_FALLBACK_SEC the node opens its
 *     own WPA2 access point (`vendx-<mac4>`), so it is always reachable even on
 *     enterprise WiFi it cannot join. The HTTP server serves on both.
 *   - Once on a LAN it announces itself as <VENDX_DEVICE_ID>.local over mDNS.
 *
 * Registration:
 *   The relay (facilitator) has to know this node exists to settle payments
 *   for challenges the node minted itself. So on every station connect, and
 *   every VENDX_REGISTER_SEC after, the node POSTs its identity — device id,
 *   URL, payTo, price, network, heap — to <relay>/api/nodes/register. The
 *   relay URL is provisioned like WiFi (`relay <url>` over serial, kept in NVS)
 *   and is advertised to buyers in the challenge's `extra.facilitator`, so an
 *   agent that finds the node knows where to settle. Plain HTTP: the relay is
 *   on the same LAN, and the C3 has no heap for TLS with BLE up.
 */
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <Preferences.h>
#include <ESPAsyncWebServer.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include "verifier.h"
#include "sensor.h"
#include "config.h"

static AsyncWebServer server(80);
static Preferences prefs;

// ---------------------------------------------------------------- WiFi state
static String g_ssid;
static String g_pass;
static String g_apSsid;
static bool g_apUp = false;
static bool g_staAnnounced = false;
static bool g_mdnsUp = false;
static uint32_t g_staAttemptMs = 0;

// ---------------------------------------------------------------- relay registration state
static String g_relayUrl;
static bool g_registerDue = false;
static uint32_t g_lastRegisterMs = 0;
static int g_lastRegisterCode = 0;      // HTTP status, or a negative HTTPClient error
static uint32_t g_registerOk = 0;       // successful registrations since boot
static const char kFirmware[] = "vendx-node " __DATE__ " " __TIME__;

static void loadWifiCreds() {
  prefs.begin("vendx", /*readOnly=*/false);
  // isKey() first: getString() on a missing key logs an NVS error at boot.
  g_ssid = prefs.isKey("ssid") ? prefs.getString("ssid") : String(VENDX_WIFI_SSID);
  g_pass = prefs.isKey("pass") ? prefs.getString("pass") : String(VENDX_WIFI_PASS);
  g_relayUrl = prefs.isKey("relay") ? prefs.getString("relay") : String(VENDX_RELAY_URL);
  while (g_relayUrl.endsWith("/")) g_relayUrl.remove(g_relayUrl.length() - 1);
}

static void saveWifiCreds() {
  prefs.putString("ssid", g_ssid);
  prefs.putString("pass", g_pass);
}

static void staBegin() {
  g_staAnnounced = false;
  g_staAttemptMs = millis();
  if (g_ssid.isEmpty()) {
    Serial.println("[vendx] wifi: no station ssid configured (serial: wifi <ssid> [pass])");
    return;
  }
  WiFi.disconnect(false, false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(g_ssid.c_str(), g_pass.isEmpty() ? nullptr : g_pass.c_str());
  Serial.printf("[vendx] wifi: connecting to \"%s\"\n", g_ssid.c_str());
}

static void apBegin() {
  if (g_apUp || VENDX_AP_FALLBACK_SEC == 0) return;
  WiFi.mode(WIFI_AP_STA);
  const bool ok = WiFi.softAP(g_apSsid.c_str(), VENDX_AP_PASS);
  g_apUp = ok;
  Serial.printf("[vendx] ap: %s ssid=\"%s\" pass=\"%s\" ip=%s\n", ok ? "up" : "FAILED",
                g_apSsid.c_str(), VENDX_AP_PASS, WiFi.softAPIP().toString().c_str());
}

static void apEnd() {
  if (!g_apUp) return;
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  g_apUp = false;
  Serial.println("[vendx] ap: down");
}

static void printStatus() {
  const bool up = WiFi.status() == WL_CONNECTED;
  Serial.printf("[vendx] status sta=%s ssid=\"%s\" ip=%s rssi=%d ap=%s ap_ssid=\"%s\" ap_ip=%s ap_clients=%d "
                "heap=%u largest=%u uptime=%lus bucket=%lu\n",
                up ? "connected" : "down", up ? WiFi.SSID().c_str() : g_ssid.c_str(),
                up ? WiFi.localIP().toString().c_str() : "-", up ? WiFi.RSSI() : 0,
                g_apUp ? "up" : "down", g_apSsid.c_str(),
                g_apUp ? WiFi.softAPIP().toString().c_str() : "-",
                g_apUp ? (int)WiFi.softAPgetStationNum() : 0,
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(),
                (unsigned long)(millis() / 1000), (unsigned long)vendx::sensorCurrentBucket());
  Serial.printf("[vendx] node id=%s payTo=%s price=%llu relay=%s registered=%s last_code=%d ok_count=%lu ago=%lus\n",
                VENDX_DEVICE_ID, VENDX_PAY_TO, (unsigned long long)VENDX_PRICE_MICRO_USDC,
                g_relayUrl.isEmpty() ? "(none)" : g_relayUrl.c_str(),
                g_lastRegisterCode == 200 ? "yes" : "no", g_lastRegisterCode, (unsigned long)g_registerOk,
                g_lastRegisterMs ? (unsigned long)((millis() - g_lastRegisterMs) / 1000) : 0UL);
}

// The URL an agent on the same network can reach this node at.
static String selfUrl() {
  if (WiFi.status() == WL_CONNECTED) return "http://" + WiFi.localIP().toString();
  if (g_apUp) return "http://" + WiFi.softAPIP().toString();
  return String();
}

/**
 * Tell the relay who we are. Blocking (<= ~6 s worst case on a dead relay);
 * runs from loop(), so the async HTTP server keeps serving and the only cost
 * is a skipped BLE scan burst. Never runs in the request path.
 */
static void registerWithRelay(const char* why) {
  g_registerDue = false;
  g_lastRegisterMs = millis();
  if (g_relayUrl.isEmpty()) {
    Serial.println("[vendx] register: no relay url (serial: relay <url>)");
    return;
  }
  const String me = selfUrl();
  if (me.isEmpty()) return;

  JsonDocument doc;
  doc["deviceId"] = VENDX_DEVICE_ID;
  doc["source"] = "esp32c3";
  doc["chip"] = ESP.getChipModel();
  doc["url"] = me;
  doc["mdns"] = String(VENDX_DEVICE_ID) + ".local";
  doc["resource"] = "/api/telemetry";
  doc["payTo"] = VENDX_PAY_TO;
  doc["priceMicroUsdc"] = String((unsigned long long)VENDX_PRICE_MICRO_USDC);
  doc["network"] = VENDX_NETWORK;
  doc["asset"] = VENDX_USDC_MINT;
  doc["heartbeatSec"] = VENDX_REGISTER_SEC;
  doc["freeHeap"] = ESP.getFreeHeap();
  doc["largestBlock"] = ESP.getMaxAllocHeap();
  doc["uptime"] = millis() / 1000;
  doc["rssi"] = WiFi.status() == WL_CONNECTED ? WiFi.RSSI() : 0;
  doc["bucket"] = vendx::sensorCurrentBucket();
  doc["firmware"] = kFirmware;
  doc["sdk"] = ESP.getSdkVersion();
  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.setConnectTimeout(3000);
  http.setTimeout(3000);
  if (!http.begin(g_relayUrl + "/api/nodes/register")) {
    g_lastRegisterCode = -1;
    Serial.printf("[vendx] register(%s): bad relay url \"%s\"\n", why, g_relayUrl.c_str());
    return;
  }
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  String resp = code > 0 ? http.getString() : String(http.errorToString(code));
  http.end();
  g_lastRegisterCode = code;
  if (code == 200) g_registerOk++;
  resp.trim();
  if (resp.length() > 160) resp = resp.substring(0, 160) + "…";
  Serial.printf("[vendx] register(%s): %s -> %d %s\n", why, g_relayUrl.c_str(), code, resp.c_str());
}

static void doScan() {
  Serial.println("[vendx] scan: starting (blocking ~3s)");
  const int16_t n = WiFi.scanNetworks();
  if (n < 0) { Serial.printf("[vendx] scan: failed (%d)\n", n); return; }
  for (int i = 0; i < n; i++) {
    Serial.printf("  %-32s rssi=%d ch=%d %s\n", WiFi.SSID(i).c_str(), WiFi.RSSI(i), WiFi.channel(i),
                  WiFi.encryptionType(i) == WIFI_AUTH_OPEN ? "open" : "secured");
  }
  Serial.printf("[vendx] scan: %d networks\n", n);
  WiFi.scanDelete();
}

// Tokenize a console line; double quotes group an SSID that contains spaces.
static int tokenize(const String& s, String* out, int max) {
  int n = 0;
  unsigned i = 0;
  while (i < s.length() && n < max) {
    while (i < s.length() && s[i] == ' ') i++;
    if (i >= s.length()) break;
    String cur;
    if (s[i] == '"') {
      i++;
      while (i < s.length() && s[i] != '"') cur += s[i++];
      if (i < s.length()) i++;
    } else {
      while (i < s.length() && s[i] != ' ') cur += s[i++];
    }
    out[n++] = cur;
  }
  return n;
}

static void handleLine(String line) {
  line.trim();
  if (line.isEmpty()) return;
  String a[4];
  const int n = tokenize(line, a, 4);
  if (n == 0) return;

  if (a[0] == "help") {
    Serial.println("[vendx] commands:");
    Serial.println("  wifi <ssid> [pass]   save station credentials to NVS and connect (quote an ssid with spaces)");
    Serial.println("  wifi clear           forget station credentials");
    Serial.println("  ap on|off            force the fallback access point");
    Serial.println("  relay <url>          save the relay (facilitator) base url to NVS and register now");
    Serial.println("  relay clear          forget the relay url (stops registration)");
    Serial.println("  register             re-register with the relay now");
    Serial.println("  scan                 list nearby networks");
    Serial.println("  status               link, ip, heap, uptime, current bucket, relay registration");
    Serial.println("  reboot");
  } else if (a[0] == "status") {
    printStatus();
  } else if (a[0] == "scan") {
    doScan();
  } else if (a[0] == "wifi") {
    if (n >= 2 && a[1] == "clear") {
      prefs.remove("ssid");
      prefs.remove("pass");
      g_ssid = "";
      g_pass = "";
      WiFi.disconnect(false, true);
      Serial.println("[vendx] wifi: credentials cleared");
    } else if (n >= 2) {
      g_ssid = a[1];
      g_pass = n >= 3 ? a[2] : "";
      saveWifiCreds();
      Serial.printf("[vendx] wifi: saved ssid=\"%s\" pass_len=%u\n", g_ssid.c_str(), g_pass.length());
      staBegin();
    } else {
      Serial.println("usage: wifi <ssid> [pass] | wifi clear");
    }
  } else if (a[0] == "ap") {
    if (n >= 2 && a[1] == "on") apBegin();
    else if (n >= 2 && a[1] == "off") apEnd();
    else Serial.println("usage: ap on|off");
  } else if (a[0] == "relay") {
    if (n >= 2 && a[1] == "clear") {
      prefs.remove("relay");
      g_relayUrl = "";
      g_lastRegisterCode = 0;
      Serial.println("[vendx] relay: cleared");
    } else if (n >= 2 && a[1].startsWith("http://")) {
      g_relayUrl = a[1];
      while (g_relayUrl.endsWith("/")) g_relayUrl.remove(g_relayUrl.length() - 1);
      prefs.putString("relay", g_relayUrl);
      Serial.printf("[vendx] relay: saved %s\n", g_relayUrl.c_str());
      registerWithRelay("console");
    } else if (n >= 2) {
      Serial.println("[vendx] relay: url must start with http:// (no TLS on this part)");
    } else {
      Serial.printf("[vendx] relay: %s\n", g_relayUrl.isEmpty() ? "(none)" : g_relayUrl.c_str());
    }
  } else if (a[0] == "register") {
    registerWithRelay("console");
  } else if (a[0] == "reboot") {
    Serial.println("[vendx] rebooting");
    delay(100);
    ESP.restart();
  } else {
    Serial.printf("[vendx] unknown command \"%s\" (try: help)\n", a[0].c_str());
  }
}

static String g_line;
static void pollSerial() {
  while (Serial.available()) {
    const char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      handleLine(g_line);
      g_line = "";
    } else if (g_line.length() < 160) {
      g_line += c;
    }
  }
}

static void wifiTick() {
  const bool up = WiFi.status() == WL_CONNECTED;
  if (up && !g_staAnnounced) {
    g_staAnnounced = true;
    Serial.printf("[vendx] wifi: connected ssid=\"%s\" ip=%s rssi=%d\n", WiFi.SSID().c_str(),
                  WiFi.localIP().toString().c_str(), WiFi.RSSI());
    if (!g_mdnsUp && MDNS.begin(VENDX_DEVICE_ID)) {
      MDNS.addService("http", "tcp", 80);
      g_mdnsUp = true;
      Serial.printf("[vendx] mdns: http://%s.local/\n", VENDX_DEVICE_ID);
    }
    g_registerDue = true;
  }
  if (!up && g_staAnnounced) {
    g_staAnnounced = false;
    g_staAttemptMs = millis();
    Serial.println("[vendx] wifi: station link lost, auto-reconnecting");
  }
  if (!up && !g_apUp && millis() - g_staAttemptMs > (uint32_t)VENDX_AP_FALLBACK_SEC * 1000UL) apBegin();
}

static void registerTick() {
  if (g_relayUrl.isEmpty()) return;
  // Only when something could be listening: a station link, or a client on
  // our own AP (the relay may be the laptop joined to vendx-<mac4>).
  const bool reachable = WiFi.status() == WL_CONNECTED || (g_apUp && WiFi.softAPgetStationNum() > 0);
  if (!reachable) return;
  const bool periodic = millis() - g_lastRegisterMs > (uint32_t)VENDX_REGISTER_SEC * 1000UL;
  if (g_registerDue) registerWithRelay("connect");
  else if (periodic) registerWithRelay("heartbeat");
}

// ---------------------------------------------------------------- HTTP
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
  // `extra` is the x402 v1 escape hatch. We use it to tell the buyer which
  // device minted this challenge and which facilitator can settle it — the
  // node's nonce is unknown to the relay until the buyer names the node.
  JsonObject extra = a["extra"].to<JsonObject>();
  extra["deviceId"] = VENDX_DEVICE_ID;
  extra["source"] = "esp32c3";
  if (!g_relayUrl.isEmpty()) extra["facilitator"] = g_relayUrl;
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
  // Provenance: this is real hardware running the VENDX node firmware, not
  // the relay's simulator and not a reading relayed off a serial console.
  doc["source"] = "esp32c3";
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
  Serial.println();
  Serial.printf("[vendx] boot device=%s network=%s price=%llu payTo=%s fw=\"%s\"\n", VENDX_DEVICE_ID, VENDX_NETWORK,
                (unsigned long long)VENDX_PRICE_MICRO_USDC, VENDX_PAY_TO, kFirmware);

  WiFi.mode(WIFI_STA);
  WiFi.setHostname(VENDX_DEVICE_ID);
  {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char buf[16];
    snprintf(buf, sizeof(buf), "vendx-%02x%02x", mac[4], mac[5]);
    g_apSsid = buf;
  }
  loadWifiCreds();
  Serial.printf("[vendx] relay: %s\n", g_relayUrl.isEmpty() ? "(none — serial: relay <url>)" : g_relayUrl.c_str());
  staBegin();
  if (g_ssid.isEmpty()) apBegin();

  vendx::verifierBegin(VENDX_FACILITATOR_PUBKEY, VENDX_PAY_TO,
                       VENDX_PRICE_MICRO_USDC, VENDX_NETWORK);
  vendx::sensorBegin();

  server.on("/api/telemetry", HTTP_GET, handleTelemetry);
  server.on("/health", HTTP_GET, [](AsyncWebServerRequest* r) {
    JsonDocument d;
    d["ok"] = true;
    d["device"] = VENDX_DEVICE_ID;
    d["source"] = "esp32c3";
    d["heap"] = ESP.getFreeHeap();
    d["uptime"] = millis() / 1000;
    d["sta"] = WiFi.status() == WL_CONNECTED;
    d["ip"] = WiFi.localIP().toString();
    d["ap"] = g_apUp;
    d["payTo"] = VENDX_PAY_TO;
    d["priceMicroUsdc"] = String((unsigned long long)VENDX_PRICE_MICRO_USDC);
    d["network"] = VENDX_NETWORK;
    d["relay"] = g_relayUrl.isEmpty() ? (const char*)nullptr : g_relayUrl.c_str();
    d["registered"] = g_lastRegisterCode == 200;
    d["firmware"] = kFirmware;
    String b; serializeJson(d, b);
    r->send(200, "application/json", b);
  });
  server.on("/", HTTP_GET, [](AsyncWebServerRequest* r) {
    JsonDocument d;
    d["vendx"] = true;
    d["device"] = VENDX_DEVICE_ID;
    JsonArray routes = d["routes"].to<JsonArray>();
    routes.add("GET /api/telemetry  (402 challenge; 200 with X-PAYMENT-RECEIPT)");
    routes.add("GET /health");
    String b; serializeJson(d, b);
    r->send(200, "application/json", b);
  });
  server.onNotFound([](AsyncWebServerRequest* r) {
    r->send(404, "application/json", "{\"error\":\"not_found\"}");
  });
  server.begin();
  Serial.println("[vendx] vending on :80/api/telemetry (serial: help)");
}

void loop() {
  vendx::sensorTick();
  pollSerial();
  wifiTick();
  registerTick();
  delay(50);
}
