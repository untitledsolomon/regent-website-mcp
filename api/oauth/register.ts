import { VercelRequest, VercelResponse } from "@vercel/node";
import { registerClient, OAuthError } from "../../src/oauth.js";

// RFC 7591 Dynamic Client Registration. Claude POSTs here once per
// connector connection to obtain a client_id (public client, no secret -
// DCR clients are always public per the MCP auth spec). Request/response
// content type is application/json, unlike /oauth/token which is
// form-urlencoded.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "method_not_allowed" });
    return;
  }

  try {
    const body = (req as any).body || {};
    const client = await registerClient({
      redirect_uris: body.redirect_uris,
      client_name: body.client_name,
    });

    res.status(201).json({
      client_id: client.client_id,
      client_name: client.client_name,
      redirect_uris: client.redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  } catch (err: any) {
    if (err instanceof OAuthError) {
      res.status(400).json({ error: err.code, error_description: err.message });
      return;
    }
    console.error("DCR registration error:", err);
    res.status(500).json({ error: "server_error" });
  }
}
