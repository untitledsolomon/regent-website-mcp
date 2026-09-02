import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { supabase } from "../supabase.js";

export function registerAnalyticsTools(server: McpServer) {
  // ---- CONTENT PERFORMANCE ----
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

  // ---- CONTENT INSIGHTS / SUGGESTIONS ----
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

  // ---- DAILY VIEWS / TRAFFIC ----
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

  // ---- UNIQUE VISITORS ----
  server.registerTool(
    "get_unique_visitors_count",
    {
      title: "Get unique visitors count",
      description: "Total count of distinct visitors tracked across all time.",
      inputSchema: {},
    },
    async () => {
      const { data, error } = await supabase.rpc("get_unique_visitors_count");
      if (error) throw new Error(error.message);
      return { content: [{ type: "text", text: String(data) }] };
    }
  );

  // ---- AUDIENCE BREAKDOWN ----
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

  // ---- CONVERSION STATS ----
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

  // ---- RAW ANALYTICS DETAIL (paginated) ----
  server.registerTool(
    "get_analytics_detail",
    {
      title: "Get raw analytics detail",
      description:
        "Paginated raw page-view events with full detail: session, device, browser, os, country, city, referrer, scroll depth, time on page, and any conversion. Use for drill-down investigation; prefer the summary tools for regular reporting.",
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

  // ---- ADMIN ACTIVITY LOG ----
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
