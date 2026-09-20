/*
 * ESPectre - Badge Display Service
 *
 * Author: Francesco Pace <francesco.pace@gmail.com>
 * SPDX-License-Identifier: GPL-3.0-only
 * Commercial licensing available under separate agreement; see LICENSING.md.
 */
#include "badge_display.h"

#include <cstring>

#include <driver/gpio.h>
#include <driver/spi_master.h>
#include <esp_heap_caps.h>
#include <esp_lcd_io_spi.h>
#include <esp_lcd_panel_ops.h>
#include <esp_lcd_panel_vendor.h>
#include <esp_log.h>

#include "badge_display_font.h"

namespace presence_node {

namespace {

constexpr const char *kTag = "espectre.badge_display";

// Confirmed against the badge creator's own custom-flash guide.
constexpr gpio_num_t kPinMosi = GPIO_NUM_10;
constexpr gpio_num_t kPinClk = GPIO_NUM_1;
constexpr gpio_num_t kPinCs = GPIO_NUM_2;
constexpr gpio_num_t kPinDc = GPIO_NUM_0;
constexpr gpio_num_t kPinRst = GPIO_NUM_4;
constexpr spi_host_device_t kSpiHost = SPI2_HOST;
constexpr int kPclkHz = 40 * 1000 * 1000;

constexpr int kScreenWidth = 320;
constexpr int kScreenHeight = 240;
constexpr int kGlyphSize = 8;
constexpr int kScale = 3;
constexpr int kLineHeight = kGlyphSize * kScale;  // 24 px
constexpr int kStripeCount = kScreenHeight / kLineHeight;  // 10 stripes, full coverage
constexpr int kTextStripe = kStripeCount / 2;  // one stripe above center; alignment matters more than exact centering

constexpr uint16_t kColorGreen = 0x07E0;
constexpr uint16_t kColorRed = 0xF800;

const char *kMotionLabel = "MOTION";
const char *kIdleLabel = "NO MOTION";

void draw_glyph(uint16_t *line, int x0, char c, uint16_t color) {
  const uint8_t *glyph = badge_display_glyph(c);
  for (int row = 0; row < kGlyphSize; ++row) {
    const uint8_t bits = glyph[row];
    for (int col = 0; col < kGlyphSize; ++col) {
      if ((bits & (1U << col)) == 0) {
        continue;
      }
      for (int sy = 0; sy < kScale; ++sy) {
        const int y = row * kScale + sy;
        for (int sx = 0; sx < kScale; ++sx) {
          const int x = x0 + col * kScale + sx;
          if (x >= 0 && x < kScreenWidth) {
            line[y * kScreenWidth + x] = color;
          }
        }
      }
    }
  }
}

}  // namespace

BadgeDisplayService::~BadgeDisplayService() {
  if (line_buffer_ != nullptr) {
    heap_caps_free(line_buffer_);
  }
  if (panel_ != nullptr) {
    esp_lcd_panel_del(static_cast<esp_lcd_panel_handle_t>(panel_));
  }
}

bool BadgeDisplayService::setup() {
  line_buffer_ = static_cast<uint16_t *>(
      heap_caps_malloc(static_cast<size_t>(kScreenWidth) * kLineHeight * sizeof(uint16_t), MALLOC_CAP_DMA));
  if (line_buffer_ == nullptr) {
    ESP_LOGE(kTag, "Failed to allocate display line buffer");
    return false;
  }

  spi_bus_config_t bus_config{};
  bus_config.mosi_io_num = kPinMosi;
  bus_config.miso_io_num = -1;
  bus_config.sclk_io_num = kPinClk;
  bus_config.quadwp_io_num = -1;
  bus_config.quadhd_io_num = -1;
  bus_config.max_transfer_sz = kScreenWidth * kLineHeight * static_cast<int>(sizeof(uint16_t));
  esp_err_t err = spi_bus_initialize(kSpiHost, &bus_config, SPI_DMA_CH_AUTO);
  if (err != ESP_OK) {
    ESP_LOGE(kTag, "spi_bus_initialize failed: %s", esp_err_to_name(err));
    return false;
  }

  esp_lcd_panel_io_spi_config_t io_config{};
  io_config.cs_gpio_num = kPinCs;
  io_config.dc_gpio_num = kPinDc;
  io_config.spi_mode = 0;
  io_config.pclk_hz = kPclkHz;
  // Depth 1 makes esp_lcd_panel_draw_bitmap block until the transaction is
  // actually sent, which matters here: line_buffer_ is reused and rewritten
  // between calls (blank stripes, then glyphs), so a queued-but-not-yet-sent
  // transaction must never see a buffer someone is already overwriting.
  io_config.trans_queue_depth = 1;
  io_config.lcd_cmd_bits = 8;
  io_config.lcd_param_bits = 8;
  esp_lcd_panel_io_handle_t io_handle = nullptr;
  err = esp_lcd_new_panel_io_spi(static_cast<esp_lcd_spi_bus_handle_t>(kSpiHost), &io_config, &io_handle);
  if (err != ESP_OK) {
    ESP_LOGE(kTag, "esp_lcd_new_panel_io_spi failed: %s", esp_err_to_name(err));
    return false;
  }

  esp_lcd_panel_dev_config_t panel_config{};
  panel_config.reset_gpio_num = kPinRst;
  panel_config.rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB;
  panel_config.data_endian = LCD_RGB_DATA_ENDIAN_LITTLE;
  panel_config.bits_per_pixel = 16;
  esp_lcd_panel_handle_t panel_handle = nullptr;
  err = esp_lcd_new_panel_st7789(io_handle, &panel_config, &panel_handle);
  if (err != ESP_OK) {
    ESP_LOGE(kTag, "esp_lcd_new_panel_st7789 failed: %s", esp_err_to_name(err));
    return false;
  }
  panel_ = panel_handle;

  ESP_ERROR_CHECK(esp_lcd_panel_reset(panel_handle));
  ESP_ERROR_CHECK(esp_lcd_panel_init(panel_handle));
  // Orientation for this badge's mounting, per the creator's HAL guide.
  ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel_handle, true));
  ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(panel_handle, true));
  ESP_ERROR_CHECK(esp_lcd_panel_mirror(panel_handle, true, false));
  ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel_handle, true));

  ready_ = true;
  redraw(false);
  ESP_LOGI(kTag, "Badge display ready");
  return true;
}

