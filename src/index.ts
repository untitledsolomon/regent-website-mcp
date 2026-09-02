#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerContentTools } from "./tools/content.js";
import { registerCareersTools } from "./tools/careers.js";
import { registerLeadsTools } from "./tools/leads.js";
import { registerAnalyticsTools } from "./tools/analytics.js";
import { registerEdgeFunctionTools } from "./tools/edgeFunctions.js";

const server = new McpServer({
  name: "regent-website",
  version: "1.0.0",
});

// Patch registerTool to add auth + logging middleware around each tool handler.
import { applyAuthAndLoggingWrapper } from "./wrap-register.js";
applyAuthAndLoggingWrapper(server);

registerContentTools(server);
registerCareersTools(server);
registerLeadsTools(server);
registerAnalyticsTools(server);
registerEdgeFunctionTools(server);

async function main() {
  // Default: run on stdio for local dev. The Vercel / serverless entrypoint
  // uses api/mcp.ts which constructs a Streamable HTTP transport instead.
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Regent MCP server running on stdio.");
}

main().catch((err) => {
  console.error("Fatal error starting Regent MCP server:", err);
  process.exit(1);
});
