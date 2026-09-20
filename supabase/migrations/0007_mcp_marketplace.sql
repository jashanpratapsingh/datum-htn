-- Remote MCP marketplace: agent wallets, spend caps, purchased readings and
-- the OAuth 2.1 grants that connect Claude Code / Codex / Cursor to it.
--
-- Conventions follow 0003: RLS on everywhere; tables the browser must never
-- read are service-role only (revoke from anon/authenticated, no policies);
-- anything that must be atomic is a security-definer function granted to
-- service_role alone.

-- ---------------------------------------------------------------------------
-- Agents gain a budget policy and a wallet.
--
-- The TOTAL budget is the on-chain USDC balance of the agent's wallet; the
-- columns here are the caps the owner set on the consent page. spent_* are
-- running totals for the dashboard, maintained by vendx_commit_spend.
-- ---------------------------------------------------------------------------
alter table vendx_agents
  add column if not exists daily_cap_micro_usdc       bigint,
  add column if not exists per_request_cap_micro_usdc bigint not null default 100000,
  add column if not exists spent_micro_usdc           bigint not null default 0,
  add column if not exists wallet_pubkey              text,
  add column if not exists created_via                text not null default 'key',
  add column if not exists client_name                text;
alter table vendx_agents drop constraint if exists vendx_agents_created_via_check;
alter table vendx_agents add constraint vendx_agents_created_via_check check (created_via in ('key', 'oauth'));

grant select (daily_cap_micro_usdc, per_request_cap_micro_usdc, spent_micro_usdc, wallet_pubkey, created_via, client_name)
  on vendx_agents to authenticated;
-- Owners may edit their own caps (policy agents_owner_update from 0003 scopes it).
grant update (daily_cap_micro_usdc, per_request_cap_micro_usdc) on vendx_agents to authenticated;

-- ---------------------------------------------------------------------------
-- Agent wallets: one custodial Solana keypair per agent. The secret key is
-- AES-256-GCM under VENDX_WALLET_KEK (web/lib/wallet/keystore.ts); kek_id
-- names the key it was sealed with so a rotation can re-seal rows.
-- ---------------------------------------------------------------------------
create table if not exists vendx_agent_wallets (
  agent_id   uuid primary key references vendx_agents (id) on delete cascade,
  pubkey     text not null unique,
  secret_enc bytea not null,
  kek_id     text not null,
  created_at timestamptz not null default now()
);
alter table vendx_agent_wallets enable row level security;
revoke all on vendx_agent_wallets from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Spend reservations: the cap check and the race guard for parallel tool calls.
-- reserve → (pay) → commit, or release. Reservations older than expires_at
-- from a killed invocation are released lazily by the next reserve.
-- ---------------------------------------------------------------------------
create table if not exists vendx_spend_reservations (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid not null references vendx_agents (id) on delete cascade,
  amount_micro_usdc bigint not null check (amount_micro_usdc > 0),
  status            text not null check (status in ('reserved', 'committed', 'released')),
  day               date not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  committed_at      timestamptz,
  tx_signature      text,
  sale_id           text,
  reason            text
);
create index if not exists idx_vendx_reservations_agent_day on vendx_spend_reservations (agent_id, day, status);
alter table vendx_spend_reservations enable row level security;
revoke all on vendx_spend_reservations from anon, authenticated;

