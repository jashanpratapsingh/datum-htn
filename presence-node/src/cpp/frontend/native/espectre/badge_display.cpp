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
#include <freertos/FreeRTOS.h>
#include <freertos/semphr.h>

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
// One stripe is tall enough for the biggest glyph (scale 5 = 40 px), so every
// line of text lives inside exactly one stripe of the full-height sweep.
constexpr int kStripeHeight = 40;
constexpr int kStripeCount = kScreenHeight / kStripeHeight;  // 6 stripes, full coverage

// Layout, top to bottom (stripe index, y offset inside the stripe, scale):
//   "EARNED"          stripe 1, grey,   small  (16 px)
//   "$0.0012"         stripe 2, white,  large  (40 px; 32 px when > 8 chars)
//   "MOTION"/"NO MOTION" stripe 4, green/red, medium (24 px)
constexpr int kCaptionStripe = 1;
constexpr int kCaptionScale = 2;
constexpr int kCaptionOffsetY = (kStripeHeight - kGlyphSize * kCaptionScale) / 2;
constexpr int kEarningsStripe = 2;
constexpr int kEarningsScaleLarge = 5;
constexpr int kEarningsScaleSmall = 4;
constexpr int kEarningsLargeMaxChars = kScreenWidth / (kGlyphSize * kEarningsScaleLarge);  // 8
constexpr int kMotionStripe = 4;
constexpr int kMotionScale = 3;
constexpr int kMotionOffsetY = (kStripeHeight - kGlyphSize * kMotionScale) / 2;

constexpr uint16_t kColorGreen = 0x07E0;
constexpr uint16_t kColorRed = 0xF800;
constexpr uint16_t kColorWhite = 0xFFFF;
constexpr uint16_t kColorGrey = 0x8410;

const char *kMotionLabel = "MOTION";
const char *kIdleLabel = "NO MOTION";
const char *kEarningsCaption = "EARNED";

void draw_glyph(uint16_t *line, int x0, int y0, char c, int scale, uint16_t color) {
  const uint8_t *glyph = badge_display_glyph(c);
  for (int row = 0; row < kGlyphSize; ++row) {
    const uint8_t bits = glyph[row];
    for (int col = 0; col < kGlyphSize; ++col) {
      if ((bits & (1U << col)) == 0) {
        continue;
      }
      for (int sy = 0; sy < scale; ++sy) {
        const int y = y0 + row * scale + sy;
        if (y < 0 || y >= kStripeHeight) {
          continue;
        }
        for (int sx = 0; sx < scale; ++sx) {
          const int x = x0 + col * scale + sx;
          if (x >= 0 && x < kScreenWidth) {
            line[y * kScreenWidth + x] = color;
          }
        }
      }
    }
  }
}

// Centres `text` horizontally inside the current stripe buffer.
void draw_centered(uint16_t *line, const char *text, int y0, int scale, uint16_t color) {
  const int length = static_cast<int>(std::strlen(text));
  const int glyph_width = kGlyphSize * scale;
  const int x_start = (kScreenWidth - length * glyph_width) / 2;
  for (int i = 0; i < length; ++i) {
    draw_glyph(line, x_start + i * glyph_width, y0, text[i], scale, color);
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
  if (lock_ != nullptr) {
    vSemaphoreDelete(static_cast<SemaphoreHandle_t>(lock_));
  }
}

bool BadgeDisplayService::setup() {
  std::strncpy(earnings_, vendx::kEarningsUnknown, sizeof(earnings_) - 1);
  if (lock_ == nullptr) {
    lock_ = xSemaphoreCreateMutex();
    if (lock_ == nullptr) {
      ESP_LOGE(kTag, "Failed to create the display lock");
      return false;
    }
  }

  line_buffer_ = static_cast<uint16_t *>(
      heap_caps_malloc(static_cast<size_t>(kScreenWidth) * kStripeHeight * sizeof(uint16_t), MALLOC_CAP_DMA));
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
  bus_config.max_transfer_sz = kScreenWidth * kStripeHeight * static_cast<int>(sizeof(uint16_t));
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
  char earnings[sizeof(earnings_)];
  copy_earnings(earnings);
  redraw(false, earnings);
  ESP_LOGI(kTag, "Badge display ready");
  return true;
}

void BadgeDisplayService::set_earnings(const char *text) {
  if (text == nullptr) {
    return;
  }
  auto *lock = static_cast<SemaphoreHandle_t>(lock_);
  if (lock != nullptr) {
    xSemaphoreTake(lock, portMAX_DELAY);
  }
  std::strncpy(earnings_, text, sizeof(earnings_) - 1);
  earnings_[sizeof(earnings_) - 1] = '\0';
  if (lock != nullptr) {
    xSemaphoreGive(lock);
  }
}

void BadgeDisplayService::copy_earnings(char *out) const {
  auto *lock = static_cast<SemaphoreHandle_t>(lock_);
  if (lock != nullptr) {
    xSemaphoreTake(lock, portMAX_DELAY);
  }
  std::memcpy(out, earnings_, sizeof(earnings_));
  if (lock != nullptr) {
    xSemaphoreGive(lock);
  }
}

void BadgeDisplayService::redraw(bool motion, const char *earnings) {
  if (!ready_) {
    return;
  }
  const char *label = motion ? kMotionLabel : kIdleLabel;
  const uint16_t label_color = motion ? kColorGreen : kColorRed;
  const int earnings_scale =
      static_cast<int>(std::strlen(earnings)) > kEarningsLargeMaxChars ? kEarningsScaleSmall : kEarningsScaleLarge;
  const int earnings_offset_y = (kStripeHeight - kGlyphSize * earnings_scale) / 2;

  auto *panel_handle = static_cast<esp_lcd_panel_handle_t>(panel_);
  const size_t stripe_bytes = static_cast<size_t>(kScreenWidth) * kStripeHeight * sizeof(uint16_t);
  for (int stripe = 0; stripe < kStripeCount; ++stripe) {
    std::memset(line_buffer_, 0, stripe_bytes);
    if (stripe == kCaptionStripe) {
      draw_centered(line_buffer_, kEarningsCaption, kCaptionOffsetY, kCaptionScale, kColorGrey);
    } else if (stripe == kEarningsStripe) {
      draw_centered(line_buffer_, earnings, earnings_offset_y, earnings_scale, kColorWhite);
    } else if (stripe == kMotionStripe) {
      draw_centered(line_buffer_, label, kMotionOffsetY, kMotionScale, label_color);
    }
    const int y = stripe * kStripeHeight;
    esp_lcd_panel_draw_bitmap(panel_handle, 0, y, kScreenWidth, y + kStripeHeight, line_buffer_);
  }
  last_motion_ = motion;
  std::memcpy(shown_earnings_, earnings, sizeof(shown_earnings_));
  has_drawn_ = true;
}

void BadgeDisplayService::update(const RuntimeSnapshot &snapshot) {
  if (!ready_) {
    return;
  }
  const bool motion_now = snapshot.ready_to_publish && snapshot.motion_state == MotionState::MOTION;
  char earnings[sizeof(earnings_)];
  copy_earnings(earnings);
  if (has_drawn_ && motion_now == last_motion_ && std::strcmp(earnings, shown_earnings_) == 0) {
    return;
  }
  redraw(motion_now, earnings);
}

}  // namespace presence_node
