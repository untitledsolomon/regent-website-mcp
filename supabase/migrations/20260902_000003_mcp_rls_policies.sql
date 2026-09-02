-- Migration: RLS policies for MCP tables

-- Ensure only admins can access mcp_agents and mcp_call_log via the web UI.
-- The MCP server uses the Supabase service role key and bypasses RLS; these
-- policies apply to authenticated web users (dashboard/admins).

-- Revoke public if not already revoked
revoke all on table public.mcp_agents from public;
revoke all on table public.mcp_call_log from public;

-- Policy: only project admins (has_role helper) may select/insert/update/delete
create policy "mcp_agents_admins" on public.mcp_agents
  for all
  using ( has_role(auth.uid(), 'admin') )
  with check ( has_role(auth.uid(), 'admin') );

create policy "mcp_call_log_admins" on public.mcp_call_log
  for all
  using ( has_role(auth.uid(), 'admin') )
  with check ( has_role(auth.uid(), 'admin') );

-- Note: If your project uses a different helper than has_role, update these
-- policies in the Supabase dashboard or replace 'has_role(auth.uid(), 'admin')'
-- with the appropriate condition for your project.
