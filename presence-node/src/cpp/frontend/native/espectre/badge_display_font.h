/*
 * ESPectre - Badge Display Font (subset)
 *
 * A minimal subset of the public-domain 8x8 bitmap font needed to render
 * "MOTION" and "NO MOTION" (letters I, M, N, O, T, plus space). Glyph bytes
 * are copied verbatim from font8x8_basic.h by Daniel Hepper
 * (https://github.com/dhepper/font8x8), itself based on Marcel Sondaar's
 * public-domain VGA font work. Public Domain.
 *
 * Each glyph is 8 bytes; byte N is row N of the glyph, bit K of that byte
 * (from bit 0) is column K of the row.
 *
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#pragma once

#include <cstdint>

namespace presence_node {

inline const uint8_t *badge_display_glyph(char c) {
  static constexpr uint8_t kSpace[8] = {0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00};
  static constexpr uint8_t kI[8] = {0x1E, 0x0C, 0x0C, 0x0C, 0x0C, 0x0C, 0x1E, 0x00};
  static constexpr uint8_t kM[8] = {0x63, 0x77, 0x7F, 0x7F, 0x6B, 0x63, 0x63, 0x00};
  static constexpr uint8_t kN[8] = {0x63, 0x67, 0x6F, 0x7B, 0x73, 0x63, 0x63, 0x00};
  static constexpr uint8_t kO[8] = {0x1C, 0x36, 0x63, 0x63, 0x63, 0x36, 0x1C, 0x00};
  static constexpr uint8_t kT[8] = {0x3F, 0x2D, 0x0C, 0x0C, 0x0C, 0x0C, 0x1E, 0x00};
  switch (c) {
    case 'I': return kI;
    case 'M': return kM;
    case 'N': return kN;
    case 'O': return kO;
    case 'T': return kT;
    default: return kSpace;
  }
}

}  // namespace presence_node