void BadgeDisplayService::redraw(bool motion) {
  if (!ready_) {
    return;
  }
  const char *label = motion ? kMotionLabel : kIdleLabel;
  const uint16_t color = motion ? kColorGreen : kColorRed;
  const int length = static_cast<int>(std::strlen(label));
  const int glyph_width = kGlyphSize * kScale;
  const int text_width = length * glyph_width;
  const int x_start = (kScreenWidth - text_width) / 2;

  auto *panel_handle = static_cast<esp_lcd_panel_handle_t>(panel_);
  const size_t stripe_bytes = static_cast<size_t>(kScreenWidth) * kLineHeight * sizeof(uint16_t);
  for (int stripe = 0; stripe < kStripeCount; ++stripe) {
    std::memset(line_buffer_, 0, stripe_bytes);
    if (stripe == kTextStripe) {
      for (int i = 0; i < length; ++i) {
        draw_glyph(line_buffer_, x_start + i * glyph_width, label[i], color);
      }
    }
    const int y = stripe * kLineHeight;
    esp_lcd_panel_draw_bitmap(panel_handle, 0, y, kScreenWidth, y + kLineHeight, line_buffer_);
  }
  last_motion_ = motion;
  has_drawn_ = true;
}

void BadgeDisplayService::update(const RuntimeSnapshot &snapshot) {
  if (!ready_) {
    return;
  }
  const bool motion_now = snapshot.ready_to_publish && snapshot.motion_state == MotionState::MOTION;
  if (has_drawn_ && motion_now == last_motion_) {
    return;
  }
  redraw(motion_now);
}

}  // namespace presence_node
