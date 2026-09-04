# Regent MCP Server

An MCP (Model Context Protocol) server that lets AI agents perform operations
on the Regent website's Supabase backend: content publishing, careers/job
applications, lead management (consultations + newsletter), analytics, and
transactional email (newsletter sends, consultation replies).

## What it can do

| Domain | Tools |
|---|---|
| **Content** (blog posts, case studies, resources) | `list_content`, `get_content`, `create_content`, `update_content`, `set_content_published`, `delete_content` |
| **Storage** (resource files, blog/case-study images) | `list_storage_buckets`, `list_bucket_contents`, `upload_resource_file`, `download_storage_file` |
| **Careers** | `list_job_postings`, `create_job_posting`, `update_job_posting`, `delete_job_posting`, `list_job_applications`, `update_job_application_status` |
| **Leads** | `list_consultation_requests`, `get_consultation_request`, `update_consultation_request`, `add_inquiry_note`, `list_newsletter_subscribers`, `list_newsletter_sends` |
| **Analytics** | `get_content_analytics`, `get_content_insights`, `get_daily_views`, `get_unique_visitors_count`, `get_audience_breakdown`, `get_conversion_stats`, `get_analytics_detail`, `get_admin_activity_log` |
| **Email (Edge Functions)** | `send_newsletter`, `reply_to_consultation` |

This covers every table in the site's live schema (`blog_posts`, `case_studies`,
`resources`, `careers`, `job_applications`, `consultation_requests`,
`inquiry_notes`, `newsletter_subscribers`, `newsletter_sends`,
`admin_activity_log`) plus the analytics RPC functions already defined in the
database, the two storage buckets used by content (`resource-files`,
`content-images`), and the two Resend-backed edge functions for actually
sending email.

### Storage tools

Resources need a real, publicly reachable `file_url` before `create_content`
can point at it — the content tools above only ever write DB rows, so
`upload_resource_file` is what actually puts bytes into Supabase Storage.

| Tool | What it does |
|---|---|
| `list_storage_buckets` | Lists the buckets an agent can upload into, their Supabase-level config (public/private, size limit, allowed MIME types), and what this server additionally enforces on top. |
| `list_bucket_contents` | Lists files (and folders) in a bucket, optionally under a path prefix — name, size, content type, last modified. |
| `upload_resource_file` | Uploads a base64-encoded file to a bucket and returns its public URL, ready to drop into `resources.file_url`, `blog_posts.image_url`/`og_image`, or `case_studies.image_url`/`og_image`. |
| `download_storage_file` | Downloads a file by path. Files ≤2MB are returned inline as base64; larger files return the public URL instead of inlining the bytes, since both buckets are public. |

**Buckets:**

| Bucket | For | Allowed types (enforced by this server) | Size limit |
|---|---|---|---|
| `resource-files` | Downloadable resource documents (whitepapers, guides, checklists) | PDF, DOC, DOCX | 10MB |
| `content-images` | Blog/case-study images (covers, inline post images, `og_image`) | PNG, JPEG, WEBP, GIF, SVG | 10MB |

Note: the `resource-files` Supabase bucket itself doesn't enforce a MIME
restriction — the legacy admin editors (`ResourceEditor`, `PostEditor`,
`CaseStudyEditor`, `RichTextEditor` in the website repo) still upload images
into that same bucket today. `upload_resource_file` holds *agents* to
document types only for that bucket regardless, since that's what resources
are for; the bucket-level restriction can be tightened once those editors are
updated to use `content-images` for their image uploads.

The 10MB cap is enforced by this server before any bytes are sent to
Supabase (checked after base64 decoding, so it reflects real file size, not
payload size) — independent of whatever limit is set on the bucket itself.


## ⚠️ Before you run this

This server uses the **Supabase service role key**, which bypasses Row Level
Security entirely. Anything with access to run this server has full
read/write/delete access to the production database. Treat the environment
this runs in with the same care as production database credentials:

- Never commit `.env` or hardcode keys in source (see `.gitignore`).
- Only give this server to agents/people you'd trust with direct DB access.
- The `delete_content` and `delete_job_posting` tools are irreversible.
- `delete_content` only deletes the DB row — it does **not** remove the
  underlying file from storage if the row was a resource. Uploaded files are
  left orphaned in the bucket; there's no `delete_storage_file` tool yet.
- `send_newsletter` and `reply_to_consultation` send **real emails** — there's
  no dry-run mode built in yet. Consider adding a confirmation step in your
  agent's workflow before invoking them.

## Setup

### 1. Install

```bash
npm install
npm run build
```

