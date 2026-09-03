import { VercelRequest, VercelResponse } from "@vercel/node";
import { issuerUrl, mcpResourceUrl } from "../src/oauth.js";

// RFC 9728 Protected Resource Metadata. Claude fetches this after receiving
// a 401 with a WWW-Authenticate: Bearer resource_metadata="..." header from
// /api/mcp, to discover which authorization server issues tokens for this
// resource.
//
// This file deliberately does NOT live at api/.well-known/... - Vercel's
// filesystem-based API routing does not build a function for a source path
// containing a dot-prefixed directory segment (confirmed: api/.well-known/*
// silently produces a 404 in production, no build error). vercel.json
// rewrites the public /.well-known/oauth-protected-resource URL to this
// file instead.
export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader("Content-Type", "application/json");
  res.status(200).json({
    resource: mcpResourceUrl(),
    authorization_servers: [issuerUrl()],
    scopes_supported: ["*"],
    bearer_methods_supported: ["header"],
  });
}
