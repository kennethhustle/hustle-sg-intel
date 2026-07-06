-- Migration 008: SEO intelligence moved from hardcoded page constants into
-- Supabase. Data remains a MANUAL SNAPSHOT (Google Ads Transparency-style rank
-- tracking has no free API); the tables make the snapshot visible, dated,
-- and updatable without code changes. Seed data lives in migration 009.

CREATE TABLE IF NOT EXISTS seo_keywords (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword TEXT UNIQUE NOT NULL,
  category TEXT,                  -- e.g. 'AI Courses', 'Digital Marketing'
  intent TEXT,                    -- e.g. 'commercial', 'informational'
  notes TEXT,
  source_url TEXT,                -- the exact Google search URL used to verify
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seo_rankings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  keyword_id UUID NOT NULL REFERENCES seo_keywords(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  competitor_name TEXT,           -- denormalised fallback for non-tracked rankers
  position INTEGER,               -- NULL = not ranking in top 10
  is_ad BOOLEAN DEFAULT false,
  url TEXT,
  page_title TEXT,
  checked_at TIMESTAMPTZ NOT NULL,
  source TEXT CHECK (source IN ('manual','api')) DEFAULT 'manual',
  verified_by TEXT,
  notes TEXT,
  UNIQUE(keyword_id, competitor_id, competitor_name, checked_at)
);

-- Single-row-ish table describing the state of the SEO module snapshot
CREATE TABLE IF NOT EXISTS seo_snapshot_meta (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  verified_at DATE NOT NULL,
  verified_by TEXT,
  method TEXT DEFAULT 'Manual Google Search (gl=sg, pws=0, hl=en)',
  next_review_at DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_rankings_keyword ON seo_rankings(keyword_id, checked_at DESC);

ALTER TABLE seo_keywords      ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_rankings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_snapshot_meta ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['seo_keywords','seo_rankings','seo_snapshot_meta'] LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS "Authenticated read %1$s" ON %1$s;
       CREATE POLICY "Authenticated read %1$s" ON %1$s FOR SELECT TO authenticated USING (true);
       DROP POLICY IF EXISTS "Service role all %1$s" ON %1$s;
       CREATE POLICY "Service role all %1$s" ON %1$s TO service_role USING (true) WITH CHECK (true);',
      t
    );
  END LOOP;
END $$;
