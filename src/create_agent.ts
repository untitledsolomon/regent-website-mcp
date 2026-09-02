import crypto from "crypto";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function main() {
  const name = process.argv[2];
  const scopesArg = process.argv[3] || "content:read,content:write";
  if (!name) {
    console.error("Usage: npm run create-agent -- \"Agent name\" \"scope1,scope2\"");
    process.exit(2);
  }
  const scopes = scopesArg.split(",").map((s) => s.trim()).filter(Boolean);
  const rawKey = `regent_mcp_sk_${crypto.randomBytes(48).toString("hex")}`;
  const hash = crypto.createHash("sha256").update(rawKey).digest("hex");

  const { data, error } = await supabase.from("mcp_agents").insert({
    name,
    api_key_hash: hash,
    scopes,
    created_at: new Date().toISOString(),
    revoked: false,
  }).select().maybeSingle();

  if (error) {
    console.error("Failed to create agent:", error.message);
    process.exit(1);
  }

  console.log("AGENT CREATED");
  console.log("Name:", name);
  console.log("ID:", data.id);
  console.log("Scopes:", scopes.join(","));
  console.log("");
  console.log("IMPORTANT: The API key below will only be shown now. Store it securely.");
  console.log("");
  console.log(rawKey);
  console.log("");
  console.log("Use this key as: Authorization: Bearer <key>");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});