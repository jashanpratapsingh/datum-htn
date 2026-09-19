-- VENDX sales log.
--
-- Complements vendx_nonces (0001). The relay currently keeps sales in an
-- in-memory array (relay-proxy/src/sales-log.ts); this table is the durable
-- store so /api/sales, /marketplace and /ledger survive a restart.
--
-- Server-side only — no RLS. Add RLS if you ever expose PostgREST publicly.

CREATE TABLE IF NOT EXISTS vendx_sales (
  id                 TEXT        PRIMARY KEY,
  nonce              TEXT        NOT NULL,
  amount_micro_usdc  TEXT        NOT NULL,
  timestamp          BIGINT      NOT NULL,
  tx_signature       TEXT        NOT NULL,
  source             TEXT        NOT NULL CHECK (source IN ('badge', 'simulator')),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vendx_sales_timestamp ON vendx_sales (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_vendx_sales_nonce ON vendx_sales (nonce);