### 2. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | Yes | Your Supabase project URL, e.g. `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Service role key (Supabase dashboard → Settings → API) |
| `REGENT_ADMIN_EMAIL` | Only for `send_newsletter`/`reply_to_consultation` | Email of a Supabase Auth user with the `admin` role |
| `REGENT_ADMIN_PASSWORD` | Only for `send_newsletter`/`reply_to_consultation` | Password for that user |
| `MCP_PUBLIC_URL` | Yes, for OAuth | This deployment's public base URL, e.g. `https://mcp.regentplatform.com` (no trailing slash). Used to build the OAuth metadata/endpoint URLs advertised to clients. |
| `SUPABASE_ANON_KEY` | Yes, for OAuth | Supabase anon/publishable key (Settings -> API). Used only to run `signInWithPassword` on the `/oauth/authorize` login screen - never given service-role access. |

The two email tools call the site's existing `send-newsletter` and
`reply-consultation` Edge Functions, which require a logged-in admin user's
JWT (not the raw service key) for authorization. Create a dedicated service
account user in Supabase Auth, add it to `user_roles` with `role = 'admin'`,
and use its credentials here — don't reuse a real person's login.

**Never put real values in a committed file.** Set these as actual
environment variables, or in your MCP client's config as shown below.

### 3. Register with an MCP client

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "regent-website": {
      "command": "node",
      "args": ["/absolute/path/to/regent-mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "https://xxxx.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "your-new-rotated-service-role-key",
        "REGENT_ADMIN_EMAIL": "agent-service-account@yourdomain.com",
        "REGENT_ADMIN_PASSWORD": "your-service-account-password"
      }
    }
  }
}
```

Any other MCP-compatible client (Claude Code, custom agent runtimes, etc.)
works the same way — it's a standard stdio MCP server.

### 4. Test it locally

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

This opens a browser UI where you can call each tool manually before wiring
up an agent.

## Project layout

```
src/
  index.ts           - entrypoint, registers all tool modules, starts stdio transport
  supabase.ts         - single Supabase client instance (service role)
  tools/
    content.ts        - blog_posts / case_studies / resources CRUD + publish toggle + storage tools
    careers.ts         - job postings + applications
    leads.ts            - consultation_requests, inquiry_notes, newsletter_subscribers/sends
    analytics.ts         - wraps the DB's analytics RPC functions
    edgeFunctions.ts       - send_newsletter, reply_to_consultation (real email sends)
```

## Extending it

## MCP HTTP hosting, auth, and admin additions

This repository now includes an HTTP-hosted MCP entry that is suitable for
running as a Vercel serverless function, plus a lightweight per-agent API key
model and audit logging. Files added/changed in this update:

- src/auth.ts — agent lookup and helpers
- src/logging.ts — input sanitization and fire-and-forget call logging
- src/wrap-register.ts — patches McpServer.registerTool to enforce scopes
  and record mcp_call_log entries
- api/mcp.ts — Vercel serverless function example using the SDK's streamable
  HTTP transport (adjust import if your SDK path differs)
- src/create_agent.ts — convenience script to create an agent and print its
  API key once (run with npm run create-agent)
- supabase/migrations/20260902_000001_create_mcp_agents.sql
- supabase/migrations/20260902_000002_create_mcp_call_log.sql

See the "Deployment" and "Creating first agent" sections below for how to
deploy and bootstrap the system.

## OAuth (required for Claude.ai custom connectors)

Claude.ai's custom connector UI only supports OAuth-based authentication for
remote MCP servers - there is no field to paste a static bearer token or API
key (a `static_headers` option exists but is beta and org-admin-gated; if it
becomes available for your account it's the simpler path). This server
therefore implements a minimal OAuth 2.1 authorization server with Dynamic
Client Registration (RFC 7591) alongside the original static-key auth, so
both work:

- **Static key** (`regent_mcp_sk_...`, from `create-agent`): still works
  for direct API/script use, e.g. `curl` or a custom integration.
- **OAuth** (`regent_at_...` access tokens): used automatically when you add
  this server as a custom connector in Claude.ai. Claude discovers the
  OAuth endpoints via `/.well-known/oauth-protected-resource` and
  `/.well-known/oauth-authorization-server`, registers itself as a client
  via `/api/oauth/register`, and sends the user (you) to
  `/api/oauth/authorize` to sign in with your Supabase Auth admin
  credentials before issuing a token.

Both auth methods resolve to the same `mcp_agents` row and the same scope
enforcement in `wrap-register.ts` - OAuth is just a different way to get a
valid `agent_id`, not a separate permission model.

**Setup steps specific to OAuth:**

1. Run the new migration: `supabase/migrations/20260903_000001_create_oauth_tables.sql`.
2. Make sure a Supabase Auth user exists with the `admin` role in
   `user_roles` (the same one used for `REGENT_ADMIN_EMAIL` is fine) - this
   is the account you'll sign in with on the `/oauth/authorize` screen.
3. Set `MCP_PUBLIC_URL` and `SUPABASE_ANON_KEY` in Vercel (see table above).
4. In Claude.ai: Settings -> Connectors -> Add custom connector -> paste
   `https://<your-domain>/api/mcp` as the server URL. Leave OAuth Client
   ID/Secret blank - DCR handles that automatically. Click Connect, sign in
   with your admin email/password, and approve.

