/*
 * VENDX - Earnings poller
 *
 * SPDX-License-Identifier: GPL-3.0-only
 */
#include "vendx_earnings.h"

#include <cstring>

#include <esp_crt_bundle.h>
#include <esp_http_client.h>
#include <esp_log.h>
#include <esp_netif.h>
#include <freertos/FreeRTOS.h>
#include <freertos/task.h>

#include "badge_display.h"

namespace presence_node {

namespace {

constexpr const char *kTag = "vendx.earnings";
/** Replies are ~200 bytes; anything past this is not our endpoint. */
constexpr size_t kMaxBody = 2048;
/** Extra time over the relay's long-poll for TLS, cloudflared and a slow hotspot. */
constexpr uint32_t kHttpSlackMs = 15'000;
constexpr uint32_t kBackoffMinMs = 5'000;
constexpr uint32_t kBackoffMaxMs = 30'000;
/** TLS handshake + HTTP client on the C3 want a roomy stack; OTA in this tree uses similar. */
constexpr uint32_t kTaskStackBytes = 10 * 1024;

bool sta_has_ip() {
  esp_netif_t *netif = esp_netif_get_handle_from_ifkey("WIFI_STA_DEF");
  if (netif == nullptr || !esp_netif_is_netif_up(netif)) return false;
  esp_netif_ip_info_t ip{};
  return esp_netif_get_ip_info(netif, &ip) == ESP_OK && ip.ip.addr != 0;
}

void append_urlencoded(std::string *out, const std::string &value) {
  static const char *kHex = "0123456789ABCDEF";
  for (const unsigned char c : value) {
    const bool unreserved = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') ||
                            c == '-' || c == '_' || c == '.' || c == '~';
    if (unreserved) {
      out->push_back(static_cast<char>(c));
    } else {
      out->push_back('%');
      out->push_back(kHex[c >> 4]);
      out->push_back(kHex[c & 0x0F]);
    }
  }
}

esp_err_t http_event(esp_http_client_event_t *event) {
  auto *body = static_cast<std::string *>(event->user_data);
  if (event->event_id == HTTP_EVENT_ON_DATA && body != nullptr && event->data_len > 0) {
    if (body->size() + static_cast<size_t>(event->data_len) <= kMaxBody) {
      body->append(static_cast<const char *>(event->data), static_cast<size_t>(event->data_len));
    } else {
      body->assign("<oversize>");
    }
  }
  return ESP_OK;
}

}  // namespace

bool VendxEarningsService::start(BadgeDisplayService *display, const Config &config) {
  if (display == nullptr || config.relay_url == nullptr || config.relay_url[0] == '\0') {
    ESP_LOGW(kTag, "Earnings display disabled: no relay URL configured");
    return false;
  }
  display_ = display;
  relay_url_ = config.relay_url;
  while (!relay_url_.empty() && relay_url_.back() == '/') relay_url_.pop_back();
  device_id_ = config.device_id != nullptr ? config.device_id : "";
  wait_sec_ = config.wait_sec == 0 ? 1U : (config.wait_sec > 30U ? 30U : config.wait_sec);
  std::strncpy(shown_, vendx::kEarningsUnknown, sizeof(shown_) - 1);
  display_->set_earnings(shown_);

  const BaseType_t created =
      xTaskCreate(&VendxEarningsService::task_entry, "vendx_earnings", kTaskStackBytes, this, tskIDLE_PRIORITY + 1, nullptr);
  if (created != pdPASS) {
    ESP_LOGE(kTag, "Failed to create the earnings task");
    return false;
  }
  ESP_LOGI(kTag, "Earnings display: relay=%s device=%s wait=%us", relay_url_.c_str(),
           device_id_.empty() ? "(relay default)" : device_id_.c_str(), static_cast<unsigned>(wait_sec_));
  return true;
}

void VendxEarningsService::task_entry(void *arg) {
  static_cast<VendxEarningsService *>(arg)->run();
  vTaskDelete(nullptr);
}

bool VendxEarningsService::wait_for_network(uint32_t timeout_ms) {
  const TickType_t deadline = xTaskGetTickCount() + pdMS_TO_TICKS(timeout_ms);
  while (!sta_has_ip()) {
    if (xTaskGetTickCount() >= deadline) return false;
    vTaskDelay(pdMS_TO_TICKS(500));
  }
  return true;
}

std::string VendxEarningsService::build_url() const {
  std::string url = relay_url_;
  url += "/api/earnings?wait=";
  url += std::to_string(wait_sec_);
  if (!last_total_micro_.empty()) {
    url += "&since=";
    url += last_total_micro_;
  }
  if (!device_id_.empty()) {
    url += "&device=";
    append_urlencoded(&url, device_id_);
  }
  return url;
}

bool VendxEarningsService::fetch(const std::string &url, std::string *body, int *status) {
  body->clear();
  *status = 0;
  auto *client = static_cast<esp_http_client_handle_t>(client_);
  if (client == nullptr) {
    esp_http_client_config_t config{};
    config.url = url.c_str();
    config.method = HTTP_METHOD_GET;
    config.timeout_ms = static_cast<int>(wait_sec_ * 1000U + kHttpSlackMs);
    config.event_handler = &http_event;
    config.user_data = body;
    config.crt_bundle_attach = esp_crt_bundle_attach;
    config.keep_alive_enable = true;
    config.buffer_size = 1024;
    config.buffer_size_tx = 512;
    client = esp_http_client_init(&config);
    if (client == nullptr) {
      ESP_LOGW(kTag, "esp_http_client_init failed");
      return false;
    }
    client_ = client;
  } else if (esp_http_client_set_url(client, url.c_str()) != ESP_OK) {
    ESP_LOGW(kTag, "esp_http_client_set_url failed");
    esp_http_client_cleanup(client);
    client_ = nullptr;
    return false;
  }
  (void) esp_http_client_set_header(client, "Accept", "application/json");
  const esp_err_t err = esp_http_client_perform(client);
  if (err != ESP_OK) {
    ESP_LOGW(kTag, "GET %s failed: %s", url.c_str(), esp_err_to_name(err));
    esp_http_client_cleanup(client);
    client_ = nullptr;
    return false;
  }
  *status = esp_http_client_get_status_code(client);
  return true;
}

void VendxEarningsService::apply_reply(const vendx::EarningsReply &reply) {
  char text[vendx::kEarningsTextMax + 1];
  if (!vendx::sanitize_earnings_text(reply.display, text)) {
    ESP_LOGW(kTag, "Relay sent a display string the screen refuses: '%s'", reply.display.c_str());
    return;
  }
  const bool first = last_total_micro_.empty();
  last_total_micro_ = reply.total_micro;
  if (std::strcmp(text, shown_) != 0) {
    std::strncpy(shown_, text, sizeof(shown_) - 1);
    shown_[sizeof(shown_) - 1] = '\0';
    display_->set_earnings(shown_);
    ESP_LOGI(kTag, "Earned so far: %s (%s micro-USDC)%s", shown_, last_total_micro_.c_str(),
             first ? " [first reply]" : "");
  } else if (first) {
    ESP_LOGI(kTag, "Earned so far: %s (%s micro-USDC) [first reply]", shown_, last_total_micro_.c_str());
  }
}

void VendxEarningsService::run() {
  uint32_t backoff_ms = kBackoffMinMs;
  for (;;) {
    if (!wait_for_network(60'000)) {
      ESP_LOGD(kTag, "No station IP yet; earnings poll waiting");
      continue;
    }
    int status = 0;
    const std::string url = build_url();
    const bool transported = fetch(url, &body_, &status);
    if (transported && status == 200) {
      vendx::EarningsReply reply;
      if (vendx::parse_earnings_reply(body_, &reply)) {
        apply_reply(reply);
        backoff_ms = kBackoffMinMs;
        // The long-poll already paced us; go straight back so a sale is never missed.
        vTaskDelay(pdMS_TO_TICKS(50));
        continue;
      }
      ESP_LOGW(kTag, "Unparseable reply (%u bytes): %.80s", static_cast<unsigned>(body_.size()), body_.c_str());
    } else if (transported) {
      ESP_LOGW(kTag, "Relay answered HTTP %d: %.80s", status, body_.c_str());
    }
    vTaskDelay(pdMS_TO_TICKS(backoff_ms));
    backoff_ms = backoff_ms >= kBackoffMaxMs ? kBackoffMaxMs : backoff_ms * 2;
  }
}

}  // namespace presence_node
