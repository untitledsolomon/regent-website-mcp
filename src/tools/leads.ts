import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../supabase.js";

export function registerLeadsTools(server: McpServer) {
  // ---- LIST CONSULTATION REQUESTS ----
  server.registerTool(
    "list_consultation_requests",
    {
      title: "List consultation requests",
      description:
        "List inbound consultation/demo requests submitted via the site's contact form. Filter by status (e.g. 'new', 'replied', 'closed' — site-defined).",
      inputSchema: {
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
    },
    async ({ status, limit }) => {
      let query = supabase
        .from("consultation_requests")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- GET SINGLE CONSULTATION + NOTES ----
  server.registerTool(
    "get_consultation_request",
    {
      title: "Get consultation request",
      description: "Fetch a single consultation request along with its internal notes thread.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { data: request, error: reqErr } = await supabase
        .from("consultation_requests")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (reqErr) throw new Error(reqErr.message);
      if (!request) throw new Error(`No consultation request found with id ${id}`);

      const { data: notes, error: notesErr } = await supabase
        .from("inquiry_notes")
        .select("*")
        .eq("inquiry_id", id)
        .order("created_at", { ascending: true });
      if (notesErr) throw new Error(notesErr.message);

      return {
        content: [
          { type: "text", text: JSON.stringify({ ...request, notes }, null, 2) },
        ],
      };
    }
  );

  // ---- UPDATE CONSULTATION STATUS / NOTES ----
  server.registerTool(
    "update_consultation_request",
    {
      title: "Update consultation request",
      description:
        "Update a consultation request's status and/or admin_notes. Use add_inquiry_note instead if you want to append a timestamped note rather than overwrite admin_notes.",
      inputSchema: {
        id: z.string(),
        status: z.string().optional(),
        admin_notes: z.string().optional(),
      },
    },
    async ({ id, status, admin_notes }) => {
      const fields: Record<string, unknown> = {};
      if (status !== undefined) fields.status = status;
      if (admin_notes !== undefined) fields.admin_notes = admin_notes;
      if (Object.keys(fields).length === 0) throw new Error("Provide status and/or admin_notes to update.");

      const { data, error } = await supabase
        .from("consultation_requests")
        .update(fields)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No consultation request found with id ${id}`);

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- ADD INQUIRY NOTE ----
  server.registerTool(
    "add_inquiry_note",
    {
      title: "Add note to consultation request",
      description: "Append an internal note to a consultation request's thread (does not overwrite prior notes).",
      inputSchema: {
        inquiry_id: z.string(),
        message: z.string(),
        author_email: z.string().email().optional(),
      },
    },
    async ({ inquiry_id, message, author_email }) => {
      const { data, error } = await supabase
        .from("inquiry_notes")
        .insert({ inquiry_id, message, author_email })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- LIST NEWSLETTER SUBSCRIBERS ----
  server.registerTool(
    "list_newsletter_subscribers",
    {
      title: "List newsletter subscribers",
      description: "List email newsletter subscribers, most recent first.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(100),
      },
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from("newsletter_subscribers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- LIST NEWSLETTER SENDS (send history) ----
  server.registerTool(
    "list_newsletter_sends",
    {
      title: "List newsletter send history",
      description: "List past newsletter campaigns that were sent, with subject, sent/failed counts, and timestamps.",
      inputSchema: {
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from("newsletter_sends")
        .select("*")
        .order("sent_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // NOTE: Actually sending a newsletter is intentionally NOT exposed as a direct
  // DB write here — on this site it's handled by the `send-newsletter` Supabase
  // Edge Function (which does the real email dispatch via Resend). See
  // register EdgeFunctionTools in edgeFunctions.ts for that.
}
