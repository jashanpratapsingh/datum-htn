/*
 * VENDX - Earnings poller
 *
 * Asks the VENDX relay how much the device it represents has earned and hands
 * the dollar figure to the badge display. The relay keeps the books (every
 * x402 settle lands there), so the screen is a view of the relay, not a
 * counter kept on the badge: a reboot never loses or invents a sale.
 *
 * One FreeRTOS task, one HTTPS long-poll at a time: GET
 * <relay>/api/earnings?wait=N&since=<last total> returns as soon as the total
 * changes, so the screen moves within a second of a purchase while the badge
 * makes one request every ~N seconds. Failures keep the last figure on screen
 * and back off; nothing here can take sensing down.
 *
 * Not part of upstream ESPectre; VENDX-specific, like badge_display.cpp.
 * SPDX-License-Identifier: GPL-3.0-only
 */
#pragma once

#include <cstdint>
#include <string>

#include "vendx_earnings_text.h"

namespace presence_node {

class BadgeDisplayService;

class VendxEarningsService {
 public:
  struct Config {
    /** Relay base URL, no trailing slash: "https://relay.vendx.biz". */
    const char *relay_url{""};
    /** VENDX device id to show; empty means the device agents buy from on that relay. */
    const char *device_id{""};
    /** Long-poll length in seconds (the relay caps it at 30). */
    uint32_t wait_sec{25};
  };

  VendxEarningsService() = default;
  VendxEarningsService(const VendxEarningsService &) = delete;
  VendxEarningsService &operator=(const VendxEarningsService &) = delete;

  /** Starts the poller task. Returns false when the config is unusable or the task cannot be created. */
  bool start(BadgeDisplayService *display, const Config &config);

  /** Last total the relay reported (micro-USDC as a decimal string), empty before the first reply. */
  const std::string &last_total_micro() const { return last_total_micro_; }

 private:
  static void task_entry(void *arg);
  void run();
  bool wait_for_network(uint32_t timeout_ms);
  std::string build_url() const;
  /** One request. Fills `body`/`status`; false on transport failure. */
  bool fetch(const std::string &url, std::string *body, int *status);
  void apply_reply(const vendx::EarningsReply &reply);

  BadgeDisplayService *display_{nullptr};
  std::string relay_url_;
  std::string device_id_;
  uint32_t wait_sec_{25};
  std::string last_total_micro_;
  char shown_[vendx::kEarningsTextMax + 1]{};
  void *client_{nullptr};
  std::string body_;
};

}  // namespace presence_node