The first time you sign in this way, a new `mcp_agents` row named
`oauth:<your-email>` is created automatically with full (`*`) scope, since
the login is already gated on the Supabase `admin` role.

## Deployment (Vercel)

1. Create a new Vercel project from this repository (or connect an existing one).
2. Add the following environment variables to the Vercel project (Environment: Production and Preview):
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY (service role key — keep secret)
   - REGENT_ADMIN_EMAIL (only required for send-email edge function callers)
   - REGENT_ADMIN_PASSWORD
   - MCP_ALLOW_LOCAL_NO_AUTH (optional, set to `1` for local dev convenience only)
3. The `api/mcp.ts` serverless file is the Vercel entrypoint — the MCP SDK's
   Streamable HTTP transport must be available at the import path used there.
   If your installed SDK exposes a different module path, edit `api/mcp.ts` to
   import the correct transport.
4. Deploy to Vercel. After deployment, the MCP endpoint will be available as
   `https://<your-vercel-project>.vercel.app/api/mcp`.

Notes:
- The Vercel function uses the service role key server-side; requests to the
  endpoint must be authenticated with `Authorization: Bearer <api_key>` where
  `<api_key>` is an agent key created via the `create-agent` script or the
  admin dashboard (see below).

## Creating the first agent (bootstrap)

Because the admin dashboard reads `mcp_agents`, you need a first agent that
can be used by your AI agents. Two options:

A) Run the one-off script (recommended).

  SUPABASE_URL=https://... SUPABASE_SERVICE_ROLE_KEY=... npm run create-agent -- "Admin Agent" "*"

This prints a single API key once. Store it safely. The `*` scope grants
all permissions — treat it like a full admin key.

B) Use the Supabase SQL editor to insert a row into `mcp_agents` (not
recommended because you must compute the sha256 of the key yourself first).

When you create the first agent, you may want to immediately restrict it to
admin usage and generate additional narrower-scoped keys for production agents.

## Manual Supabase dashboard steps

1. In Supabase SQL editor run the migration files in `supabase/migrations/` in
   the order listed by name. The `pgcrypto` extension is enabled first.
2. Create Row Level Security (RLS) policies for `mcp_agents` and
   `mcp_call_log` so that only users with the `admin` role can read or write
   them from the web UI. The server-side MCP process uses the service role key
   and bypasses RLS when calling `supabase` via the service role client.
3. The `resource-files` and `content-images` storage buckets used by the
   storage tools above are created by migrations in the **website repo**
   (`regent-website`), not this one — apply those there first, or
   `upload_resource_file`/`list_bucket_contents` will fail with a
   bucket-not-found error.

Example minimal policies (adjust to your project's role helpers):

-- Allow select/insert/update/delete for admins only
create policy "mcp_agents_admins" on public.mcp_agents for all using (
  has_role(auth.uid(), 'admin')
);
create policy "mcp_call_log_admins" on public.mcp_call_log for select using (
  has_role(auth.uid(), 'admin')
);

If your project uses a different helper function than `has_role`, adapt the
policy accordingly.

## Security notes

- API keys are presented raw only at creation time and are stored hashed in
  the database (sha256). If a key is lost, revoke the agent and create a new
  key.
- Revoke an agent by setting `revoked = true` and `revoked_at = now()`; the
  wrapper immediately rejects calls from revoked keys.


The site also has these Edge Functions not yet wrapped as tools — add them the
same way as `edgeFunctions.ts` if you need them:

- `notify-consultation` — internal Slack/email notification on new consultation (likely fires automatically already, probably doesn't need an agent tool)
- `sync-resend-contact` — syncs a subscriber to Resend's audience list
- `unsubscribe` — handles unsubscribe links
- `newsletter-welcome` — welcome email on signup

Most of these are triggered automatically by DB writes/webhooks already, so
you likely only need to wrap ones an agent should invoke *directly* and
deliberately, like the two included here.
