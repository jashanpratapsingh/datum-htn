-- VENDX — the badge as a data vending machine.
--
-- Shows what the device is earning, how many peers it has sensed, and animates
-- the x402 handshake as payments land. The relay is the network face (the Lua
-- sandbox has no network API); this app is the sensor, the display and the
-- local ledger.
--
-- Target: Hack the North ESP32-C3 badge, Lua 5.5, main.lua <= 64 KiB.
-- Install: scripts/badge.py push badge-app/vendx vendx   (see docs/BADGE.md)

local STORE_EARNED = "vendx_earned_micro"
local STORE_SALES  = "vendx_sales"
local BUCKET_SEC   = 300

local state = {
  peers      = {},   -- mac -> last_seen_ms, deduped inside one bucket
  peer_count = 0,
  bucket_at  = 0,
  earned     = 0,
  sales      = 0,
  step       = 0,    -- which handshake step is lit
  step_at    = 0,
  shook      = false,
}

local STEPS = {
  "1 REQUEST",
  "2 402 REQUIRED",
  "3 POLICY CHECK",
  "4 APPROVED",
  "5 USDC TRANSFER",
  "6 RECEIPT",
  "7 SUBMIT SIG",
  "8 VERIFY LOCAL",
  "9 DISPENSE",
}

local function now() return badge.sys.ms() end

local function load_totals()
  state.earned = badge.store.get_int(STORE_EARNED) or 0
  state.sales  = badge.store.get_int(STORE_SALES) or 0
end

local function save_totals()
  badge.store.set_int(STORE_EARNED, state.earned)
  badge.store.set_int(STORE_SALES, state.sales)
end

-- Foot traffic.
--
-- Counted as unique BLE advertisers per 5-minute bucket, NOT as unique
-- visitors. Modern phones rotate their MAC roughly every 15 minutes, so
-- counting unique MACs over a longer window over-reports badly (one person
-- lingering an hour reads as ~4). A sub-rotation bucket keeps the number
-- honest, and we label it an index rather than a headcount.
local function roll_bucket()
  local t = now()
  if state.bucket_at == 0 then state.bucket_at = t end
  if t - state.bucket_at >= BUCKET_SEC * 1000 then
    state.peers = {}
    state.peer_count = 0
    state.bucket_at = t
    collectgarbage("step")
  end
end

local function on_peer(mac)
  if not mac or state.peers[mac] then return end
  state.peers[mac] = now()
  state.peer_count = state.peer_count + 1
end

local function led_for_step(i)
  local n = badge.led.count and badge.led.count() or 0
  if n == 0 then return end
  badge.led.clear()
  local lit = math.max(1, math.floor(n * i / #STEPS))
  for j = 0, lit - 1 do
    badge.led.set(j, 0x5e, 0xd2, 0x9c)   -- VENDX accent
  end
  badge.led.show()
end

-- A sale advances the handshake animation and books the revenue.
local function record_sale(micro)
  state.earned = state.earned + (micro or 100)
  state.sales  = state.sales + 1
  save_totals()
  state.step = 1
  state.step_at = now()
end

function on_enter()
  load_totals()
  state.bucket_at = now()
  badge.sys.log("vendx: online, sales=" .. state.sales)
  if badge.radio and badge.radio.enable then
    badge.radio.enable()
    if badge.radio.on_recv then
      badge.radio.on_recv(function(from, msg)
        on_peer(from)
        -- A peer badge can buy this badge's telemetry directly over BLE.
        if msg == "VENDX?" and badge.radio.send then
          badge.radio.send(from, string.format("VENDX %d %d", state.peer_count, state.sales))
          record_sale(100)
        end
      end)
    end
  end
end

function on_exit()
  save_totals()
  if badge.radio and badge.radio.disable then badge.radio.disable() end
  if badge.led and badge.led.clear then badge.led.clear(); badge.led.show() end
  badge.sys.log("vendx: offline")
end

function on_recv(from, msg)
  on_peer(from)
end

function on_tick()
  roll_bucket()

  -- Shake is a manual "sell one" for demoing without a second badge.
  if badge.sensor and badge.sensor.shake and badge.sensor.shake() then
    if not state.shook then
      state.shook = true
      record_sale(100)
    end
  else
    state.shook = false
  end

  if state.step > 0 and now() - state.step_at > 350 then
    led_for_step(state.step)
    state.step = state.step + 1
    state.step_at = now()
    if state.step > #STEPS then
      state.step = 0
      if badge.led and badge.led.clear then badge.led.clear(); badge.led.show() end
    end
  end
end

function on_button(name, down)
  if not down then return end
  if name == "b" or name == "home" then
    badge.app.exit()
  elseif name == "a" then
    record_sale(100)   -- simulate a sale
  end
end
