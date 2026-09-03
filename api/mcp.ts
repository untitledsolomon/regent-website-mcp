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
