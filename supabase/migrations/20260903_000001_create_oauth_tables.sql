-- Migration: OAuth 2.1 (with Dynamic Client Registration) tables for the
-- MCP server, so remote clients like Claude.ai can authenticate without a
-- pre-shared static bearer token.
--
-- This backs three endpoints:
--   POST /api/oauth/register   - RFC 7591 Dynamic Client Registration
--   GET  /api/oauth/authorize  - user-facing consent/login screen
--   POST /api/oauth/token      - authorization_code and refresh_token grants
--
-- All three tables are only ever touched by the server-side service-role
-- client (never exposed to RLS-bypassing anon/authenticated roles), same
-- trust model as mcp_agents / mcp_call_log.

-- Clients registered via Dynamic Client Registration (RFC 7591). Claude
-- registers a new client the first time a user connects a given
-- organization's connector to this server.
create table if not exists public.oauth_clients (
  client_id text primary key default encode(gen_random_bytes(24), 'hex'),
  client_secret_hash text, -- null for public clients (DCR always registers Claude as public)
  client_name text,
  redirect_uris text[] not null,
  created_at timestamptz not null default now()
);

revoke all on table public.oauth_clients from public;

-- Short-lived authorization codes issued by /authorize, exchanged once at
-- /token. Includes the PKCE challenge Claude always sends, and expires in
-- minutes, not hours.
create table if not exists public.oauth_codes (
  code text primary key default encode(gen_random_bytes(32), 'hex'),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scope text,
  agent_id uuid references public.mcp_agents(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz
);

revoke all on table public.oauth_codes from public;

-- Issued access + refresh tokens. We store hashes only, never the raw
-- token, same pattern as mcp_agents.api_key_hash. Access tokens are
-- short-lived; refresh tokens are longer-lived and rotated on use per the
-- MCP auth spec's public-client rotation requirement.
create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  agent_id uuid references public.mcp_agents(id),
  access_token_hash text not null,
  refresh_token_hash text,
  scope text,
  access_token_expires_at timestamptz not null,
  refresh_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  revoked boolean not null default false,
  revoked_at timestamptz,
  -- when a refresh rotates, the old row is marked consumed and points at
  -- the row that replaced it, so a reused/stolen old refresh token can be
  -- detected and the whole chain revoked.
  replaced_by uuid references public.oauth_tokens(id)
);

revoke all on table public.oauth_tokens from public;

create index if not exists oauth_tokens_access_hash_idx on public.oauth_tokens(access_token_hash);
create index if not exists oauth_tokens_refresh_hash_idx on public.oauth_tokens(refresh_token_hash);
create index if not exists oauth_codes_expires_idx on public.oauth_codes(expires_at);

-- As with mcp_agents/mcp_call_log: RLS policies restricting dashboard
-- access to admins should be added via the Supabase dashboard/SQL editor
-- to match this project's existing role-check helper (see README).
