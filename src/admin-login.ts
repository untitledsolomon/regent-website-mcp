import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";
import { supabase } from "./supabase.js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
// Any anon/publishable key works here - this client only ever calls
// signInWithPassword, which is a public auth endpoint by design. We
// intentionally do NOT use the service-role client for this, so a bad
// password just fails a normal login rather than running under a
// bypass-everything credential.
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing SUPABASE_ANON_KEY environment variable. Required for the OAuth " +
      "/authorize login screen to verify the admin's password via Supabase Auth. " +
      "Find it in Supabase dashboard -> Settings -> API -> Project API keys (anon/public)."
  );
}

const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Verifies email/password against Supabase Auth, then confirms the user
// carries the 'admin' role your project's RLS policies already rely on
// (see supabase/migrations - the admin role is checked via user_roles /
// has_role in this project's other policies). Returns an mcp_agents id to
// attach to issued tokens (scopes come from that agent record), or null on
// any failure.
export async function verifyAdminLoginAndGetAgentId(
  email: string,
  password: string
): Promise<string | null> {
  const { data, error } = await authClient.auth.signInWithPassword({ email, password });
  if (error || !data?.user) {
    return null;
  }

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", data.user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (roleErr) {
    console.error("Error checking admin role during OAuth login:", roleErr.message);
    return null;
  }
  if (!roleRow) return null;

  // Map the authenticated admin to (or create) a full-scope mcp_agents row
  // so issued tokens carry real scopes through the existing wrap-register
  // scope-enforcement path, rather than inventing a parallel auth model.
  const agentName = `oauth:${email}`;
  const { data: existing } = await supabase
    .from("mcp_agents")
    .select("id, revoked")
    .eq("name", agentName)
    .maybeSingle();

  if (existing && !existing.revoked) {
    return existing.id as string;
  }
  if (existing && existing.revoked) {
    return null; // explicitly revoked - do not silently re-grant
  }

  const { data: created, error: createErr } = await supabase
    .from("mcp_agents")
    .insert({
      name: agentName,
      // This login path is gated on the Supabase 'admin' role, so granting
      // full scope here mirrors the access that role already has via the
      // website's own admin dashboard - it is not escalating privilege.
      scopes: ["*"],
      // api_key_hash is NOT NULL in the existing schema but this agent is
      // only ever reached via OAuth, never via the static-key path, so a
      // random unusable placeholder is stored instead of a real key.
      api_key_hash: `oauth-only:${crypto.randomUUID()}`,
    })
    .select("id")
    .single();

  if (createErr || !created) {
    console.error("Failed to create mcp_agents row for OAuth admin:", createErr?.message);
    return null;
  }
  return created.id as string;
}
