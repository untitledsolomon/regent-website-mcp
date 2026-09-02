import { supabase } from "./supabase.js";

function isLikelySecretKey(key: string) {
  const lowered = key.toLowerCase();
  return (
    lowered.includes("password") ||
    lowered.includes("token") ||
    lowered.includes("secret") ||
    lowered.includes("api_key") ||
    lowered.includes("apikey") ||
    lowered.includes("key") ||
    lowered.includes("credential")
  );
}

function redactValue(key: string, value: unknown) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length > 1000) return value.slice(0, 1000) + "...[truncated]";
    return value;
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function sanitizeInputSummary(input: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(input)) {
    try {
      if (isLikelySecretKey(k)) out[k] = "[REDACTED]";
      else out[k] = redactValue(k, (input as any)[k]);
    } catch (err) {
      out[k] = "[UNSERIALIZABLE]";
    }
  }
  return out;
}

export async function logCallFireAndForget({
  agent_id,
  tool_name,
  input_summary,
  success,
  error_message,
  duration_ms,
}: {
  agent_id: string | null;
  tool_name: string;
  input_summary: Record<string, unknown>;
  success: boolean;
  error_message?: string | null;
  duration_ms?: number | null;
}) {
  // Fire-and-forget insert into mcp_call_log. Don't throw.
  try {
    await supabase.from("mcp_call_log").insert({
      agent_id,
      tool_name,
      input_summary,
      success,
      error_message: error_message ?? null,
      duration_ms: duration_ms ?? null,
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    // swallow errors but log to console for ops visibility
    console.error("Failed to write mcp_call_log", err);
  }
}
