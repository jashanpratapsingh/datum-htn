-- Identity bridge: a Phantom (SIWS) wallet login and an email login are the
-- same kind of account.
--
-- vendx_agents.user_id, vendx_sales.user_id and everything that follows
-- reference auth.users. A wallet that signs in with Phantom therefore needs an
-- auth.users row too. web/lib/server/wallet-user.ts creates it on first login
-- (email `<wallet>@wallets.vendx.biz`, confirmed, user_metadata.wallet set) and
-- records the mapping here, then opens an ordinary Supabase session for it, so
-- RLS, the account page and the OAuth consent page see one kind of viewer.
--
-- Service role only, like the rest of vendx_accounts.

alter table vendx_accounts
  add column if not exists user_id uuid references auth.users (id) on delete set null;

create unique index if not exists idx_vendx_accounts_user on vendx_accounts (user_id) where user_id is not null;
