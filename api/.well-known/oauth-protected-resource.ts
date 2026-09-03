import { VercelRequest, VercelResponse } from "@vercel/node";
import { issuerUrl, mcpResourceUrl } from "../../src/oauth.js";

// RFC 9728 Protected Resource Metadata. Claude fetches this after receiving
// a 401 with a WWW-Authenticate: Bearer resource_metadata="..." header from
// /api/mcp, to discover which authorization server issues tokens for this
// resource.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: ["*"],
    bearer_methods_supported: ["header"],
  });
}
