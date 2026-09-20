-- vendx_record_settlement looks up auth.users to drop dangling attribution.
-- The service role cannot read auth.users directly, so the function runs as
-- its owner with a pinned search_path. Execution rights are unchanged
-- (service_role only).
alter function vendx_record_settlement(text, text, text, text, text, bigint, text, text, uuid, uuid, text)
  security definer set search_path = public, auth;
