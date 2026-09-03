import crypto from "crypto";
import { supabase } from "./supabase.js";

// ---------------------------------------------------------------------------
// Shared config
// ---------------------------------------------------------------------------

// The externally-visible base URL of this deployment. Must be set in Vercel
// env vars to the production domain (e.g. https://mcp.regentplatform.com)
// so metadata documents and issued URLs are correct regardless of which
// Vercel deployment URL actually served the request.
//
// Checked lazily (via a getter), not at module load: this module is
// imported transitively from src/wrap-register.ts, which is also used by
// the stdio entrypoint (src/index.ts) for local/Claude-Desktop use, where
// there is no OAuth server and MCP_PUBLIC_URL has no meaning. Only the
// HTTP OAuth endpoints (api/oauth/*, api/oauth-metadata/*, exposed at
// /.well-known/* via vercel.json rewrites) and the OAuth
// token-validation path actually need this value, so only they should
// throw when it's missing.
function getIssuerUrl(): string {
  const url = (process.env.MCP_PUBLIC_URL || "").replace(/\/$/, "");
  if (!url) {
    throw new Error(
      "Missing MCP_PUBLIC_URL environment variable. Set it to this server's " +
        "public base URL, e.g. https://mcp.regentplatform.com (no trailing slash)."
    );
  }
  return url;
}

export function issuerUrl(): string {
  return getIssuerUrl();
}

export function mcpResourceUrl(): string {
  return `${getIssuerUrl()}/api/mcp`;
}

export function authorizationEndpoint(): string {
  return `${getIssuerUrl()}/api/oauth/authorize`;
}

export function tokenEndpoint(): string {
  return `${getIssuerUrl()}/api/oauth/token`;
}

export function registrationEndpoint(): string {
  return `${getIssuerUrl()}/api/oauth/register`;
}

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

// Constant-time-ish compare for PKCE verifier check (both are hex/base64url
// strings of known length so timing leakage here is not a serious concern,
// but there's no reason not to be careful).
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// PKCE S256: BASE64URL(SHA256(code_verifier)) === code_challenge
function verifyPkce(codeVerifier: string, codeChallenge: string): boolean {
  const computed = crypto
    .createHash("sha256")
    .update(codeVerifier)
    .digest("base64url");
  return safeEqual(computed, codeChallenge);
}

// ---------------------------------------------------------------------------
// Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export type RegisteredClient = {
  client_id: string;
  client_name: string | null;
  redirect_uris: string[];
};

export async function registerClient(input: {
  redirect_uris: string[];
  client_name?: string;
}): Promise<RegisteredClient> {
  if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
    throw new OAuthError("invalid_client_metadata", "redirect_uris is required");
  }
  for (const uri of input.redirect_uris) {
    try {
      const parsed = new URL(uri);
      if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
        throw new Error("non-https");
      }
    } catch {
      throw new OAuthError("invalid_redirect_uri", `Invalid redirect_uri: ${uri}`);
    }
  }

  const { data, error } = await supabase
    .from("oauth_clients")
    .insert({
      client_name: input.client_name ?? null,
      redirect_uris: input.redirect_uris,
      // DCR registers Claude as a public client - no secret.
      client_secret_hash: null,
    })
    .select("client_id, client_name, redirect_uris")
    .single();

  if (error || !data) {
    throw new Error(`Failed to register client: ${error?.message}`);
  }

  return data as RegisteredClient;
}

export async function getClient(clientId: string) {
  const { data, error } = await supabase
    .from("oauth_clients")
    .select("client_id, client_name, redirect_uris, client_secret_hash")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) throw new Error(`Failed to look up client: ${error.message}`);
  return data;
}

// ---------------------------------------------------------------------------
// Authorization codes
// ---------------------------------------------------------------------------

export async function createAuthorizationCode(input: {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
  agent_id: string;
}): Promise<string> {
  const { data, error } = await supabase
    .from("oauth_codes")
    .insert({
      client_id: input.client_id,
      redirect_uri: input.redirect_uri,
      code_challenge: input.code_challenge,
      code_challenge_method: input.code_challenge_method || "S256",
      scope: input.scope ?? null,
      agent_id: input.agent_id,
    })
    .select("code")
    .single();

  if (error || !data) {
    throw new Error(`Failed to create authorization code: ${error?.message}`);
  }
  return data.code as string;
}

