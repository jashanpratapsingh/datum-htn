// Host test for vendx_earnings_text.h: what the screen will and will not paint.
#include <cstdio>
#include <cstring>
#include <string>

#include "../vendx_earnings_text.h"

using presence_node::vendx::EarningsReply;
using presence_node::vendx::kEarningsTextMax;
using presence_node::vendx::parse_earnings_reply;
using presence_node::vendx::sanitize_earnings_text;

static int failures = 0;
#define CHECK(cond)                                                     \
  do {                                                                  \
    if (cond) {                                                         \
      std::printf("PASS  %s\n", #cond);                                 \
    } else {                                                            \
      std::printf("FAIL  %s (line %d)\n", #cond, __LINE__);             \
      ++failures;                                                       \
    }                                                                   \
  } while (0)

static bool ok(const char *in) {
  char out[kEarningsTextMax + 1];
  return sanitize_earnings_text(in, out) && std::strcmp(out, in) == 0;
}
static bool rejected(const char *in) {
  char out[kEarningsTextMax + 1] = "keep";
  return !sanitize_earnings_text(in, out) && std::strcmp(out, "keep") == 0;
}

int main() {
  // What the relay formats.
  CHECK(ok("$0.00"));
  CHECK(ok("$0.0001"));
  CHECK(ok("$0.0012"));
  CHECK(ok("$1.50"));
  CHECK(ok("$1,234.56789"));
  CHECK(ok("$1,234,567.89"));  // exactly kEarningsTextMax

  // What must never reach the panel.
  CHECK(rejected(""));
  CHECK(rejected("$"));
  CHECK(rejected("0.0012"));           // no dollar sign
  CHECK(rejected("$1.2.3"));           // two periods
  CHECK(rejected("$1."));              // dangling period
  CHECK(rejected("$1,"));              // dangling comma
  CHECK(rejected("$-0.01"));           // negatives are not earnings
  CHECK(rejected("$12,345,678.90"));   // 14 chars, too long
  CHECK(rejected("$0.00<script>"));
  CHECK(rejected("$0.00 USD"));

  // Reply parsing: compact relay output, whitespace-tolerant, order-independent.
  EarningsReply r;
  CHECK(parse_earnings_reply(
            R"({"deviceId":"esp32-sim-001","totalSales":12,"totalEarnedMicroUsdc":"1200","display":"$0.0012","updatedAt":1758240000,"source":"simulator"})",
            &r) &&
        r.display == "$0.0012" && r.total_micro == "1200");
  CHECK(parse_earnings_reply(R"({ "display" : "$0.00" , "totalEarnedMicroUsdc" : "0" })", &r) && r.display == "$0.00" &&
        r.total_micro == "0");
  CHECK(!parse_earnings_reply(R"({"display":"$0.00"})", &r));                          // missing total
  CHECK(!parse_earnings_reply(R"({"totalEarnedMicroUsdc":"12","display":5})", &r));    // display not a string
  CHECK(!parse_earnings_reply(R"({"display":"$0.00","totalEarnedMicroUsdc":"12a"})", &r));
  CHECK(!parse_earnings_reply(R"({"display":"$0.00","totalEarnedMicroUsdc":""})", &r));
  CHECK(!parse_earnings_reply("not json at all", &r));
  CHECK(!parse_earnings_reply(R"({"error":"store_unavailable"})", &r));

  std::printf(failures == 0 ? "ALL PASS\n" : "%d FAILED\n", failures);
  return failures == 0 ? 0 : 1;
}
