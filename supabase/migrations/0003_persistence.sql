-- VENDX persistence.
--
-- Everything the relay must not forget across a restart, plus the agent /
-- API-key directory the website writes. The relay-proxy is the only writer of
-- nonces, signatures, sales, relays and devices (service-role key). The
-- website reads public views with the publishable key and the caller's own
-- rows through RLS. See docs/ARCHITECTURE.md "Supabase".

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- nonces: scope the existing table to the relay that issued each nonce.
-- ---------------------------------------------------------------------------
alter table vendx_nonces add column if not exists relay_id text not null default '';
create index if not exists idx_vendx_nonces_relay on vendx_nonces (relay_id, nonce);
alter table vendx_nonces enable row level security;          -- no policies: service role only
revoke all on vendx_nonces from anon, authenticated;

-- ---------------------------------------------------------------------------
-- relays: one row per relay process identity (its facilitator public key).
-- ---------------------------------------------------------------------------
create table if not exists vendx_relays (
  id                  text primary key,                    -- facilitator Ed25519 pubkey, hex
  label               text not null,
  public_url          text not null,
  vendor_wallet       text not null,
  network             text not null default 'solana-devnet',
  settlement          text not null check (settlement in ('verify', 'trust')),
  facilitator_pubkey  text not null,                       -- same key, base64url (what receipts verify against)
  version             text,
  first_seen          timestamptz not null default now(),
  last_seen           timestamptz not null default now()
);
create index if not exists idx_vendx_relays_last_seen on vendx_relays (last_seen desc);

-- ---------------------------------------------------------------------------
-- devices: what each relay is selling right now. Liveness is derived by
-- readers from last_seen, never stored.
-- ---------------------------------------------------------------------------
create table if not exists vendx_devices (
  relay_id          text not null references vendx_relays (id) on delete cascade,
  id                text not null,                          -- deviceId, e.g. esp32-sim-001, htn-badge-<hash>
  source            text not null check (source in ('badge', 'simulator', 'esp32c3')),
  label             text,
  resource          text not null default '/api/telemetry',
  price_micro_usdc  bigint not null,
  pay_to            text not null,
  network           text not null default 'solana-devnet',
  chip              text,
  url               text,                                   -- esp32c3 node URL (follow-up)
  heartbeat_sec     integer,                                -- esp32c3 (follow-up)
  stats             jsonb,                                  -- non-personal snapshot: freeHeap, largestBlock, badgeState, ageSeconds
  first_seen        timestamptz not null default now(),
  last_seen         timestamptz not null default now(),
  primary key (relay_id, id)
);
create index if not exists idx_vendx_devices_last_seen on vendx_devices (last_seen desc);

