import crypto from "crypto";
import { supabase } from "./supabase.js";

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
