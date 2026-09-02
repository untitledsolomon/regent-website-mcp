import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase, assertNoError } from "../supabase.js";

const CONTENT_TABLES = ["blog_posts", "case_studies", "resources"] as const;
type ContentTable = (typeof CONTENT_TABLES)[number];

export function registerContentTools(server: McpServer) {
  // ---- LIST ----
  server.registerTool(
    "list_content",
    {
      title: "List content",
      description:
        "List blog posts, case studies, or resources. Returns published and unpublished items unless filtered.",
      inputSchema: {
        table: z.enum(CONTENT_TABLES).describe("Which content type to list"),
        published_only: z.boolean().optional().default(false),
        limit: z.number().int().min(1).max(100).optional().default(20),
      },
    },
    async ({ table, published_only, limit }) => {
      let query = supabase
        .from(table)
        .select("id, slug, title, published, created_at, updated_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (published_only) query = query.eq("published", true);

      const { data, error } = await query;
      if (error) throw new Error(error.message);

      return {
        content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      };
    }
  );

  // ---- GET ONE ----
  server.registerTool(
    "get_content",
    {
      title: "Get content item",
      description:
        "Fetch the full record (all fields, including body content) for a single blog post, case study, or resource by slug or id.",
      inputSchema: {
        table: z.enum(CONTENT_TABLES),
        slug: z.string().optional(),
        id: z.string().optional(),
      },
    },
    async ({ table, slug, id }) => {
      if (!slug && !id) throw new Error("Provide either slug or id");
      let query = supabase.from(table).select("*");
      query = slug ? query.eq("slug", slug) : query.eq("id", id!);
      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No ${table} row found for ${slug ?? id}`);

      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  // ---- CREATE ----
  server.registerTool(
    "create_content",
    {
      title: "Create content",
      description:
        "Create a new blog post, case study, or resource. Provide a JSON object matching the table's columns. " +
        "blog_posts: slug, title, excerpt, content, author, date, category, read_time, published, meta_title, meta_description, og_image, image_url. " +
        "case_studies: slug, title, industry, summary, challenge, solution, results (string array), metrics (JSON array of {label, value}), published, meta_title, meta_description, og_image, image_url. " +
        "resources: slug, title, type ('Whitepaper'|'Research'|'Documentation'|'Case Study'), description, file_url, featured, published.",
      inputSchema: {
        table: z.enum(CONTENT_TABLES),
        fields: z.record(z.any()).describe("Column values for the new row"),
      },
    },
    async ({ table, fields }) => {
      const { data, error } = await supabase
        .from(table)
        .insert(fields)
        .select()
        .single();
      if (error) throw new Error(error.message);

      return {
        content: [
          {
            type: "text",
            text: `Created ${table} row: ${data.id} (slug: ${data.slug})\n${JSON.stringify(
              data,
              null,
              2
            )}`,
          },
        ],
      };
    }
  );

  // ---- UPDATE ----
  server.registerTool(
    "update_content",
    {
      title: "Update content",
      description:
        "Update fields on an existing blog post, case study, or resource. Identify the row by slug or id, and pass only the fields you want to change.",
      inputSchema: {
        table: z.enum(CONTENT_TABLES),
        slug: z.string().optional(),
        id: z.string().optional(),
        fields: z.record(z.any()).describe("Column values to update"),
      },
    },
    async ({ table, slug, id, fields }) => {
      if (!slug && !id) throw new Error("Provide either slug or id");
      let query = supabase.from(table).update(fields);
      query = slug ? query.eq("slug", slug) : query.eq("id", id!);
      const { data, error } = await query.select().maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No ${table} row found for ${slug ?? id}`);

      return {
        content: [
          { type: "text", text: `Updated ${table} row ${data.id}\n${JSON.stringify(data, null, 2)}` },
        ],
      };
    }
  );

  // ---- PUBLISH / UNPUBLISH (convenience wrapper) ----
  server.registerTool(
    "set_content_published",
    {
      title: "Publish or unpublish content",
      description:
        "Toggle the published flag on a blog post, case study, or resource. Optionally set a future publish_at timestamp for scheduled publishing (blog_posts and case_studies only).",
      inputSchema: {
        table: z.enum(CONTENT_TABLES),
        slug: z.string(),
        published: z.boolean(),
        publish_at: z
          .string()
          .datetime()
          .optional()
          .describe("ISO 8601 timestamp for scheduled publish (blog_posts/case_studies only)"),
      },
    },
    async ({ table, slug, published, publish_at }) => {
      const fields: Record<string, unknown> = { published };
      if (publish_at && table !== "resources") fields.publish_at = publish_at;

      const { data, error } = await supabase
        .from(table)
        .update(fields)
        .eq("slug", slug)
        .select()
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`No ${table} row found for slug ${slug}`);

      return {
        content: [
          {
            type: "text",
            text: `${table} "${slug}" is now ${published ? "published" : "unpublished"}${
              publish_at ? ` (scheduled for ${publish_at})` : ""
            }.`,
          },
        ],
      };
    }
  );

  // ---- DELETE ----
  server.registerTool(
    "delete_content",
    {
      title: "Delete content",
      description:
        "Permanently delete a blog post, case study, or resource by slug. This cannot be undone — confirm with the user before calling.",
      inputSchema: {
        table: z.enum(CONTENT_TABLES),
        slug: z.string(),
      },
    },
    async ({ table, slug }) => {
      const { error } = await supabase.from(table).delete().eq("slug", slug);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: `Deleted ${table} row with slug "${slug}".` }] };
    }
  );
}
