-- Fix get_content_analytics: exclude non-content view types (site_view, page)
-- and fix resource join (content_type is 'resource', not just 'resource_download')
CREATE OR REPLACE FUNCTION public.get_content_analytics()
 RETURNS TABLE(content_type text, content_id uuid, title text, view_count bigint, avg_time_on_page numeric, avg_scroll_depth numeric)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT
    cv.content_type, cv.content_id,
    COALESCE(bp.title, cs.title, r.title, 'Unknown') AS title,
    COUNT(*) AS view_count,
    ROUND(AVG(cv.time_on_page)::numeric, 1) AS avg_time_on_page,
    ROUND(AVG(cv.scroll_depth)::numeric, 1) AS avg_scroll_depth
  FROM content_views cv
  LEFT JOIN blog_posts bp ON cv.content_id = bp.id AND cv.content_type = 'blog_post'
  LEFT JOIN case_studies cs ON cv.content_id = cs.id AND cv.content_type = 'case_study'
  LEFT JOIN resources r ON cv.content_id = r.id AND cv.content_type IN ('resource', 'resource_download')
  WHERE cv.content_type IN ('blog_post', 'case_study', 'resource', 'resource_download')
  GROUP BY cv.content_type, cv.content_id, bp.title, cs.title, r.title
  ORDER BY view_count DESC;
$function$;

-- Fix get_analytics_detail: same resource join fix, keep site_view/page rows
-- (this is the drill-down/raw tool, so raw traffic rows are legitimately useful here)
-- but give them a sane title instead of "Unknown" so they're not confused with broken joins.
CREATE OR REPLACE FUNCTION public.get_analytics_detail(p_limit integer DEFAULT 200, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, content_type text, content_id uuid, title text, created_at timestamp with time zone, country text, city text, device_type text, browser text, os text, referrer text, session_id text, time_on_page integer, scroll_depth integer, is_returning boolean, converted_to text)
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT
    cv.id, cv.content_type, cv.content_id,
    COALESCE(bp.title, cs.title, r.title,
      CASE WHEN cv.content_type IN ('site_view', 'page') THEN initcap(replace(cv.content_type, '_', ' '))
           ELSE 'Unknown' END
    ) AS title,
    cv.created_at, cv.country, cv.city, cv.device_type, cv.browser, cv.os,
    cv.referrer, cv.session_id, cv.time_on_page, cv.scroll_depth,
    cv.is_returning, cv.converted_to
  FROM content_views cv
  LEFT JOIN blog_posts bp ON cv.content_id = bp.id AND cv.content_type = 'blog_post'
  LEFT JOIN case_studies cs ON cv.content_id = cs.id AND cv.content_type = 'case_study'
  LEFT JOIN resources r ON cv.content_id = r.id AND cv.content_type IN ('resource', 'resource_download')
  ORDER BY cv.created_at DESC
  LIMIT p_limit OFFSET p_offset;
$function$;
