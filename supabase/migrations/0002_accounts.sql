-- VENDX wallet accounts.
--
-- One row per Solana wallet that has signed in to the web app with Phantom
-- (Sign In With Solana). Written only from Next.js route handlers with the
-- service key (web/app/api/auth/verify); the browser never talks to this table.
-- RLS is enabled with no policies on purpose: the service role bypasses RLS,
-- the anon/publishable key gets nothing.
--
-- Roles are not stored. A wallet is a vendor when a relay lists a registered
-- device whose payTo is that wallet (web/lib/server/role.ts).

CREATE TABLE IF NOT EXISTS vendx_accounts (
  wallet       TEXT        PRIMARY KEY,               -- base58 Ed25519 public key
  first_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  login_count  INTEGER     NOT NULL DEFAULT 1,
  last_domain  TEXT,                                  -- SIWS domain line of the last login
  last_method  TEXT        CHECK (last_method IN ('signIn', 'signMessage'))
);

ALTER TABLE vendx_accounts ENABLE ROW LEVEL SECURITY;

-- Atomic touch-on-login. supabase-js upsert cannot express login_count + 1.
CREATE OR REPLACE FUNCTION vendx_touch_account(p_wallet TEXT, p_domain TEXT, p_method TEXT)
RETURNS vendx_accounts
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO vendx_accounts (wallet, last_domain, last_method)
  VALUES (p_wallet, p_domain, p_method)
  ON CONFLICT (wallet) DO UPDATE
    SET last_seen   = NOW(),
        login_count = vendx_accounts.login_count + 1,
        last_domain = EXCLUDED.last_domain,
        last_method = EXCLUDED.last_method
  RETURNING *;
$$;

REVOKE EXECUTE ON FUNCTION vendx_touch_account(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
