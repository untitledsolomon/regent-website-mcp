import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../supabase.js";

export function registerCareersTools(server: McpServer) {
  // ---- LIST JOB POSTINGS ----
  server.registerTool(
    "list_job_postings",
    {
      title: "List job postings",
      description: "List all career/job postings, optionally filtered to published-only.",
      inputSchema: {
        published_only: z.boolean().optional().default(false),
      },
    },
    async ({ published_only }) => {
      let query = supabase
        .from("careers")
        .select("*")
        .order("created_at", { ascending: false });
      if (published_only) query = query.eq("published", true);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- CREATE JOB POSTING ----
  server.registerTool(
    "create_job_posting",
    {
      title: "Create job posting",
      description: "Create a new job posting on the careers page.",
      inputSchema: {
        title: z.string(),
        department: z.string(),
        location: z.string(),
        type: z.string().default("Full-time").describe("e.g. Full-time, Part-time, Contract"),
        description: z.string().describe("Full job description, HTML or plain text"),
        published: z.boolean().optional().default(true),
      },
    },
    async (fields) => {
      const { data, error } = await supabase.from("careers").insert(fields).select().single();
      if (error) throw new Error(error.message);
      return {
        content: [
          { type: "text", text: `Created job posting: ${data.id} — "${data.title}"\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }
  );

  // ---- UPDATE JOB POSTING ----
  server.registerTool(
    "update_job_posting",
    {
      title: "Update job posting",
      description: "Update fields on an existing job posting, identified by id.",
      inputSchema: {
        id: z.string(),
        fields: z.record(z.any()).describe("Any subset of: title, department, location, type, description, published"),
      },
    },
    async ({ id, fields }) => {
      const { data, error } = await supabase
        .from("careers")
        .update(fields)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No job posting found with id ${id}`);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- CLOSE / DELETE JOB POSTING ----
  server.registerTool(
    "delete_job_posting",
    {
      title: "Delete job posting",
      description:
        "Permanently delete a job posting. Prefer unpublishing (update_job_posting with published: false) if you just want to close applications while keeping history.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const { error } = await supabase.from("careers").delete().eq("id", id);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: `Deleted job posting ${id}.` }] };
    }
  );

  // ---- LIST APPLICATIONS ----
  server.registerTool(
    "list_job_applications",
    {
      title: "List job applications",
      description:
        "List applications submitted for job postings. Filter by career_id or status. Status is typically one of: new, reviewing, interviewing, offered, rejected, hired (site-defined, not enforced by DB).",
      inputSchema: {
        career_id: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
    },
    async ({ career_id, status, limit }) => {
      let query = supabase
        .from("job_applications")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (career_id) query = query.eq("career_id", career_id);
      if (status) query = query.eq("status", status);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- UPDATE APPLICATION STATUS ----
  server.registerTool(
    "update_job_application_status",
    {
      title: "Update job application status",
      description: "Update the status of a job application (e.g. move a candidate to 'interviewing').",
      inputSchema: {
        id: z.string(),
        status: z.string(),
      },
    },
    async ({ id, status }) => {
      const { data, error } = await supabase
        .from("job_applications")
        .update({ status })
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No application found with id ${id}`);
      return {
        content: [{ type: "text", text: `Application ${id} status set to "${status}".` }],
      };
    }
  );
}
