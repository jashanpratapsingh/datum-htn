/*
 * ESPectre - ESPHome Log Sink
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#pragma once
#include "espectre_sdk.h"


namespace esphome {
namespace presence_node_component {

::presence_node::LogSink make_esphome_log_sink();

}  // namespace presence_node_component
}  // namespace esphome
