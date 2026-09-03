import { VercelRequest, VercelResponse } from "@vercel/node";
import { exchangeAuthorizationCode, refreshTokenGrant, OAuthError } from "../../src/oauth.js";

// Vercel's default body parser only handles JSON; RFC 6749 4.1.3 requires
// this endpoint to accept application/x-www-form-urlencoded, so parse the
// raw body ourselves rather than relying on the framework default.
export const config = {
  api: { bodyParser: false },
};

async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseFormBody(raw: string): Record<string, string> {
  const params = new URLSearchParams(raw);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    res.status(415).json({
      error: "invalid_request",
      error_description: "Content-Type must be application/x-www-form-urlencoded",
    });
    return;
  }

  let body: Record<string, string>;
  try {
    const raw = await readRawBody(req);
    body = parseFormBody(raw);
  } catch (err) {
    res.status(400).json({ error: "invalid_request", error_description: "Failed to parse request body" });
    return;
  }

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");

  try {
    if (body.grant_type === "authorization_code") {
      const tokens = await exchangeAuthorizationCode({
        code: body.code,
        client_id: body.client_id,
        redirect_uri: body.redirect_uri,
        code_verifier: body.code_verifier,
      });
      res.status(200).json(tokens);
      return;
    }

    if (body.grant_type === "refresh_token") {
      const tokens = await refreshTokenGrant({
        refresh_token: body.refresh_token,
        client_id: body.client_id,
      });
      res.status(200).json(tokens);
      return;
    }

    res.status(400).json({ error: "unsupported_grant_type" });
  } catch (err: any) {
    if (err instanceof OAuthError) {
      // RFC 6749-compliant error codes so Claude's refresh logic can tell a
      // dead refresh token (invalid_grant) from a malformed request.
      res.status(400).json({ error: err.code, error_description: err.message });
      return;
    }
    console.error("Token endpoint error:", err);
    res.status(500).json({ error: "server_error" });
  }
}