-- ---------------------------------------------------------------------------
-- agents: API keys minted on the website. The key itself is never stored.
-- ---------------------------------------------------------------------------
create table if not exists vendx_agents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  name          text not null check (length(name) between 1 and 64),
  key_prefix    text not null,                              -- left(key, 17): 'vendx_sk_' + 8 chars, for display
  key_hash      text not null unique,                       -- sha256 hex of the full key
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);
create index if not exists idx_vendx_agents_user on vendx_agents (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- used tx signatures: one Solana transaction buys exactly one receipt, globally.
-- ---------------------------------------------------------------------------
create table if not exists vendx_used_signatures (
  tx_signature  text primary key,
  nonce         text not null,
  relay_id      text not null,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- sales
-- ---------------------------------------------------------------------------
create table if not exists vendx_sales (
  id                 text primary key,                      -- = nonce
  nonce              text not null,
  relay_id           text not null,                         -- no FK: a sale must never fail because a heartbeat has not landed
  device_id          text,
  source             text not null check (source in ('badge', 'simulator', 'esp32c3')),
  amount_micro_usdc  bigint not null,
  tx_signature       text not null,
  network            text not null default 'solana-devnet',
  payer              text,                                  -- buyer wallet from the parsed tx; 'unverified' in trust mode
  agent_id           uuid references vendx_agents (id) on delete set null,
  user_id            uuid references auth.users (id) on delete set null,
  receipt            text,                                  -- bearer token until redeemed: owner-only, never public
  settled_at         timestamptz not null default now()
);
create index if not exists idx_vendx_sales_settled on vendx_sales (settled_at desc);
create index if not exists idx_vendx_sales_relay   on vendx_sales (relay_id, settled_at desc);
create index if not exists idx_vendx_sales_agent   on vendx_sales (agent_id, settled_at desc);
create index if not exists idx_vendx_sales_user    on vendx_sales (user_id, settled_at desc);

-- ---------------------------------------------------------------------------
-- Row-level security and grants.
-- ---------------------------------------------------------------------------
alter table vendx_relays          enable row level security;
alter table vendx_devices         enable row level security;
alter table vendx_agents          enable row level security;
alter table vendx_used_signatures enable row level security;
alter table vendx_sales           enable row level security;

-- Directory: public.
revoke all on vendx_relays, vendx_devices from anon, authenticated;
grant select on vendx_relays, vendx_devices to anon, authenticated;
create policy relays_public_read  on vendx_relays  for select to anon, authenticated using (true);
create policy devices_public_read on vendx_devices for select to anon, authenticated using (true);

-- Signatures: service role only.
revoke all on vendx_used_signatures from anon, authenticated;

-- Sales: owners read their own rows in full (including the receipt); everyone
-- else reads the public view below, which omits buyer identity and receipts.
revoke all on vendx_sales from anon, authenticated;
grant select on vendx_sales to authenticated;
create policy sales_owner_read on vendx_sales for select to authenticated using (user_id = auth.uid());

create or replace view vendx_sales_public with (security_invoker = false) as
  select id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature, network, payer,
         (agent_id is not null) as attributed,
         (user_id is not null)  as via_account,
         settled_at
  from vendx_sales;
grant select on vendx_sales_public to anon, authenticated;

-- Agents: owner-only, and key_hash is not readable by any client role. Column
-- privileges are additive with table privileges, so the table-level SELECT is
-- revoked and only the safe columns are granted back.
revoke all on vendx_agents from anon, authenticated;
grant select (id, user_id, name, key_prefix, created_at, last_used_at, revoked_at) on vendx_agents to authenticated;
grant update (revoked_at) on vendx_agents to authenticated;
grant delete on vendx_agents to authenticated;
create policy agents_owner_select on vendx_agents for select to authenticated using (user_id = auth.uid());
create policy agents_owner_update on vendx_agents for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy agents_owner_delete on vendx_agents for delete to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Functions. The relay calls the first two with the service role; the website
-- calls vendx_create_agent as the signed-in user.
-- ---------------------------------------------------------------------------

-- Atomic single-use burn, scoped to the issuing relay. p_now is the relay's
-- clock (unix seconds) so the relay and the database never disagree on expiry.
create or replace function vendx_consume_nonce(p_nonce text, p_relay_id text, p_now bigint)
returns table (status text, expires_at bigint, pay_to text, amount text, device_id text, network text)
language plpgsql
as $$
declare
  r vendx_nonces%rowtype;
begin
  select * into r from vendx_nonces n where n.nonce = p_nonce and n.relay_id = p_relay_id for update;
  if not found then
    return query select 'nonce_unknown'::text, null::bigint, null::text, null::text, null::text, null::text;
    return;
  end if;
  if r.used_at is not null then
    return query select 'nonce_replayed'::text, r.expires_at, r.pay_to, r.amount, r.device_id, r.network;
    return;
  end if;
  if r.expires_at < p_now then
    return query select 'nonce_expired'::text, r.expires_at, r.pay_to, r.amount, r.device_id, r.network;
    return;
  end if;
  update vendx_nonces set used_at = p_now where nonce = p_nonce;
  return query select 'ok'::text, r.expires_at, r.pay_to, r.amount, r.device_id, r.network;
end
$$;
revoke execute on function vendx_consume_nonce(text, text, bigint) from public, anon, authenticated;
grant  execute on function vendx_consume_nonce(text, text, bigint) to service_role;

-- Claim the transaction signature and record the sale in one transaction, so a
-- signed receipt can never exist without its sale row. On a conflict it says
-- which uniqueness tripped and returns the earlier receipt, so a retry of the
-- same (nonce, tx) is idempotent.
create or replace function vendx_record_settlement(
  p_tx_signature text, p_nonce text, p_relay_id text, p_device_id text, p_source text,
  p_amount_micro_usdc bigint, p_network text, p_payer text,
  p_agent_id uuid, p_user_id uuid, p_receipt text)
returns table (status text, prior_nonce text, prior_receipt text)
language plpgsql
as $$
begin
  insert into vendx_used_signatures (tx_signature, nonce, relay_id)
    values (p_tx_signature, p_nonce, p_relay_id);
  insert into vendx_sales (id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature,
                           network, payer, agent_id, user_id, receipt)
    values (p_nonce, p_nonce, p_relay_id, p_device_id, p_source, p_amount_micro_usdc, p_tx_signature,
            p_network, p_payer, p_agent_id, p_user_id, p_receipt);
  if p_agent_id is not null then
    update vendx_agents set last_used_at = now() where id = p_agent_id;
  end if;
  return query select 'ok'::text, null::text, null::text;
exception when unique_violation then
  if exists (select 1 from vendx_used_signatures u where u.tx_signature = p_tx_signature) then
    return query select 'signature_reused'::text, s.nonce, s.receipt
      from vendx_sales s where s.tx_signature = p_tx_signature limit 1;
  else
    return query select 'nonce_already_settled'::text, s.nonce, s.receipt
      from vendx_sales s where s.id = p_nonce;
  end if;
end
$$;
revoke execute on function vendx_record_settlement(text, text, text, text, text, bigint, text, text, uuid, uuid, text) from public, anon, authenticated;
grant  execute on function vendx_record_settlement(text, text, text, text, text, bigint, text, text, uuid, uuid, text) to service_role;

-- Mint an API key for the signed-in user. The plaintext is returned exactly
-- once; only its sha256 is stored. Format: 'vendx_sk_' + base64url(32 bytes).
create or replace function vendx_create_agent(p_name text)
returns table (id uuid, name text, key text, key_prefix text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_key text;
  v_row vendx_agents%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  v_key := 'vendx_sk_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into vendx_agents (user_id, name, key_prefix, key_hash)
    values (auth.uid(), p_name, left(v_key, 17), encode(sha256(convert_to(v_key, 'UTF8')), 'hex'))
    returning * into v_row;
  return query select v_row.id, v_row.name, v_key, v_row.key_prefix, v_row.created_at;
end
$$;
revoke execute on function vendx_create_agent(text) from public, anon;
grant  execute on function vendx_create_agent(text) to authenticated, service_role;
