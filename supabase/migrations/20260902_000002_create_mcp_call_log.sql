-- Migration: create mcp_call_log table

create table if not exists public.mcp_call_log (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid references public.mcp_agents(id) on delete set null,
  tool_name text not null,
  input_summary jsonb default '{}'::jsonb,
  success boolean not null,
  error_message text,
  created_at timestamptz not null default now(),
  duration_ms integer
);

revoke all on table public.mcp_call_log from public;

-- As with mcp_agents, leave RLS policy application to the project's
-- existing conventions. The README describes the RLS intent and manual steps.
