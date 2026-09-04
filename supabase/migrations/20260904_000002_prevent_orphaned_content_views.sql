-- ============================================================
-- Prevent orphaned content_views rows (polymorphic FK via triggers)
-- content_views.content_id can point to blog_posts, case_studies,
-- or resources depending on content_type, so a normal FK column
-- can't express this. We enforce it with triggers instead:
--   1) BEFORE INSERT/UPDATE on content_views: reject rows whose
--      content_id doesn't exist in the matching content table
--      (for content_types that map to real content tables).
--   2) AFTER DELETE on each content table: cascade-delete any
--      content_views rows that referenced the deleted row.
-- ============================================================

-- 1. Validate on insert/update into content_views
CREATE OR REPLACE FUNCTION public.check_content_view_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.content_type = 'blog_post' THEN
    IF NOT EXISTS (SELECT 1 FROM blog_posts WHERE id = NEW.content_id) THEN
      RAISE EXCEPTION 'content_views: no blog_posts row with id % (content_type=blog_post)', NEW.content_id;
    END IF;
  ELSIF NEW.content_type = 'case_study' THEN
    IF NOT EXISTS (SELECT 1 FROM case_studies WHERE id = NEW.content_id) THEN
      RAISE EXCEPTION 'content_views: no case_studies row with id % (content_type=case_study)', NEW.content_id;
    END IF;
  ELSIF NEW.content_type IN ('resource', 'resource_download') THEN
    IF NOT EXISTS (SELECT 1 FROM resources WHERE id = NEW.content_id) THEN
      RAISE EXCEPTION 'content_views: no resources row with id % (content_type=%)', NEW.content_id, NEW.content_type;
    END IF;
  END IF;
  -- other content_types (e.g. site_view, page) are not tied to a content
  -- table and are intentionally left unchecked.
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_content_view_reference ON public.content_views;
CREATE TRIGGER trg_check_content_view_reference
  BEFORE INSERT OR UPDATE ON public.content_views
  FOR EACH ROW
  EXECUTE FUNCTION public.check_content_view_reference();

-- 2. Cascade-delete content_views rows when their content is deleted
CREATE OR REPLACE FUNCTION public.cascade_delete_content_views()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_TABLE_NAME = 'blog_posts' THEN
    DELETE FROM content_views WHERE content_id = OLD.id AND content_type = 'blog_post';
  ELSIF TG_TABLE_NAME = 'case_studies' THEN
    DELETE FROM content_views WHERE content_id = OLD.id AND content_type = 'case_study';
  ELSIF TG_TABLE_NAME = 'resources' THEN
    DELETE FROM content_views WHERE content_id = OLD.id AND content_type IN ('resource', 'resource_download');
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_cascade_delete_blog_posts ON public.blog_posts;
CREATE TRIGGER trg_cascade_delete_blog_posts
  AFTER DELETE ON public.blog_posts
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_content_views();

DROP TRIGGER IF EXISTS trg_cascade_delete_case_studies ON public.case_studies;
CREATE TRIGGER trg_cascade_delete_case_studies
  AFTER DELETE ON public.case_studies
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_content_views();

DROP TRIGGER IF EXISTS trg_cascade_delete_resources ON public.resources;
CREATE TRIGGER trg_cascade_delete_resources
  AFTER DELETE ON public.resources
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_delete_content_views();
