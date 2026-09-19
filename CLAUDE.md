# This is a personal machine

Owner: **Jashan Pratap Singh**. Not a work machine. Two standing rules, no exceptions:

1. **Every git command, commit, and remote uses the personal identity** —
   `Jashan Pratap Singh <jashanpratap123@gmail.com>` (or
   `88160290+jashanpratapsingh@users.noreply.github.com`), GitHub account
   `jashanpratapsingh`. The work identity — `jashansinghTT`,
   `jashansingh@tenstorrent.com`, anything `tenstorrent` — must never appear in
   a commit, a config, a remote, or a credential here.

2. **Never call a claude.ai connector** (`mcp__claude_ai_*`: Glean, Gmail,
   Slack, Atlassian, Drive, Calendar, Figma, Canva). They are work tooling. No
   work email, documents, tickets, or repositories are handled on this machine —
   if a task needs them, say so and stop.

Both are enforced by `PreToolUse` hooks; see the **personal-machine-guard**
skill for the full rules, the contamination already on disk, and how to check.

---

# VENDX project rules

## Toolchain

Homebrew's `node` is broken on this machine (`dyld: libicui18n.77.dylib not
found`). **Every** node/npm/npx/vercel/supabase command must be prefixed:

```sh
export PATH="$HOME/.nvm/versions/node/v22.23.2/bin:$PATH"
```

## The wire format has one home

`packages/vendx-protocol` is the single source of truth for the 402 challenge,
the `X-PAYMENT` header and the signed receipt. Import it. Do not redefine these
shapes in `agent-buyer`, `relay-proxy` or `web`. The C++ mirror in
`firmware-vendor/src/verifier.cpp` is the one exception, and it carries a
comment pointing back here.

We implement **canonical x402 v1**, deliberately not `@x402-solana/*` — see
`docs/PROTOCOL.md` for why. Do not "fix" this by adding those packages back.

## Never invent an API

If you are unsure of a library's surface, read its `.d.ts` in `node_modules` or
its docs. A confidently-called function that does not exist is the most
expensive mistake available here.

## Design skills

`frontend-design` and `ui-ux-pro-max` are both enabled and they contradict each
other. **`frontend-design` wins on conflict.** Use `ui-ux-pro-max` as a lookup
for font pairings, a11y rules and GSAP presets — not as a style oracle.

## Commits

Conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`). Work
happens on `feat/vendx-architecture-gamma`, never directly on `main`.

## Honesty about what runs

A real **Hack the North ESP32-C3 badge** is attached at `/dev/cu.usbmodem101`.
`relay-proxy` reads genuine telemetry from it over the serial console, so the
demo returns `source: "badge"` when it is plugged in and `source: "simulator"`
when it is not. Every payload carries that field — always surface it, and never
present a simulated reading as hardware.

Read `docs/BADGE.md` before touching the badge. Two hard rules:

- **Never reflash or erase it.** No `write_flash`, no `erase_flash`, no
  `pio run -t upload` against it. Read-only probing only; it is the user's
  conference badge and the factory firmware must survive.
- **Never read `identity.json` or `solana.json` into anything.** They hold
  personal contact details and a plaintext Solana private key. They are not
  telemetry, they are not test fixtures, and they never get committed.

`firmware-vendor/` is our own ESP32 firmware and is compile-only — it is not
what runs on the badge. Never report a deploy, a test pass or an on-chain
settlement that did not actually happen.
