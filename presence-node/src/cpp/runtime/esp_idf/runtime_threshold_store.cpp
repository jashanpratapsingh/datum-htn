/*
 * ESPectre - Runtime Threshold Store
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#include "runtime_threshold_store.h"

#include "nvs.h"
#include "runtime_sensing_schema.h"

namespace presence_node {

namespace {

constexpr const char *kNamespace = "espectre";
constexpr const char *kThresholdKey = "threshold";

}  // namespace

esp_err_t load_runtime_threshold(float *threshold, bool *has_saved_value) {
  if (threshold == nullptr || has_saved_value == nullptr) {
    return ESP_ERR_INVALID_ARG;
  }
  *has_saved_value = false;
  nvs_handle_t handle = 0;
  esp_err_t err = nvs_open(kNamespace, NVS_READONLY, &handle);
  if (err == ESP_ERR_NVS_NOT_FOUND) {
    return ESP_OK;
  }
  if (err != ESP_OK) {
    return err;
  }
  float value = 0.0f;
  size_t length = sizeof(value);
  err = nvs_get_blob(handle, kThresholdKey, &value, &length);
  nvs_close(handle);
  if (err == ESP_ERR_NVS_NOT_FOUND) {
    return ESP_OK;
  }
  if (err != ESP_OK) {
    return err;
  }
  if (length != sizeof(value) || value < RUNTIME_THRESHOLD_MIN || value > RUNTIME_THRESHOLD_MAX) {
    return ESP_ERR_INVALID_STATE;
  }
  *threshold = value;
  *has_saved_value = true;
  return ESP_OK;
}

esp_err_t save_runtime_threshold(float threshold) {
  if (threshold < RUNTIME_THRESHOLD_MIN || threshold > RUNTIME_THRESHOLD_MAX) {
    return ESP_ERR_INVALID_ARG;
  }
  nvs_handle_t handle = 0;
  esp_err_t err = nvs_open(kNamespace, NVS_READWRITE, &handle);
  if (err != ESP_OK) {
    return err;
  }
  err = nvs_set_blob(handle, kThresholdKey, &threshold, sizeof(threshold));
  if (err == ESP_OK) {
    err = nvs_commit(handle);
  }
  nvs_close(handle);
  return err;
}

}  // namespace presence_node
