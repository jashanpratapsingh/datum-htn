/*
 * VENDX - Earnings text helpers
 *
 * Pure functions shared by the earnings poller and its host test: pull the
 * two fields the screen needs out of the relay's GET /api/earnings reply, and
 * refuse to paint anything that is not a dollar figure. No ESP-IDF includes,
 * so this compiles on the host (see test/run.sh).
 *
 * Not part of upstream ESPectre; VENDX-specific, like badge_display.cpp.
 * SPDX-License-Identifier: GPL-3.0-only
 */
#pragma once

#include <cstddef>
#include <cstring>
#include <string>

namespace presence_node::vendx {

/** Longest text the display paints: "$1,234,567.89" is 13; anything longer is refused. */
constexpr size_t kEarningsTextMax = 13;
/** What the screen shows before the relay has answered once. */
constexpr const char *kEarningsUnknown = "$--";

/** The two fields of a GET /api/earnings reply the firmware acts on. */
struct EarningsReply {
  std::string display;      // "$0.0012"
  std::string total_micro;  // "1200" — echoed back as `since` on the next poll
};

namespace detail {

/** Find `"key":"value"` in a flat JSON object and return the raw value (no escapes expected). */
inline bool extract_string_field(const std::string &body, const char *key, std::string *out) {
  std::string needle = "\"";
  needle += key;
  needle += "\"";
  size_t at = body.find(needle);
  if (at == std::string::npos) return false;
  at += needle.size();
  while (at < body.size() && (body[at] == ' ' || body[at] == '\t' || body[at] == '\n' || body[at] == '\r')) ++at;
  if (at >= body.size() || body[at] != ':') return false;
  ++at;
  while (at < body.size() && (body[at] == ' ' || body[at] == '\t' || body[at] == '\n' || body[at] == '\r')) ++at;
  if (at >= body.size() || body[at] != '"') return false;
  ++at;
  const size_t end = body.find('"', at);
  if (end == std::string::npos) return false;
  out->assign(body, at, end - at);
  return true;
}

}  // namespace detail

/**
 * Accept only what a dollar readout can contain: a leading "$", then digits,
 * commas and at most one period, within kEarningsTextMax characters. Copies
 * into `out` (kEarningsTextMax + 1 bytes) and returns true, or leaves `out`
 * untouched and returns false.
 */
inline bool sanitize_earnings_text(const std::string &in, char *out) {
  if (in.empty() || in.size() > kEarningsTextMax || in[0] != '$') return false;
  if (in.size() < 2) return false;
  int periods = 0;
  for (size_t i = 1; i < in.size(); ++i) {
    const char c = in[i];
    if (c >= '0' && c <= '9') continue;
    if (c == ',') continue;
    if (c == '.') {
      if (++periods > 1) return false;
      continue;
    }
    return false;
  }
  if (in.back() == '.' || in.back() == ',') return false;
  std::memcpy(out, in.data(), in.size());
  out[in.size()] = '\0';
  return true;
}

/** Parse the relay reply. Both fields must be present; `total_micro` must be all digits. */
inline bool parse_earnings_reply(const std::string &body, EarningsReply *out) {
  EarningsReply reply;
  if (!detail::extract_string_field(body, "display", &reply.display)) return false;
  if (!detail::extract_string_field(body, "totalEarnedMicroUsdc", &reply.total_micro)) return false;
  if (reply.total_micro.empty() || reply.total_micro.size() > 20) return false;
  for (const char c : reply.total_micro) {
    if (c < '0' || c > '9') return false;
  }
  *out = std::move(reply);
  return true;
}

}  // namespace presence_node::vendx