create or replace function vendx_reserve_spend(p_agent_id uuid, p_amount bigint, p_now timestamptz default now())
returns table (status text, reservation_id uuid, remaining_today bigint, spent_today bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  a       vendx_agents%rowtype;
  v_day   date := (p_now at time zone 'utc')::date;
  v_today bigint;
  v_id    uuid;
begin
  -- The row lock serialises concurrent reservations for one agent.
  select * into a from vendx_agents ag where ag.id = p_agent_id for update;
  if not found then
    return query select 'agent_unknown'::text, null::uuid, 0::bigint, 0::bigint; return;
  end if;
  if a.revoked_at is not null then
    return query select 'agent_revoked'::text, null::uuid, 0::bigint, 0::bigint; return;
  end if;

  update vendx_spend_reservations r set status = 'released', reason = 'expired'
    where r.agent_id = p_agent_id and r.status = 'reserved' and r.expires_at < p_now;

  select coalesce(sum(r.amount_micro_usdc), 0) into v_today
    from vendx_spend_reservations r
    where r.agent_id = p_agent_id and r.day = v_day and r.status <> 'released';

  if p_amount <= 0 or p_amount > a.per_request_cap_micro_usdc then
    return query select 'per_request_cap'::text, null::uuid,
      case when a.daily_cap_micro_usdc is null then null else greatest(a.daily_cap_micro_usdc - v_today, 0) end, v_today;
    return;
  end if;
  if a.daily_cap_micro_usdc is not null and v_today + p_amount > a.daily_cap_micro_usdc then
    return query select 'daily_cap'::text, null::uuid, greatest(a.daily_cap_micro_usdc - v_today, 0), v_today;
    return;
  end if;

  insert into vendx_spend_reservations (agent_id, amount_micro_usdc, status, day, expires_at)
    values (p_agent_id, p_amount, 'reserved', v_day, p_now + interval '2 minutes')
    returning id into v_id;
  return query select 'ok'::text, v_id,
    case when a.daily_cap_micro_usdc is null then null else a.daily_cap_micro_usdc - v_today - p_amount end,
    v_today + p_amount;
end
$$;
revoke execute on function vendx_reserve_spend(uuid, bigint, timestamptz) from public, anon, authenticated;
grant  execute on function vendx_reserve_spend(uuid, bigint, timestamptz) to service_role;

-- Money left the wallet: the reservation becomes a committed spend. Locks the
-- agent row FIRST (same order as reserve) so the two never deadlock.
create or replace function vendx_commit_spend(p_reservation_id uuid, p_tx_signature text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent uuid;
  r vendx_spend_reservations%rowtype;
begin
  select res.agent_id into v_agent from vendx_spend_reservations res where res.id = p_reservation_id;
  if v_agent is null then return 'unknown'; end if;
  perform 1 from vendx_agents ag where ag.id = v_agent for update;
  select * into r from vendx_spend_reservations res where res.id = p_reservation_id for update;
  if r.status <> 'reserved' then return r.status; end if;
  update vendx_spend_reservations res
    set status = 'committed', committed_at = now(), tx_signature = p_tx_signature
    where res.id = p_reservation_id;
  update vendx_agents ag
    set spent_micro_usdc = ag.spent_micro_usdc + r.amount_micro_usdc, last_used_at = now()
    where ag.id = v_agent;
  return 'committed';
end
$$;
revoke execute on function vendx_commit_spend(uuid, text) from public, anon, authenticated;
grant  execute on function vendx_commit_spend(uuid, text) to service_role;

create or replace function vendx_release_spend(p_reservation_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  r vendx_spend_reservations%rowtype;
begin
  select * into r from vendx_spend_reservations res where res.id = p_reservation_id for update;
  if not found then return 'unknown'; end if;
  if r.status <> 'reserved' then return r.status; end if;
  update vendx_spend_reservations res set status = 'released', reason = p_reason where res.id = p_reservation_id;
  return 'released';
end
$$;
revoke execute on function vendx_release_spend(uuid, text) from public, anon, authenticated;
grant  execute on function vendx_release_spend(uuid, text) to service_role;

-- Tie a committed reservation to the sale row the relay wrote.
create or replace function vendx_link_spend_sale(p_reservation_id uuid, p_sale_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update vendx_spend_reservations res set sale_id = p_sale_id where res.id = p_reservation_id;
$$;
revoke execute on function vendx_link_spend_sale(uuid, text) from public, anon, authenticated;
grant  execute on function vendx_link_spend_sale(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Readings an agent bought: the buyer's own history, charted on the dashboard.
-- metric/value are extracted at write time (activity = footTraffic or the
-- ESP32 node's ble_advertisers_per_5min value); payload keeps everything.
-- ---------------------------------------------------------------------------
create table if not exists vendx_readings (
  id                uuid primary key default gen_random_uuid(),
  agent_id          uuid references vendx_agents (id) on delete set null,
  user_id           uuid references auth.users (id) on delete set null,
  sale_id           text,
  relay_id          text,
  device_id         text,
  source            text not null check (source in ('badge', 'simulator', 'esp32c3')),
  metric            text,
  value             numeric,
  payload           jsonb not null,
  amount_micro_usdc bigint not null,
  tx_signature      text,
  fetched_at        timestamptz not null default now()
);
create index if not exists idx_vendx_readings_user   on vendx_readings (user_id, fetched_at desc);
create index if not exists idx_vendx_readings_agent  on vendx_readings (agent_id, device_id, fetched_at desc);
alter table vendx_readings enable row level security;
revoke all on vendx_readings from anon, authenticated;
grant select on vendx_readings to authenticated;
drop policy if exists readings_owner_read on vendx_readings;
create policy readings_owner_read on vendx_readings for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- OAuth 2.1 authorization server state (web/app/api/oauth/*).
-- Codes and tokens are stored as sha256 hex only, like vendx_agents.key_hash.
-- ---------------------------------------------------------------------------
create table if not exists vendx_oauth_clients (
  client_id                  text primary key,
  client_name                text,
  redirect_uris              text[] not null,
  token_endpoint_auth_method text not null default 'none',
  grant_types                text[] not null default array['authorization_code', 'refresh_token'],
  software_id                text,
  created_at                 timestamptz not null default now(),
  last_used_at               timestamptz
);
alter table vendx_oauth_clients enable row level security;
revoke all on vendx_oauth_clients from anon, authenticated;

create table if not exists vendx_oauth_codes (
  code_hash             text primary key,
  client_id             text not null references vendx_oauth_clients (client_id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,
  agent_id              uuid not null references vendx_agents (id) on delete cascade,
  redirect_uri          text not null,
  code_challenge        text not null,
  code_challenge_method text not null check (code_challenge_method = 'S256'),
  scope                 text,
  resource              text,
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null,
  used_at               timestamptz
);
alter table vendx_oauth_codes enable row level security;
revoke all on vendx_oauth_codes from anon, authenticated;

create table if not exists vendx_oauth_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  kind         text not null check (kind in ('access', 'refresh')),
  client_id    text not null references vendx_oauth_clients (client_id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  agent_id     uuid not null references vendx_agents (id) on delete cascade,
  scope        text,
  family_id    uuid not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
create index if not exists idx_vendx_oauth_tokens_agent  on vendx_oauth_tokens (agent_id, kind, created_at desc);
create index if not exists idx_vendx_oauth_tokens_family on vendx_oauth_tokens (family_id);
alter table vendx_oauth_tokens enable row level security;
revoke all on vendx_oauth_tokens from anon, authenticated;
-- Owners may see which clients are connected (never the hashes).
grant select (id, kind, client_id, agent_id, scope, created_at, expires_at, revoked_at, last_used_at) on vendx_oauth_tokens to authenticated;
drop policy if exists oauth_tokens_owner_read on vendx_oauth_tokens;
create policy oauth_tokens_owner_read on vendx_oauth_tokens for select to authenticated using (user_id = auth.uid());

-- An agent created from the consent page: no API key is minted (created_via
-- 'oauth'); key_hash gets an unguessable placeholder so the unique, not-null
-- column is satisfied and can never match a real key.
create or replace function vendx_create_agent_oauth(
  p_user_id uuid, p_name text, p_client_name text, p_daily_cap bigint, p_per_request_cap bigint)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_id uuid;
begin
  insert into vendx_agents (user_id, name, key_prefix, key_hash, created_via, client_name, daily_cap_micro_usdc, per_request_cap_micro_usdc)
    values (p_user_id, p_name, 'oauth', 'oauth:' || encode(extensions.gen_random_bytes(32), 'hex'), 'oauth', p_client_name, p_daily_cap, p_per_request_cap)
    returning id into v_id;
  return v_id;
end
$$;
revoke execute on function vendx_create_agent_oauth(uuid, text, text, bigint, bigint) from public, anon, authenticated;
grant  execute on function vendx_create_agent_oauth(uuid, text, text, bigint, bigint) to service_role;
