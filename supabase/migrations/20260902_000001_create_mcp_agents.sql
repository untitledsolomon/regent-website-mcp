-- Migration: create mcp_agents table

create table if not exists public.mcp_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  api_key_hash text not null,
  scopes text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked boolean not null default false,
  revoked_at timestamptz
);

-- RLS: only admins may read/write. We'll create a policy that requires the
-- invoking user to have the admin role via has_role(current_setting('jwt.claims.sub', true), 'admin')
-- but since server-side service-role key is used for MCP server, make sure
-- only authenticated admin users via supabase UI can use the dashboard.

-- Deny public
revoke all on table public.mcp_agents from public;

-- Note: create policies but adapt to your site's role system. These are
-- placeholders showing intent; adjust as needed in Supabase dashboard.

-- Allow service role (bypassed by service role key) and admin authenticated users
-- Example policy for read (replace with your project's admin check if different):
-- create policy "admin_read" on public.mcp_agents for select using (
--   has_role(auth.uid(), 'admin')
-- );

-- For now, leave RLS policies to be applied via Supabase dashboard if the
-- project's role helper is different. See README for manual steps.
