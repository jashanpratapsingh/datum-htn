-- VENDX nonce store.
--
-- The relay-proxy (facilitator) mints one nonce per 402 challenge and burns
-- it on first settlement. The in-process Map in relay-proxy/src/index.js is
-- the demo equivalent; this table is the production store.
--
-- Only the relay-proxy service account should write here. Row-level security
-- is intentionally omitted — this is a server-side internal table, not a
-- user-facing one. Add RLS if you expose it through the PostgREST API.

CREATE TABLE IF NOT EXISTS vendx_nonces (
  nonce        TEXT        PRIMARY KEY,
  expires_at   BIGINT      NOT NULL,
  used_at      BIGINT,
  device_id    TEXT        NOT NULL,
  network      TEXT        NOT NULL DEFAULT 'solana-devnet',
  pay_to       TEXT        NOT NULL,
  amount       TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast expiry sweep: the relay-proxy purges rows where expires_at < now().
CREATE INDEX IF NOT EXISTS idx_vendx_nonces_expires ON vendx_nonces (expires_at);

-- The relay-proxy queries by nonce and device_id together to guard against
-- cross-device replay.
CREATE INDEX IF NOT EXISTS idx_vendx_nonces_device ON vendx_nonces (device_id, nonce);
