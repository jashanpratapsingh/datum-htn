/*
 * ESPectre - Recalibrate Button Component
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#include "recalibrate_button.h"

#include "espectre.h"

namespace esphome {
namespace presence_node_component {

void ESpectreRecalibrateButton::dump_config() {
  LOG_BUTTON("", "ESPectre Recalibrate", this);
}

void ESpectreRecalibrateButton::press_action() {
  if (this->parent_ != nullptr) {
    this->parent_->trigger_recalibration();
  }
}

}  // namespace presence_node_component
}  // namespace esphome
