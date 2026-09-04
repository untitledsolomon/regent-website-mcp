import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase, assertNoError } from "../supabase.js";

const CONTENT_TABLES = ["blog_posts", "case_studies", "resources"] as const;
type ContentTable = (typeof CONTENT_TABLES)[number];

// Buckets an agent may upload into, and what each is for. Keep this list in
// sync with the storage.buckets rows created in the website repo's migrations.
const UPLOAD_BUCKETS = ["resource-files", "content-images"] as const;
type UploadBucket = (typeof UPLOAD_BUCKETS)[number];

const BUCKET_ALLOWED_MIME_TYPES: Record<UploadBucket, string[]> = {
  // Note: the resource-files Supabase bucket itself does not enforce MIME
  // types (legacy admin editors still upload images there too), but this
  // tool holds agents to document types only, since that's what resources
  // are for. Revisit once the legacy editors are split onto content-images.
  "resource-files": [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  "content-images": ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"],
};

// Hard ceiling enforced here regardless of what Supabase's bucket config
// allows — reject oversized uploads before we ever decode/send the bytes.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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

  // ---- UPLOAD FILE ----
  server.registerTool(
    "upload_resource_file",
    {
      title: "Upload a file to storage",
      description:
        "Upload a file (base64-encoded) to Supabase Storage and return its public URL, for use as a resources.file_url, " +
        "blog_posts.image_url/og_image, or case_studies.image_url/og_image value. " +
        "Choose the bucket based on what the file is: 'resource-files' for downloadable resource documents " +
        "(PDF, DOC, DOCX — whitepapers, guides, checklists); 'content-images' for blog or case-study images " +
        "(cover images, inline post images, og_image — PNG, JPEG, WEBP, GIF, SVG). " +
        `Max file size is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB. Files are rejected if their type doesn't match the bucket's allowed types.`,
      inputSchema: {
        bucket: z
          .enum(UPLOAD_BUCKETS)
          .describe(
            "Which bucket to upload into: 'resource-files' for resource documents, 'content-images' for blog/case-study images."
          ),
        filename: z.string().describe("Original filename, used to derive the file extension."),
        file_base64: z.string().describe("Base64-encoded file contents (no data: URI prefix)."),
        content_type: z
          .string()
          .describe("MIME type of the file, e.g. 'application/pdf' or 'image/png'. Must match one of the bucket's allowed types."),
        slug: z
          .string()
          .optional()
          .describe("Slug of the content item this file belongs to, used to name the uploaded file. Defaults to 'file'."),
      },
    },
    async ({ bucket, filename, file_base64, content_type, slug }) => {
      const allowed = BUCKET_ALLOWED_MIME_TYPES[bucket as UploadBucket];
      if (!allowed.includes(content_type)) {
        throw new Error(
          `content_type "${content_type}" is not allowed in bucket "${bucket}". Allowed types: ${allowed.join(", ")}`
        );
      }

      let buffer: Buffer;
      try {
        buffer = Buffer.from(file_base64, "base64");
      } catch {
        throw new Error("file_base64 could not be decoded — ensure it is valid base64 with no data: URI prefix.");
      }

      if (buffer.length === 0) {
        throw new Error("Decoded file is empty.");
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        throw new Error(
          `File is ${(buffer.length / (1024 * 1024)).toFixed(2)}MB, which exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit.`
        );
      }

      const ext = filename.includes(".") ? filename.split(".").pop() : undefined;
      const path = `${Date.now()}-${slug || "file"}${ext ? `.${ext}` : ""}`;

      const { error: uploadError } = await supabase.storage.from(bucket).upload(path, buffer, {
        contentType: content_type,
      });
      if (uploadError) throw new Error(uploadError.message);

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(path);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ bucket, path, file_url: publicUrl }, null, 2),
          },
        ],
      };
    }
  );

  // ---- LIST BUCKETS ----
  server.registerTool(
    "list_storage_buckets",
    {
      title: "List storage buckets",
      description:
        "List the storage buckets available for upload_resource_file / download_storage_file, along with what each is for, " +
        "its public/private visibility, size limit, and allowed MIME types.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.storage.listBuckets();
      if (error) throw new Error(error.message);

      const relevant = (data || []).filter((b) => (UPLOAD_BUCKETS as readonly string[]).includes(b.id));

      const summary = relevant.map((b) => ({
        id: b.id,
        public: b.public,
        file_size_limit: b.file_size_limit,
        allowed_mime_types: b.allowed_mime_types,
        tool_enforced_mime_types: BUCKET_ALLOWED_MIME_TYPES[b.id as UploadBucket] ?? null,
      }));

      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    }
  );

  // ---- LIST BUCKET CONTENTS ----
  server.registerTool(
    "list_bucket_contents",
    {
      title: "List files in a storage bucket",
      description:
        "List files (and folders) inside a storage bucket, optionally under a path prefix. Returns name, size, " +
        "content type, and last-modified time for each file.",
      inputSchema: {
        bucket: z.enum(UPLOAD_BUCKETS).describe("Which bucket to list."),
        path: z.string().optional().describe("Optional folder path/prefix within the bucket to list. Defaults to the bucket root."),
        limit: z.number().int().min(1).max(1000).optional().default(100),
      },
    },
    async ({ bucket, path, limit }) => {
      const { data, error } = await supabase.storage.from(bucket).list(path || undefined, {
        limit,
        sortBy: { column: "created_at", order: "desc" },
      });
      if (error) throw new Error(error.message);

      const items = (data || []).map((item) => ({
        name: item.name,
        path: path ? `${path}/${item.name}` : item.name,
        is_folder: item.id === null,
        size_bytes: item.metadata?.size ?? null,
        content_type: item.metadata?.mimetype ?? null,
        last_modified: item.updated_at ?? item.created_at ?? null,
      }));

      return { content: [{ type: "text", text: JSON.stringify(items, null, 2) }] };
    }
  );

  // ---- DOWNLOAD FILE ----
  // MCP tool results are text-based, so a large file returned as base64 in
  // the response body would be both wasteful and risk hitting response-size
  // limits. For small files (<= DOWNLOAD_INLINE_MAX_BYTES) we return the
  // content inline as base64; above that we just return the public URL
  // (buckets here are all public) so the caller can fetch it directly instead.
  const DOWNLOAD_INLINE_MAX_BYTES = 2 * 1024 * 1024; // 2MB

  server.registerTool(
    "download_storage_file",
    {
      title: "Download a file from storage",
      description:
        "Download a file from a storage bucket by path (as returned by list_bucket_contents or upload_resource_file). " +
        `Files up to ${DOWNLOAD_INLINE_MAX_BYTES / (1024 * 1024)}MB are returned inline as base64. Larger files are not ` +
        "inlined — the response instead includes the public URL to fetch the file directly, since these buckets are public.",
      inputSchema: {
        bucket: z.enum(UPLOAD_BUCKETS).describe("Which bucket the file is in."),
        path: z.string().describe("Path of the file within the bucket, e.g. as returned by list_bucket_contents."),
      },
    },
    async ({ bucket, path }) => {
      // Check size first via list() on the parent folder, to avoid downloading
      // a huge file just to discover it's too big to inline.
      const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined;
      const filename = path.includes("/") ? path.slice(path.lastIndexOf("/") + 1) : path;

      const { data: listing, error: listError } = await supabase.storage.from(bucket).list(parentPath || undefined, {
        search: filename,
      });
      if (listError) throw new Error(listError.message);

      const fileMeta = listing?.find((f) => f.name === filename);
      const size = fileMeta?.metadata?.size;

      const {
        data: { publicUrl },
      } = supabase.storage.from(bucket).getPublicUrl(path);

      if (typeof size === "number" && size > DOWNLOAD_INLINE_MAX_BYTES) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  path,
                  bucket,
                  size_bytes: size,
                  inlined: false,
                  reason: `File exceeds ${DOWNLOAD_INLINE_MAX_BYTES / (1024 * 1024)}MB inline limit`,
                  file_url: publicUrl,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      const { data: fileData, error: downloadError } = await supabase.storage.from(bucket).download(path);
      if (downloadError) throw new Error(downloadError.message);

      const arrayBuffer = await fileData.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      if (buffer.length > DOWNLOAD_INLINE_MAX_BYTES) {
        // Metadata lookup missed it (e.g. no metadata on the object) — caught here as a fallback.
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  path,
                  bucket,
                  size_bytes: buffer.length,
                  inlined: false,
                  reason: `File exceeds ${DOWNLOAD_INLINE_MAX_BYTES / (1024 * 1024)}MB inline limit`,
                  file_url: publicUrl,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                path,
                bucket,
                size_bytes: buffer.length,
                inlined: true,
                content_type: fileData.type || fileMeta?.metadata?.mimetype || null,
                file_base64: buffer.toString("base64"),
                file_url: publicUrl,
              },
              null,
              2
            ),
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
