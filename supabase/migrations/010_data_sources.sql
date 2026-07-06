-- Migration 010: data source registry — live operational status of every
-- API, scraper, manual and static source feeding the dashboard.

CREATE TABLE IF NOT EXISTS data_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source_key TEXT UNIQUE NOT NULL,
  source_name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN
    ('api','scraper','manual','static_snapshot','ai_generated','database')),
  module TEXT NOT NULL CHECK (module IN
    ('course_intelligence','marketing_intelligence','hiring_intelligence',
     'social_intelligence','seo_intelligence','opportunity_engine','alerts','platform')),
  provider TEXT,
  endpoint_or_url TEXT,
  status TEXT NOT NULL DEFAULT 'not_configured' CHECK (status IN
    ('connected','working','partial','failed','unavailable','manual_only','static_only','not_configured')),
  last_success_at TIMESTAMPTZ,
  last_failed_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  last_response_time_ms INTEGER,
  records_fetched_last_run INTEGER,
  records_updated_last_run INTEGER,
  error_message TEXT,
  requires_api_key BOOLEAN DEFAULT false,
  api_key_env_name TEXT,          -- name only; key presence is checked server-side, value never stored
  is_enabled BOOLEAN DEFAULT true,
  reliability_level TEXT CHECK (reliability_level IN ('high','medium','low')) DEFAULT 'medium',
  stale_after_hours INTEGER,      -- data older than this = stale (NULL = no staleness rule)
  notes TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE data_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read data_sources" ON data_sources;
CREATE POLICY "Authenticated read data_sources" ON data_sources
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all data_sources" ON data_sources;
CREATE POLICY "Service role all data_sources" ON data_sources
  TO service_role USING (true) WITH CHECK (true);

-- ─── Seed the full source registry ────────────────────────────────────────────
INSERT INTO data_sources
  (source_key, source_name, source_type, module, provider, endpoint_or_url, status,
   requires_api_key, api_key_env_name, reliability_level, stale_after_hours, notes)