export class OAuthError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Exchanges an authorization_code grant for an access + refresh token pair.
// Verifies PKCE, redirect_uri match, single-use, and expiry.
export async function exchangeAuthorizationCode(input: {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_verifier: string;
}) {
  const { data: row, error } = await supabase
    .from("oauth_codes")
    .select("*")
    .eq("code", input.code)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up authorization code: ${error.message}`);
  if (!row) throw new OAuthError("invalid_grant", "Unknown or already-used authorization code");
  if (row.consumed_at) throw new OAuthError("invalid_grant", "Authorization code already used");
  if (new Date(row.expires_at).getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "Authorization code expired");
  }
  if (row.client_id !== input.client_id) {
    throw new OAuthError("invalid_grant", "client_id does not match authorization code");
  }
  if (row.redirect_uri !== input.redirect_uri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match authorization code");
  }
  if (!input.code_verifier || !verifyPkce(input.code_verifier, row.code_challenge)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed");
  }

  // Mark consumed immediately so a retried/replayed exchange can't succeed
  // twice, even if the rest of this function fails partway through.
  const { error: consumeErr } = await supabase
    .from("oauth_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("code", input.code)
    .is("consumed_at", null);
  if (consumeErr) throw new Error(`Failed to consume authorization code: ${consumeErr.message}`);

  return issueTokenPair({
    client_id: row.client_id,
    agent_id: row.agent_id,
    scope: row.scope,
  });
}

// ---------------------------------------------------------------------------
// Token issuance / refresh / validation
// ---------------------------------------------------------------------------

export type TokenPair = {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope?: string;
};

async function issueTokenPair(input: {
  client_id: string;
  agent_id: string | null;
  scope?: string | null;
  replacesTokenId?: string;
}): Promise<TokenPair> {
  const accessToken = `regent_at_${randomToken(32)}`;
  const refreshToken = `regent_rt_${randomToken(32)}`;
  const now = Date.now();

  const { data, error } = await supabase
    .from("oauth_tokens")
    .insert({
      client_id: input.client_id,
      agent_id: input.agent_id,
      access_token_hash: sha256Hex(accessToken),
      refresh_token_hash: sha256Hex(refreshToken),
      scope: input.scope ?? null,
      access_token_expires_at: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
      refresh_token_expires_at: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to issue tokens: ${error?.message}`);
  }

  if (input.replacesTokenId) {
    await supabase
      .from("oauth_tokens")
      .update({ revoked: true, revoked_at: new Date().toISOString(), replaced_by: data.id })
      .eq("id", input.replacesTokenId);
  }

  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: input.scope ?? undefined,
  };
}

export async function refreshTokenGrant(input: { refresh_token: string; client_id: string }): Promise<TokenPair> {
  const hash = sha256Hex(input.refresh_token);
  const { data: row, error } = await supabase
    .from("oauth_tokens")
    .select("*")
    .eq("refresh_token_hash", hash)
    .maybeSingle();

  if (error) throw new Error(`Failed to look up refresh token: ${error.message}`);
  if (!row) throw new OAuthError("invalid_grant", "Unknown refresh token");
  if (row.client_id !== input.client_id) throw new OAuthError("invalid_grant", "client_id mismatch");
  if (row.revoked) {
    // Reuse of an already-rotated-away refresh token: treat as compromise
    // and kill the whole chain by revoking anything issued after it too.
    throw new OAuthError("invalid_grant", "Refresh token has been revoked");
  }
  if (!row.refresh_token_expires_at || new Date(row.refresh_token_expires_at).getTime() < Date.now()) {
    throw new OAuthError("invalid_grant", "Refresh token expired");
  }

  return issueTokenPair({
    client_id: row.client_id,
    agent_id: row.agent_id,
    scope: row.scope,
    replacesTokenId: row.id,
  });
}

export type ValidatedToken = {
  agent_id: string | null;
  scope: string | null;
  client_id: string;
};

// Validates a raw Bearer access token from an incoming MCP request.
// Returns null (never throws) so callers can uniformly fall through to a
// 401 challenge - a malformed/expired/unknown token is not a server error.
export async function validateAccessToken(rawToken: string): Promise<ValidatedToken | null> {
  if (!rawToken) return null;
  const hash = sha256Hex(rawToken);
  const { data: row, error } = await supabase
    .from("oauth_tokens")
    .select("agent_id, scope, client_id, access_token_expires_at, revoked")
    .eq("access_token_hash", hash)
    .maybeSingle();

  if (error) {
    console.error("Error validating access token:", error.message);
    return null;
  }
  if (!row || row.revoked) return null;
  if (new Date(row.access_token_expires_at).getTime() < Date.now()) return null;

  return { agent_id: row.agent_id, scope: row.scope, client_id: row.client_id };
}
