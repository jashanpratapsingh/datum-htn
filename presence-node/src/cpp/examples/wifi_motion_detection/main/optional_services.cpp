// SPDX-License-Identifier: GPL-3.0-only
// Commercial licensing available under separate agreement; see LICENSING.md.
#include "espectre_services_sdk.h"

#if CONFIG_ESPECTRE_SDK_ENABLE_MQTT
#include "espectre_mqtt_sdk.h"
#endif

// Exercise real symbols so CI checks linking as well as optional source compilation.
// No transport is started, and no persisted configuration is changed.
void check_optional_services() {
#if CONFIG_ESPECTRE_SDK_ENABLE_FRONTEND_SUPPORT
  presence_node::EspectreDeviceConfig config;
  (void) presence_node::publish_frontend_mqtt_status(nullptr, config, false, 0);
  presence_node::FrontendWifiStationOptions options;
  (void) presence_node::setup_frontend_wifi_station(nullptr, nullptr, options, "espectre.example", nullptr);
#endif
#if CONFIG_ESPECTRE_SDK_ENABLE_MQTT
  presence_node::EspIdfMqttTransport transport;
#endif
#if CONFIG_ESPECTRE_SDK_ENABLE_PROVISIONING
  presence_node::StoredWifiConfig stored;
  (void) presence_node::load_stored_wifi_config(&stored);
  presence_node::WifiProvisioningService provisioning(nullptr);
  (void) provisioning.setup_station({});
#endif
#if CONFIG_ESPECTRE_SDK_ENABLE_DIRECT
  presence_node::EspIdfDirectHttpService direct;
  presence_node::MdnsDiscoveryService discovery;
  discovery.shutdown();
  presence_node::MdnsBootstrapResponder bootstrap;
  presence_node::EspIdfPeerDiscoveryService peers;
  presence_node::RuntimeDirectHttpBridge bridge;
  (void) bridge.setup(nullptr, nullptr, {});
  presence_node::WifiBssidPinService pin;
  (void) pin.setup({});
#endif
}
