import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../supabase.js";

const SUPABASE_URL = process.env.SUPABASE_URL!;

// The site's send-newsletter and reply-consultation edge functions check for a
// logged-in admin user's JWT (via supabase.auth.getUser(token)), not the raw
// service-role key. To call them from here we sign in as a dedicated admin
// service account. Create one in Supabase Auth and grant it the 'admin' role
// in user_roles, then set REGENT_ADMIN_EMAIL / REGENT_ADMIN_PASSWORD.
async function getAdminAccessToken(): Promise<string> {
  const email = process.env.REGENT_ADMIN_EMAIL;
  const password = process.env.REGENT_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Sending email requires REGENT_ADMIN_EMAIL and REGENT_ADMIN_PASSWORD env vars " +
        "(a Supabase Auth user with the 'admin' role in user_roles). See README."
    );
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(`Failed to authenticate admin service account: ${error?.message}`);
  }
  return data.session.access_token;
}

async function invokeEdgeFunction(name: string, body: Record<string, unknown>) {
  const token = await getAdminAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${name} failed (HTTP ${res.status}): ${text}`);
  }
  return text;
}

export function registerEdgeFunctionTools(server: McpServer) {
  // ---- SEND NEWSLETTER ----
  server.registerTool(
    "send_newsletter",
    {
      title: "Send newsletter",
      description:
        "Send a newsletter campaign to all subscribers via the site's send-newsletter function (Resend). " +
        "This actually dispatches real emails — confirm the subject and HTML content with the user before calling.",
      inputSchema: {
        subject: z.string(),
        html: z.string().describe("Full HTML body of the newsletter"),
      },
    },
    async ({ subject, html }) => {
      const result = await invokeEdgeFunction("send-newsletter", { subject, html });
      return { content: [{ type: "text", text: result }] };
    }
  );

  // ---- REPLY TO CONSULTATION ----
  server.registerTool(
    "reply_to_consultation",
    {
      title: "Reply to consultation request",
      description:
        "Send an email reply to someone who submitted a consultation/demo request, via the site's reply-consultation function. " +
        "This sends a real email to the requester and marks the request as replied. Confirm the message with the user before calling.",
      inputSchema: {
        consultation_id: z.string(),
        to_email: z.string().email(),
        to_name: z.string(),
        subject: z.string(),
        body: z.string().describe("Reply message body (plain text or HTML depending on function's template)"),
      },
    },
    async (args) => {
      const result = await invokeEdgeFunction("reply-consultation", args);
      return { content: [{ type: "text", text: result }] };
    }
  );
}
