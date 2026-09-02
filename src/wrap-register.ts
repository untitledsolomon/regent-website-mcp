import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { findAgentByApiKey, markAgentLastUsed } from "./auth.js";
import { sanitizeInputSummary, logCallFireAndForget } from "./logging.js";

// Map each tool name to a required scope. Keep conservative mapping matching
// the existing tools in src/tools/*. Add more as tools grow.
const TOOL_SCOPE_MAP: Record<string, string> = {
  // content
  list_content: "content:read",
  get_content: "content:read",
  create_content: "content:write",
  update_content: "content:write",
  set_content_published: "content:write",
  delete_content: "content:write",
  // leads
  list_consultation_requests: "leads:read",
  get_consultation_request: "leads:read",
  update_consultation_request: "leads:write",
  add_inquiry_note: "leads:write",
  list_newsletter_subscribers: "leads:read",
  list_newsletter_sends: "leads:read",
  // careers
  list_job_postings: "careers:read",
  create_job_posting: "careers:write",
  update_job_posting: "careers:write",
  delete_job_posting: "careers:write",
  list_job_applications: "careers:read",
  update_job_application_status: "careers:write",
  // analytics
  get_content_analytics: "analytics:read",
  get_content_insights: "analytics:read",
  get_daily_views: "analytics:read",
  get_unique_visitors_count: "analytics:read",
  get_audience_breakdown: "analytics:read",
  get_conversion_stats: "analytics:read",
  get_analytics_detail: "analytics:read",
  get_admin_activity_log: "analytics:read",
  // edge functions (email)
  send_newsletter: "email:send",
  reply_to_consultation: "email:send",
};

function hasScope(agentScopes: string[] | undefined, required: string) {
  if (!agentScopes) return false;
  return agentScopes.includes(required);
}

// Safety: disallow enabling MCP_ALLOW_LOCAL_NO_AUTH in production
if (process.env.MCP_ALLOW_LOCAL_NO_AUTH === "1" && process.env.NODE_ENV === "production") {
  throw new Error("MCP_ALLOW_LOCAL_NO_AUTH must not be enabled in production");
}

export function applyAuthAndLoggingWrapper(server: McpServer) {
  // Monkey-patch the server.registerTool instance method so tools can be wrapped
  // with a middleware that enforces scopes and logs calls.
  // Keep a reference to the original implementation.
  const originalRegister: any = (server as any).registerTool.bind(server);

  (server as any).registerTool = function (name: string, meta: any, handler: Function) {
    const requiredScope = TOOL_SCOPE_MAP[name];

    const wrappedHandler = async function (this: any, input: any, context?: any) {
      const incomingAuth =
        // SDK transports often place transport-level auth in context?.transport?.headers
        context?.transport?.headers?.authorization || context?.authorization || context?.auth?.authorization || context?.headers?.authorization || context?.authInfo?.authorization || context?.authInfo?.headers?.authorization;

      // Normalize "Bearer <token>"
      let rawKey: string | null = null;
      if (typeof incomingAuth === "string") {
        const m = incomingAuth.match(/^Bearer\s+(.*)$/i);
        rawKey = m ? m[1] : incomingAuth;
      } else if (typeof incomingAuth === "object" && incomingAuth?.token) {
        rawKey = incomingAuth.token;
      }

      // Local dev: if no Authorization provided and env explicitly allows local no-auth, bypass auth.
      let agent = null;
      if (rawKey) {
        agent = await findAgentByApiKey(rawKey);
        if (!agent) {
          const err = new Error("Invalid API key");
          // Log attempt with null agent_id
          logCallFireAndForget({
            agent_id: null,
            tool_name: name,
            input_summary: sanitizeInputSummary(input || {}),
            success: false,
            error_message: "invalid_api_key",
            duration_ms: 0,
          });
          throw err;
        }
        if (agent.revoked) {
          const err = new Error("API key revoked");
          logCallFireAndForget({
            agent_id: agent.id,
            tool_name: name,
            input_summary: sanitizeInputSummary(input || {}),
            success: false,
            error_message: "revoked_key",
            duration_ms: 0,
          });
          throw err;
        }
      } else if (process.env.MCP_ALLOW_LOCAL_NO_AUTH === "1" && process.env.NODE_ENV !== "production") {
        // allow when explicitly enabled (local dev convenience) and not in production
        agent = { id: "local-dev", name: "local-dev", scopes: ["*"], revoked: false } as any;
      } else {
        const err = new Error("Missing Authorization header");
        logCallFireAndForget({
          agent_id: null,
          tool_name: name,
          input_summary: sanitizeInputSummary(input || {}),
          success: false,
          error_message: "missing_authorization",
          duration_ms: 0,
        });
        throw err;
      }

      // Enforce scopes
      if (requiredScope && requiredScope !== "*") {
        const agentScopes = (agent?.scopes as string[]) || [];
        if (!hasScope(agentScopes, requiredScope) && !agentScopes.includes("*") ) {
          const err = new Error(`Missing required scope: ${requiredScope}`);
          logCallFireAndForget({
            agent_id: agent?.id ?? null,
            tool_name: name,
            input_summary: sanitizeInputSummary(input || {}),
            success: false,
            error_message: `missing_scope:${requiredScope}`,
            duration_ms: 0,
          });
          throw err;
        }
      }

      const start = Date.now();
      try {
        const result = await handler.call(this, input, context);
        const duration = Date.now() - start;
        // update last_used_at (best-effort)
        if (agent?.id && agent?.id !== "local-dev") {
          markAgentLastUsed(agent.id).catch(() => {});
        }
        // Fire-and-forget audit log
        logCallFireAndForget({
          agent_id: agent?.id ?? null,
          tool_name: name,
          input_summary: sanitizeInputSummary(input || {}),
          success: true,
          error_message: null,
          duration_ms: duration,
        }).catch(() => {});
        return result;
      } catch (err: any) {
        const duration = Date.now() - start;
        logCallFireAndForget({
          agent_id: agent?.id ?? null,
          tool_name: name,
          input_summary: sanitizeInputSummary(input || {}),
          success: false,
          error_message: err?.message ?? String(err),
          duration_ms: duration,
        }).catch(() => {});
        throw err;
      }
    };

    return originalRegister(name, meta, wrappedHandler);
  };
}
