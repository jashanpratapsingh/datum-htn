/*
 * ESPectre - Runtime Threshold Store
 *
 * Persists a manually-set motion threshold across reboots.
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#pragma once

#include "esp_err.h"

namespace presence_node {

esp_err_t load_runtime_threshold(float *threshold, bool *has_saved_value);
esp_err_t save_runtime_threshold(float threshold);

}  // namespace presence_node
