-- A sale must never fail because of who it is attributed to. If the agent or
-- user id the relay was handed does not exist (deleted account, or a stale id
-- sent by the website), record the sale anonymously instead of refusing the
-- settlement the buyer has already paid for. Same signature as in 0003.
create or replace function vendx_record_settlement(
  p_tx_signature text, p_nonce text, p_relay_id text, p_device_id text, p_source text,
  p_amount_micro_usdc bigint, p_network text, p_payer text,
  p_agent_id uuid, p_user_id uuid, p_receipt text)
returns table (status text, prior_nonce text, prior_receipt text)
language plpgsql
as $$
declare
  v_agent uuid := p_agent_id;
  v_user  uuid := p_user_id;
begin
  -- Drop attribution that points nowhere rather than failing the insert.
  if v_agent is not null and not exists (select 1 from vendx_agents a where a.id = v_agent) then v_agent := null; end if;
  if v_user  is not null and not exists (select 1 from auth.users u where u.id = v_user)   then v_user  := null; end if;

  insert into vendx_used_signatures (tx_signature, nonce, relay_id)
    values (p_tx_signature, p_nonce, p_relay_id);
  insert into vendx_sales (id, nonce, relay_id, device_id, source, amount_micro_usdc, tx_signature,
                           network, payer, agent_id, user_id, receipt)
    values (p_nonce, p_nonce, p_relay_id, p_device_id, p_source, p_amount_micro_usdc, p_tx_signature,
            p_network, p_payer, v_agent, v_user, p_receipt);
  if v_agent is not null then
    update vendx_agents set last_used_at = now() where id = v_agent;
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
