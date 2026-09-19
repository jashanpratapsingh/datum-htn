# VENDX feature plan

The hero sells the idea. These pages sell the product. Each is a real route in
`web/`, backed by real relay data where it exists and clearly labelled where it
does not.

## Routes

| Route | Page | What it proves |
| --- | --- | --- |
| `/` | Landing | The pitch, the hero, the live handshake |
| `/devices` | Device fleet | Every vending node: price, uptime, earnings, health |
| `/devices/[id]` | Device detail | One badge: live telemetry, its sales, its on-chain history |
| `/marketplace` | Data marketplace | Browse what is for sale, by metric and price |
| `/agent` | Agent console | Watch an AI buyer negotiate, pay and get data, live |
| `/policy` | Policy engine | The $5/day APEX budget, rules, and the denial log |
| `/ledger` | On-chain ledger | Settled payments, ZK-compressed batches, rent saved |
| `/protocol` | Protocol explorer | Inspect a real 402 challenge, X-PAYMENT and receipt |
| `/docs` | Docs | Links into the repo's markdown |

## Feature detail

### `/devices` — the fleet
Cards per node, each showing live `source: badge | simulator` so nobody mistakes
a simulated node for hardware. Sparkline of sales, current price, heap health,
last-seen. Sort by earnings. Empty state explains how to attach a badge.

### `/devices/[id]` — one node
The real payload from `badge-source.ts`: chip, free heap, largest block, LVGL
utilisation, BLE controller state, boot count, reset-reason histogram. Reset
reasons rendered as a small stacked bar — 51 of 85 boots being reason 11 is a
genuinely interesting signal about a badge's life.

### `/agent` — the money shot
A live pane where the buyer runs against the relay and every step of the
handshake lights up as it happens: challenge, policy decision, transfer,
receipt, verification, dispense. Replays the 9-step diagram from the README
against real events rather than a canned animation.

### `/policy` — the safety story
The APEX engine made legible: daily cap burning down, per-request and per-vendor
limits, and the denial log. Includes a deliberate "drain attempt" button that
loops purchases until the cap trips, so the guard is demonstrated rather than
asserted.

### `/ledger` — the rent argument
Settled signatures linked to Solscan devnet, plus the compression comparison:
what N telemetry batches would cost in standard Solana accounts versus
ZK-compressed state. The number is the reason the project exists.

### `/protocol` — inspectable
Paste or fetch a live 402 and decode it field by field; decode an `X-PAYMENT`
header and a signed receipt, showing which checks the device runs locally and
in what order. Teaches the protocol by letting people take it apart.

## Principles

- **Never fake live data.** If a value is simulated it says so, in the UI, every
  time. A demo that lies about provenance is worthless the moment someone looks.
- **Real events over canned animation.** The handshake animates because a
  payment happened, not on a timer.
- **Every page answers one question.** If a page has no question, it is not a page.
- Accessibility floor from `docs/FRONTEND_BRIEF.md` applies to all of them.
