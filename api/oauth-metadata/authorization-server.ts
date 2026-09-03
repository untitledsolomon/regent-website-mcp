import { VercelRequest, VercelResponse } from "@vercel/node";
import {
  issuerUrl,
  authorizationEndpoint,
  tokenEndpoint,
  registrationEndpoint,
} from "../../src/oauth.js";

// RFC 8414 Authorization Server Metadata. Tells Claude where to send
// registration, authorize, and token requests, and that this server
// supports DCR + PKCE S256 as required by the MCP authorization spec.
//
// See protected-resource.ts in this directory for why this isn't under
// api/.well-known/ directly - vercel.json rewrites the public
// /.well-known/oauth-authorization-server URL to this file.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    issuer: issuerUrl(),
    authorization_endpoint: authorizationEndpoint(),
    token_endpoint: tokenEndpoint(),
    registration_endpoint: registrationEndpoint(),
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["*"],
  });
}
