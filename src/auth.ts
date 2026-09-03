import crypto from "crypto";
import { supabase } from "./supabase.js";
import { validateAccessToken } from "./oauth.js";

export type AgentRecord = {
  id: string;
  name: string;
  scopes: string[];
  revoked: boolean;
  api_key_hash: string;
};

export async function findAgentByApiKey(apiKey: string): Promise<AgentRecord | null> {
  if (!apiKey) return null;
  const hash = crypto.createHash("sha256").update(apiKey).digest("hex");
  const { data, error } = await supabase
    .from("mcp_agents")
    .select("id, name, scopes, revoked, api_key_hash")
    .eq("api_key_hash", hash)
    .maybeSingle();
  if (error) {
    console.error("Error looking up agent by api key hash:", error.message);
    return null;
  }
  return data as AgentRecord | null;
}

async function findAgentById(agentId: string): Promise<AgentRecord | null> {
  const { data, error } = await supabase
    .from("mcp_agents")
    .select("id, name, scopes, revoked, api_key_hash")
    .eq("id", agentId)
    .maybeSingle();
  if (error) {
    console.error("Error looking up agent by id:", error.message);
    return null;
  }
  return data as AgentRecord | null;
}

// Unified credential resolver: accepts either a legacy static API key
// (regent_mcp_sk_...) or a Bearer access token issued by our own OAuth
// server (regent_at_...), so both auth paths funnel into the same
// mcp_agents-backed scope model. Returns null for anything invalid/expired
// rather than throwing - callers decide how to surface that as a 401.
export async function resolveAgentFromCredential(rawKey: string): Promise<AgentRecord | null> {
  if (!rawKey) return null;

  if (rawKey.startsWith("regent_at_")) {
    const validated = await validateAccessToken(rawKey);
    if (!validated || !validated.agent_id) return null;
    return findAgentById(validated.agent_id);
  }

  return findAgentByApiKey(rawKey);
}

export async function markAgentLastUsed(agentId: string) {
  try {
    await supabase
      .from("mcp_agents")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", agentId);
  } catch (err) {
    console.error("Failed to update agent last_used_at", err);
  }
}