VALUES
  -- Course Intelligence
  ('myskillsfuture_api', 'MySkillsFuture Course Search API', 'api', 'course_intelligence', 'MySkillsFuture',
   'https://www.myskillsfuture.gov.sg/services/tex/individual/course-search', 'connected',
   false, NULL, 'medium', 48,
   'Unofficial/undocumented public endpoint — could change without notice. Provides course catalog, fees, ratings, respondent counts.'),
  ('mysf_run_scraper', 'MySkillsFuture Run Count Scraper', 'scraper', 'course_intelligence', 'MySkillsFuture',
   'https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory.html', 'connected',
   false, NULL, 'medium', 48,
   'Headless-Chrome scrape of course detail pages for upcoming run counts. Top courses per provider only.'),
  ('company_courses_scraper', 'Company Website Course Scraper', 'scraper', 'course_intelligence', 'Competitor websites',
   NULL, 'connected', false, NULL, 'low', 168,
   'Best-effort HTML/JSON-LD scrape of competitor course pages. Success varies by site structure.'),
  -- Marketing Intelligence
  ('meta_ad_library', 'Meta Ad Library API', 'api', 'marketing_intelligence', 'Meta',
   'https://graph.facebook.com/v19.0/ads_archive', 'connected',
   false, 'META_AD_LIBRARY_ACCESS_TOKEN', 'medium', 48,
   'Active ad counts (SG). Token optional but improves rate limits. No spend/targeting data.'),
  ('google_places', 'Google Places API', 'api', 'marketing_intelligence', 'Google',
   'https://maps.googleapis.com/maps/api/place', 'not_configured',
   true, 'GOOGLE_PLACES_API_KEY', 'high', 48,
   'Review counts and ratings. Place matched by text search — verify matches for ambiguous names.'),
  ('google_ads_transparency', 'Google Ads Transparency Center', 'manual', 'marketing_intelligence', 'Google',
   'https://adstransparency.google.com', 'manual_only',
   false, NULL, 'low', 336,
   'No public API — values entered manually. Stale after 14 days without re-verification.'),
  -- Hiring Intelligence
  ('mycareersfuture_api', 'MyCareersFuture API', 'api', 'hiring_intelligence', 'MyCareersFuture',
   'https://api.mycareersfuture.gov.sg/v2/jobs', 'connected',
   false, NULL, 'high', 48, 'Official public API for SG job postings, incl. salary ranges.'),
  ('jobstreet_scraper', 'JobStreet Scraper', 'scraper', 'hiring_intelligence', 'JobStreet',
   'https://www.jobstreet.com.sg', 'connected', false, NULL, 'low', 48,
   'Fragile HTML/JSON-LD scrape. CAPTCHA and layout changes cause failures.'),
  ('indeed_scraper', 'Indeed Scraper', 'scraper', 'hiring_intelligence', 'Indeed',
   'https://sg.indeed.com', 'connected', false, NULL, 'low', 48,
   'JSON-LD based scrape; bot detection possible.'),
  ('career_pages_scraper', 'Company Career Page Scraper', 'scraper', 'hiring_intelligence', 'Competitor websites',
   NULL, 'connected', false, NULL, 'medium', 48,
   'Best-effort scrape of /careers pages; may miss postings or catch false positives.'),
  -- Social Intelligence
  ('youtube_api', 'YouTube Data API', 'api', 'social_intelligence', 'YouTube',
   'https://www.googleapis.com/youtube/v3', 'not_configured',
   true, 'YOUTUBE_API_KEY', 'high', 48, 'Official API — subscribers and video counts.'),
  ('facebook_scraper', 'Facebook Scraper', 'scraper', 'social_intelligence', 'Meta',
   'https://www.facebook.com', 'unavailable', false, NULL, 'low', 48,
   'Facebook aggressively blocks scraping. Expect unavailable; use manual verified entries instead.'),
  ('instagram_scraper', 'Instagram Scraper', 'scraper', 'social_intelligence', 'Meta',
   'https://www.instagram.com', 'unavailable', false, NULL, 'low', 48,
   'Instagram blocks scraping. Use manual verified entries instead.'),
  ('linkedin_scraper', 'LinkedIn Scraper', 'scraper', 'social_intelligence', 'LinkedIn',
   'https://www.linkedin.com', 'unavailable', false, NULL, 'low', 48,
   'LinkedIn auth-walls scraping. Use manual verified entries instead.'),
  ('tiktok_scraper', 'TikTok Scraper', 'scraper', 'social_intelligence', 'TikTok',
   'https://www.tiktok.com', 'unavailable', false, NULL, 'low', 48,
   'TikTok bot detection blocks scraping. Use manual verified entries instead.'),
  ('social_manual', 'Manual Verified Social Metrics', 'manual', 'social_intelligence', 'Manual',
   NULL, 'manual_only', false, NULL, 'medium', 720,
   'Human-entered follower counts for blocked platforms. Stale after 30 days.'),
  -- SEO Intelligence
  ('seo_manual_snapshot', 'Manual SEO Snapshot', 'static_snapshot', 'seo_intelligence', 'Manual',
   NULL, 'static_only', false, NULL, 'low', 720,
   'Keyword rankings verified by hand via Google Search. Stale after 30 days. Automated rank tracking not connected.'),
  ('seo_rank_api', 'SEO Rank Tracking API (future)', 'api', 'seo_intelligence', 'Not connected',
   NULL, 'not_configured', true, 'SEO_RANK_API_KEY', 'high', 48,
   'Placeholder for SerpAPI / DataForSEO / Ahrefs / SEMrush integration. Not connected — do not fake.'),
  -- AI / Opportunity Engine
  ('claude_api', 'Claude API (Anthropic)', 'ai_generated', 'opportunity_engine', 'Claude',
   'https://api.anthropic.com', 'not_configured',
   true, 'ANTHROPIC_API_KEY', 'high', 48,
   'Generates strategic insights from cached intelligence. Output is AI-generated analysis, not source data.'),
  -- Platform
  ('supabase_cache', 'Supabase Cached Intelligence Layer', 'database', 'platform', 'Supabase',
   NULL, 'working', true, 'NEXT_PUBLIC_SUPABASE_URL', 'high', NULL,
   'All dashboard reads come from this cache; freshness depends on the nightly refresh window (12:00am SGT).')
ON CONFLICT (source_key) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_data_sources_module ON data_sources(module, status);

-- auto-update updated_at
DROP TRIGGER IF EXISTS update_data_sources_updated_at ON data_sources;
CREATE TRIGGER update_data_sources_updated_at
  BEFORE UPDATE ON data_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
