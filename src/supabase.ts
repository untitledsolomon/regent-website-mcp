import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. " +
      "Set them in your MCP client config (see README) — never hardcode them in source."
  );
}

// Service-role client: bypasses RLS. This server is the trust boundary —
// anything with access to run this server has full read/write on the DB.
// Keep the key out of source control and restrict who can invoke these tools.
export const supabase: SupabaseClient = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  }
);

export function assertNoError<T>(
  result: { data: T; error: { message: string } | null },
  context: string
): T {
  if (result.error) {
    throw new Error(`${context}: ${result.error.message}`);
  }
  return result.data;
}
