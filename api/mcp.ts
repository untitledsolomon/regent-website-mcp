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

// Ensure a single server instance per lambda container reuse
let server: McpServer | null = null;
let transport: any = null;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (!server) {
      server = new McpServer({ name: "regent-website", version: "1.0.0" });
      applyAuthAndLoggingWrapper(server);
      registerContentTools(server);
      registerCareersTools(server);
      registerLeadsTools(server);
      registerAnalyticsTools(server);
      registerEdgeFunctionTools(server);
    }

    if (!transport) {
      transport = new StreamableHTTPServerTransport();
      await server.connect(transport);
    }

    // Pass the Authorization header into the transport's expected auth slot
    // so the wrapper can read it from context. The transport copies req.auth
    // into the web-standard context as authInfo.
    (req as any).auth = { authorization: req.headers.authorization };

    // Delegate request handling to the transport which supports SSE/streaming
    await transport.handleRequest(req, res, (req as any).body);
  } catch (err: any) {
    console.error("MCP serverless handler error:", err);
    if (!res.headersSent) res.status(500).send("Server error");
  }
}
