import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../supabase.js";

/**
 * Shared filter set for the admin-gated analytics_* functions.
 *
 * Every analytics_* function takes the same optional parameters. p_from /
 * p_to are ISO-8601 timestamps (inclusive from, exclusive to); when both are
 * omitted the function defaults to the trailing 30 days. Functions that
 * compare against a previous period use the equal-length window immediately
 * before p_from. p_include_internal admits admin/internal traffic, which is
 * excluded from the default reports.
 */
const analyticsFilterShape = {
  p_from: z
    .string()
    .describe("ISO-8601 inclusive start timestamp, e.g. 2026-10-01T00:00:00Z. Defaults to now - 30 days.")
    .optional(),
  p_to: z
    .string()
    .describe("ISO-8601 exclusive end timestamp. Defaults to now.")
    .optional(),
  p_content_type: z
    .enum(["page", "blog_post", "case_study", "resource_download"])
    .describe("Restrict to one content type.")
    .optional(),
  p_slug: z
    .string()
    .describe("Restrict to a single piece of content by its slug (blog post, case study, or resource).")
    .optional(),
  p_source: z
    .enum(["paid", "email", "social", "organic_search", "internal", "referral", "direct"])
    .describe("Restrict to views attributed to this traffic channel.")
    .optional(),
  p_country: z
    .string()
    .describe("ISO-3166 country code (e.g. US, DE).")
    .optional(),
  p_device: z
    .enum(["desktop", "mobile", "tablet"])
    .describe("Restrict to this device type.")
    .optional(),
  p_include_internal: z
    .boolean()
    .describe("Include internal/admin traffic (excluded by default).")
    .optional(),
};

/** Call an analytics_* RPC passing through only the filter params that were set. */
function callAnalytics(name: string, args: Record<string, unknown>) {
  const params: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined && value !== null) params[key] = value;
  }
  return supabase.rpc(name, params);
}

/** Register one RPC-backed analytics_* tool with the shared filter schema. */
function registerAnalyticsTool(
  server: McpServer,
  name: string,
  title: string,
  description: string
) {
  server.registerTool(
    name,
    { title, description, inputSchema: analyticsFilterShape },
    async (args) => {
      const { data, error } = await callAnalytics(name, args as Record<string, unknown>);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}

const AGGREGATES_ONLY =
  "Returns aggregates only (counts, rates) — never raw per-visitor rows. Bot, duplicate and test traffic is excluded from every result.";

export function registerAnalyticsTools(server: McpServer) {
  // ---- GOVERNED AGGREGATE FUNCTIONS (WS4) -----------------------------
  registerAnalyticsTool(
    server,
    "analytics_overview",
    "Analytics overview with period comparison",
    `Headline metrics for the period: page views, unique visitors, sessions, engaged sessions and rate, average time on page, and conversions, each with the equal-length previous-period value and % change. ${AGGREGATES_ONLY} Use this as the default "how is the site doing" tool.`
  );
  registerAnalyticsTool(
    server,
    "analytics_daily",
    "Daily analytics series",
    `One row per day in the period: views, unique visitors, sessions, engaged sessions, conversions. ${AGGREGATES_ONLY} Use for time-series / trend questions.`
  );
  registerAnalyticsTool(
    server,
    "analytics_top_content",
    "Top performing content",
    `Per-content-piece aggregates for the period, sorted by views: content type, title, slug, views, unique visitors, average time on page, average scroll, engaged sessions, conversion count, last viewed. ${AGGREGATES_ONLY} Leave p_slug unset to rank all content.`
  );
  registerAnalyticsTool(
    server,
    "analytics_content_trend",
    "Per-content daily trend",
    `Daily views and unique visitors per content piece (top 25 pieces by default; restrict to one piece with p_slug). ${AGGREGATES_ONLY} Use to see how a specific post, case study or resource grew (or stalled) day by day.`
  );
  registerAnalyticsTool(
    server,
    "analytics_sources",
    "Traffic sources and channel attribution",
    `Sessions, unique visitors, views and conversions by attribution channel (paid, email, social, organic_search, internal, referral, direct) and source domain/app. ${AGGREGATES_ONLY} Use for "where does our traffic / our conversions come from".`
  );
  registerAnalyticsTool(
    server,
    "analytics_geo",
    "Audience geography",
    `Sessions, unique visitors, views and % share by country code. ${AGGREGATES_ONLY}`
  );
  registerAnalyticsTool(
    server,
    "analytics_devices",
    "Audience by device",
    `Sessions, unique visitors, views and % share by device type (desktop / mobile / tablet). ${AGGREGATES_ONLY}`
  );
  registerAnalyticsTool(
    server,
    "analytics_funnel",
    "Conversion funnel",
    `Visitors → engaged (≥30s on page or ≥50% scroll) → converted funnel with engaged rate, conversion rate, drop-off between stages, and the breakdown of consultation-request statuses. ${AGGREGATES_ONLY}`
  );
  registerAnalyticsTool(
    server,
    "analytics_unique_visitors",
    "Unique visitors over time",
    `Daily distinct visitor counts (and sessions) across the period, for cohort/returning-visitor questions. ${AGGREGATES_ONLY}`
  );

  // ---- LEGACY ANALYTICS TOOLS (kept for backward compatibility) --------
  server.registerTool(
    "get_content_analytics",
    {
      title: "Get content analytics",
      description:
        "Per-content-item view counts, average time on page, average scroll depth, and last-viewed timestamp, across blog posts, case studies, and resources. Sorted by view count descending.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.rpc("get_content_analytics");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_content_insights",
    {
      title: "Get content insights",
      description:
        "Automated content performance categorization: top-performing ('stellar'), recently trending ('improving'), and stale/underperforming content, each with a suggested next action.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.rpc("get_content_insights");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_daily_views",
    {
      title: "Get daily site views",
      description: "Daily page-view counts and unique session counts over a trailing window.",
      inputSchema: {
        days_back: z.number().int().min(1).max(365).optional().default(30),
      },
    },
    async ({ days_back }) => {
      const { data, error } = await supabase.rpc("get_daily_views", { days_back });
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_audience_breakdown",
    {
      title: "Get audience breakdown",
      description:
        "Visitor breakdown by dimension (e.g. device_type, browser, os, country) with counts per value.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.rpc("get_audience_breakdown");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_conversion_stats",
    {
      title: "Get conversion stats",
      description:
        "Conversion counts and rates by conversion type (e.g. newsletter signup, consultation request) derived from tracked content views.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.rpc("get_conversion_stats");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_analytics_detail",
    {
      title: "Get raw analytics detail",
      description:
        "Paginated raw page-view events with full detail: session, device, browser, os, country, city, referrer, scroll depth, time on page, and any conversion. Use for drill-down investigation; prefer the analytics_* aggregate tools for regular reporting.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().default(100),
        offset: z.number().int().min(0).optional().default(0),
      },
    },
    async ({ limit, offset }) => {
      const { data, error } = await supabase.rpc("get_analytics_detail", {
        p_limit: limit,
        p_offset: offset,
      });
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );

  server.registerTool(
    "get_admin_activity_log",
    {
      title: "Get admin activity log",
      description: "Recent admin actions taken across the site (content edits, publishes, etc.), most recent first.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().default(50),
      },
    },
    async ({ limit }) => {
      const { data, error } = await supabase
        .from("admin_activity_log")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    }
  );
}
