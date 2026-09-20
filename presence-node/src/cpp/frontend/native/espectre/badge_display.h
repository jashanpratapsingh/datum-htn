/*
 * ESPectre - Badge Display Service
 *
 * Drives the Hack the North badge's ST7789 SPI TFT (not a generic ESP32
 * peripheral -- this board's specific wiring) to show what this VENDX device
 * has earned so far, in dollars, above the current sensing state ("MOTION" /
 * "NO MOTION"). Deliberately not LVGL: three static text lines, so a direct
 * esp_lcd draw is simpler and far lighter on this board's ~150 KB free heap.
 *
 * Pin map (SPI2, 40 MHz, mode 0) confirmed against the badge creator's own
 * custom-flash guide: MOSI=10, CLK=1, CS=2, DC=0, RST=4.
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#pragma once

#include <cstdint>

#include "runtime/runtime_snapshot.h"
#include "vendx_earnings_text.h"

namespace presence_node {

class BadgeDisplayService {
 public:
  BadgeDisplayService() = default;
  ~BadgeDisplayService();

  BadgeDisplayService(const BadgeDisplayService &) = delete;
  BadgeDisplayService &operator=(const BadgeDisplayService &) = delete;

  // Initializes the SPI bus and ST7789 panel, and paints the initial
  // "no motion" state with the earnings line reading "$--" on a black
  // screen. Returns false (and leaves the service inert) if the panel can't
  // be brought up -- a display failure must never take sensing itself down.
  bool setup();

  // Call every loop tick. Only writes to the panel when the effective
  // motion/no-motion state or the earnings text actually changes.
  void update(const RuntimeSnapshot &snapshot);

  // Thread-safe; called from the earnings poller task. The text is painted
  // verbatim on the next update() that sees it differ from what is on screen.
  // Longer than vendx::kEarningsTextMax is truncated.
  void set_earnings(const char *text);

 private:
  // Redraws the whole screen as a sequence of full-width stripes covering
  // the entire height. Deliberately never issues an isolated small-window
  // write at a nonzero Y offset by itself: on this panel, doing so produced
  // a duplicate of the content elsewhere on screen (a partial-window
  // addressing quirk), whereas one continuous top-to-bottom sweep does not.
  void redraw(bool motion, const char *earnings);
  void copy_earnings(char *out) const;

  void *panel_{nullptr};
  uint16_t *line_buffer_{nullptr};
  void *lock_{nullptr};
  bool ready_{false};
  bool last_motion_{false};
  bool has_drawn_{false};
  char earnings_[vendx::kEarningsTextMax + 1]{};
  char shown_earnings_[vendx::kEarningsTextMax + 1]{};
};

}  // namespace presence_node
