// Vercel serverless function entry for MCP Streamable HTTP transport.
// This file assumes the MCP SDK exports a Streamable HTTP transport at
// @modelcontextprotocol/sdk/server/streamable-http.js. If your SDK differs,
// adjust the import.

import { VercelRequest, VercelResponse } from "@vercel/node";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { registerContentTools } from "../src/tools/content.js";
import { registerCareersTools } from "../src/tools/careers.js";
import { registerLeadsTools } from "../src/tools/leads.js";
import { registerAnalyticsTools } from "../src/tools/analytics.js";
import { registerEdgeFunctionTools } from "../src/tools/edgeFunctions.js";
import { applyAuthAndLoggingWrapper } from "../src/wrap-register.js";
import { resolveAgentFromCredential } from "../src/auth.js";
import { mcpResourceUrl } from "../src/oauth.js";

function extractBearer(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Bearer\s+(.*)$/i);
  return m ? m[1] : authHeader;
}

// RFC 9728 / MCP auth spec: an unauthenticated or invalid request to a
// protected MCP resource gets a 401 with a WWW-Authenticate header pointing
// at our protected resource metadata, so Claude knows to run the OAuth
// discovery + DCR + authorize + token flow instead of just surfacing a
// generic tool error. `initialize` itself is allowed through without auth,
// matching common MCP client behavior of probing capabilities before the
// user has connected anything.
function protectedResourceChallenge(res: VercelResponse) {
  res.setHeader(
    "WWW-Authenticate",
    `Bearer resource_metadata="${mcpResourceUrl().replace(/\/api\/mcp$/, "")}/.well-known/oauth-protected-resource"`
  );
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized: valid Bearer token required" },
    id: null,
  });
}

// IMPORTANT: create a brand-new McpServer AND a brand-new transport on every
// request. The MCP SDK's Server.connect() throws "Already connected to a
// transport" if called twice on the same Server instance without an
// intervening close(). Vercel serverless functions frequently reuse a warm
// container across requests, so a module-level singleton server (connected
// once per request but never disconnected) will throw on the 2nd+ request
// that lands on the same warm container. Since this endpoint is stateless
// (sessionIdGenerator: undefined) anyway, there's no benefit to reusing the
// server — tool registration is cheap — so just build it fresh each time.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    // Let `initialize` (and notifications/pings with no method at all)
    // through without a token, same as before - some MCP clients probe
    // capabilities pre-auth. Everything else (tools/list, tools/call, ...)
    // requires a valid credential, checked here at the HTTP layer so a
    // missing/invalid token produces a real 401 + WWW-Authenticate
    // challenge instead of a JSON-RPC error buried inside a 200 response,
    // which is what actually triggers Claude's OAuth discovery flow.
    const rpcMethod = (req as any).body?.method;
    if (rpcMethod && rpcMethod !== "initialize") {
      const rawKey = extractBearer(req.headers.authorization);
      const agent = rawKey ? await resolveAgentFromCredential(rawKey) : null;
      if (!agent || agent.revoked) {
        protectedResourceChallenge(res);
        return;
      }
    }

    const server = new McpServer({ name: "regent-website", version: "1.0.0" });
    applyAuthAndLoggingWrapper(server);
    registerContentTools(server);
    registerCareersTools(server);
    registerLeadsTools(server);
    registerAnalyticsTools(server);
    registerEdgeFunctionTools(server);

    // Stateless mode: no session ID is generated or required, which is the
    // correct fit for a serverless function (no durable in-memory session
    // store across invocations/containers). Explicitly setting
    // sessionIdGenerator: undefined selects this mode rather than leaving it
    // ambiguous, which was the source of the intermittent 500/406 responses.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await server.connect(transport);

    // Pass the Authorization header into the transport's expected auth slot
    // so the wrapper can read it from context. The transport copies req.auth
    // into the web-standard context as authInfo.
    (req as any).auth = { authorization: req.headers.authorization };

    // Clean up once the HTTP response is done so this server/transport pair
    // doesn't linger (each request gets its own pair now, so this is just
    // good hygiene, not a correctness requirement).
    res.on("close", () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    // Delegate request handling to the transport which supports SSE/streaming
    await transport.handleRequest(req, res, (req as any).body);
  } catch (err: any) {
    console.error("MCP serverless handler error:", err);
    if (!res.headersSent) res.status(500).send("Server error");
  }
}
