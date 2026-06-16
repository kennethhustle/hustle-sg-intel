-- Function: get_latest_social_metrics
-- Returns the latest metric per platform for a given competitor
CREATE OR REPLACE FUNCTION get_latest_social_metrics(competitor_uuid UUID)
RETURNS TABLE (
  id UUID,
  profile_id UUID,
  competitor_id UUID,
  platform TEXT,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  engagement_rate DECIMAL(5,2),
  data_source TEXT,
  scraped_at TIMESTAMPTZ,
  error_message TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT ON (sm.platform)
    sm.id,
    sm.profile_id,
    sm.competitor_id,
    sm.platform,
    sm.followers,
    sm.following,
    sm.posts_count,
    sm.engagement_rate,
    sm.data_source,
    sm.scraped_at,
    sm.error_message
  FROM social_metrics sm
  WHERE sm.competitor_id = competitor_uuid
  ORDER BY sm.platform, sm.scraped_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get_social_ranking
-- Returns competitors ordered by total followers across all platforms
CREATE OR REPLACE FUNCTION get_social_ranking()
RETURNS TABLE (
  competitor_id UUID,
  competitor_name TEXT,
  competitor_slug TEXT,
  competitor_color TEXT,
  is_hustle BOOLEAN,
  tier TEXT,
  instagram_followers INTEGER,
  facebook_followers INTEGER,
  linkedin_followers INTEGER,
  tiktok_followers INTEGER,
  youtube_followers INTEGER,
  total_followers BIGINT,
  rank BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH latest_metrics AS (
    SELECT DISTINCT ON (sm.competitor_id, sm.platform)
      sm.competitor_id,
      sm.platform,
      sm.followers
    FROM social_metrics sm
    ORDER BY sm.competitor_id, sm.platform, sm.scraped_at DESC
  ),
  aggregated AS (
    SELECT
      c.id AS comp_id,
      c.name AS comp_name,
      c.slug AS comp_slug,
      c.color AS comp_color,
      c.is_hustle AS comp_is_hustle,
      c.tier AS comp_tier,
      MAX(CASE WHEN lm.platform = 'instagram' THEN lm.followers END) AS ig_followers,
      MAX(CASE WHEN lm.platform = 'facebook' THEN lm.followers END) AS fb_followers,
      MAX(CASE WHEN lm.platform = 'linkedin' THEN lm.followers END) AS li_followers,
      MAX(CASE WHEN lm.platform = 'tiktok' THEN lm.followers END) AS tt_followers,
      MAX(CASE WHEN lm.platform = 'youtube' THEN lm.followers END) AS yt_followers,
      COALESCE(SUM(lm.followers), 0) AS total_follows
    FROM competitors c
    LEFT JOIN latest_metrics lm ON lm.competitor_id = c.id
    WHERE c.active = true
    GROUP BY c.id, c.name, c.slug, c.color, c.is_hustle, c.tier
  )
  SELECT
    a.comp_id,
    a.comp_name,
    a.comp_slug,
    a.comp_color,
    a.comp_is_hustle,
    a.comp_tier,
    a.ig_followers,
    a.fb_followers,
    a.li_followers,
    a.tt_followers,
    a.yt_followers,
    a.total_follows,
    RANK() OVER (ORDER BY a.total_follows DESC) AS rank
  FROM aggregated a
  ORDER BY a.total_follows DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get_competitor_dashboard_summary
-- Returns aggregated stats for the executive dashboard
CREATE OR REPLACE FUNCTION get_competitor_dashboard_summary()
RETURNS TABLE (
  total_competitors BIGINT,
  hustle_social_rank BIGINT,
  total_social_reach BIGINT,
  active_job_postings BIGINT,
  total_courses BIGINT,
  unread_alerts BIGINT,
  last_social_update TIMESTAMPTZ,
  last_jobs_update TIMESTAMPTZ,
  last_courses_update TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  WITH ranking AS (
    SELECT * FROM get_social_ranking()
  ),
  hustle_rank AS (
    SELECT r.rank AS hustle_r
    FROM ranking r
    WHERE r.is_hustle = true
    LIMIT 1
  ),
  total_reach AS (
    SELECT COALESCE(SUM(r.total_followers), 0) AS total_r
    FROM ranking r
    WHERE r.is_hustle = true
  )
  SELECT
    (SELECT COUNT(*) FROM competitors WHERE active = true) AS total_competitors,
    COALESCE((SELECT hustle_r FROM hustle_rank), 0) AS hustle_social_rank,
    COALESCE((SELECT total_r FROM total_reach), 0) AS total_social_reach,
    (SELECT COUNT(*) FROM job_postings WHERE is_active = true) AS active_job_postings,
    (SELECT COUNT(*) FROM course_catalog WHERE is_active = true) AS total_courses,
    (SELECT COUNT(*) FROM alerts WHERE is_read = false AND is_dismissed = false) AS unread_alerts,
    (SELECT MAX(scraped_at) FROM social_metrics) AS last_social_update,
    (SELECT MAX(scraped_at) FROM job_postings) AS last_jobs_update,
    (SELECT MAX(scraped_at) FROM course_catalog) AS last_courses_update;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function: get_platform_ranking
-- Returns ranking for a specific platform
CREATE OR REPLACE FUNCTION get_platform_ranking(p_platform TEXT)
RETURNS TABLE (
  competitor_id UUID,
  competitor_name TEXT,
  competitor_slug TEXT,
  competitor_color TEXT,
  is_hustle BOOLEAN,
  followers INTEGER,
  data_source TEXT,
  scraped_at TIMESTAMPTZ,
  rank BIGINT
) AS $$
BEGIN
  RETURN QUERY
  WITH latest AS (
    SELECT DISTINCT ON (sm.competitor_id)
      sm.competitor_id,
      sm.followers,
      sm.data_source,
      sm.scraped_at
    FROM social_metrics sm
    WHERE sm.platform = p_platform
    ORDER BY sm.competitor_id, sm.scraped_at DESC
  )
  SELECT
    c.id,
    c.name,
    c.slug,
    c.color,
    c.is_hustle,
    l.followers,
    l.data_source,
    l.scraped_at,
    RANK() OVER (ORDER BY COALESCE(l.followers, 0) DESC) AS rank
  FROM competitors c
  LEFT JOIN latest l ON l.competitor_id = c.id
  WHERE c.active = true
  ORDER BY COALESCE(l.followers, 0) DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to authenticated and service_role
GRANT EXECUTE ON FUNCTION get_latest_social_metrics(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_social_ranking() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_competitor_dashboard_summary() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_platform_ranking(TEXT) TO authenticated, service_role;
