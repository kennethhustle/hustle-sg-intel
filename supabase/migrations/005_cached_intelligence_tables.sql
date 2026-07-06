-- Migration 005: version-control the cached-intelligence tables that were
-- previously created ad hoc in the Supabase dashboard (schema drift fix).
-- All statements are idempotent so this runs safely against the existing
-- production database AND rebuilds a fresh environment correctly.

-- ─── data_refresh_logs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS data_refresh_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  module TEXT NOT NULL,
  source TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT CHECK (status IN ('running','success','partial','failed')) DEFAULT 'running',
  duration_seconds NUMERIC,
  records_updated INTEGER,
  error_message TEXT,
  triggered_by TEXT DEFAULT 'cron',
  metadata JSONB
);

-- Extended freshness/observability columns (new)
ALTER TABLE data_refresh_logs
  ADD COLUMN IF NOT EXISTS records_fetched  INTEGER,
  ADD COLUMN IF NOT EXISTS records_inserted INTEGER,
  ADD COLUMN IF NOT EXISTS records_failed   INTEGER,
  ADD COLUMN IF NOT EXISTS competitor_id    UUID REFERENCES competitors(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_refresh_logs_module ON data_refresh_logs(module, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_refresh_logs_status ON data_refresh_logs(status, started_at DESC);

-- ─── sf_courses (MySkillsFuture catalog cache) ────────────────────────────────
CREATE TABLE IF NOT EXISTS sf_courses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  sf_ref_no TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  provider_name TEXT,
  category_text TEXT,
  course_fee NUMERIC(10,2),
  popularity_score NUMERIC(5,1),
  respondent_count INTEGER,
  quality_rating NUMERIC(3,2),
  has_active_runs BOOLEAN DEFAULT false,
  course_mode TEXT,
  source_api_url TEXT,
  upcoming_run_count INTEGER DEFAULT 0,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- Change-detection columns (new): allow "new course" / "course removed" alerts
ALTER TABLE sf_courses
  ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_seen_at  TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS is_active     BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS category_cluster TEXT;

CREATE INDEX IF NOT EXISTS idx_sf_courses_competitor ON sf_courses(competitor_id);
CREATE INDEX IF NOT EXISTS idx_sf_courses_provider ON sf_courses(provider_name);

-- ─── provider_top_runs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS provider_top_runs (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL,
  course_name TEXT NOT NULL,
  course_url TEXT,
  upcoming_run_count INTEGER DEFAULT 0,
  rank INTEGER,
  competitor_name TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── social_snapshots (daily follower snapshots for trends) ───────────────────
CREATE TABLE IF NOT EXISTS social_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  follower_count INTEGER,
  total_posts INTEGER,
  data_confidence TEXT CHECK (data_confidence IN ('high','medium','low')) DEFAULT 'medium',
  snapshot_date DATE NOT NULL,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competitor_id, platform, snapshot_date)
);

-- Manual verified entry support (new)
ALTER TABLE social_snapshots
  ADD COLUMN IF NOT EXISTS data_source TEXT CHECK (data_source IN ('api','scraped','verified_manual')) DEFAULT 'scraped',
  ADD COLUMN IF NOT EXISTS verified_by TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT;

CREATE INDEX IF NOT EXISTS idx_social_snapshots_comp ON social_snapshots(competitor_id, platform, snapshot_date DESC);

-- ─── social_content_themes (manually curated) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS social_content_themes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  theme TEXT NOT NULL,
  percentage NUMERIC(5,2),
  source TEXT DEFAULT 'manual',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── competitor_marketing_data ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS competitor_marketing_data (
  competitor_id UUID PRIMARY KEY REFERENCES competitors(id) ON DELETE CASCADE,
  meta_ads INTEGER,
  google_reviews INTEGER,
  google_rating NUMERIC(3,2),
  google_ads INTEGER,
  sf_runs INTEGER,
  sf_respondents INTEGER,
  review_url TEXT,
  meta_ads_url TEXT,
  google_ads_url TEXT,
  sf_url TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Manual-data honesty columns for Google Ads estimates (new)
ALTER TABLE competitor_marketing_data
  ADD COLUMN IF NOT EXISTS google_ads_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS google_ads_source_url  TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_notes       TEXT,
  ADD COLUMN IF NOT EXISTS google_ads_entered_by  TEXT;

-- ─── marketing_snapshots (daily history for review/ad growth trends, new) ─────
CREATE TABLE IF NOT EXISTS marketing_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  meta_ads INTEGER,
  google_reviews INTEGER,
  google_rating NUMERIC(3,2),
  sf_runs INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competitor_id, snapshot_date)
);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE data_refresh_logs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE sf_courses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_top_runs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_snapshots         ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_content_themes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_marketing_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketing_snapshots      ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'data_refresh_logs','sf_courses','provider_top_runs','social_snapshots',
    'social_content_themes','competitor_marketing_data','marketing_snapshots'
  ] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Authenticated read %1$s" ON %1$s;
       CREATE POLICY "Authenticated read %1$s" ON %1$s FOR SELECT TO authenticated USING (true);
       DROP POLICY IF EXISTS "Service role all %1$s" ON %1$s;
       CREATE POLICY "Service role all %1$s" ON %1$s TO service_role USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;
