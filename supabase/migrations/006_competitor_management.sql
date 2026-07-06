-- Migration 006: dynamic competitor management
-- Module tracking toggles, archive support, and multi-alias data sources
-- (replaces hardcoded provider-name maps in code).

-- ─── Tracking toggles + archive on competitors ────────────────────────────────
ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS track_courses   BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS track_hiring    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS track_marketing BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS track_social    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS track_seo       BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS include_in_opportunity_engine BOOLEAN DEFAULT true;

-- ─── competitor_data_sources: one competitor, many aliases per source ─────────
CREATE TABLE IF NOT EXISTS competitor_data_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID NOT NULL REFERENCES competitors(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN (
    'myskillsfuture','mycareersfuture','google_business','meta_ads',
    'google_ads','jobstreet','indeed','careers_page','website','social','seo_domain'
  )),
  platform TEXT,                -- e.g. 'instagram' when source_type = 'social'
  identifier TEXT NOT NULL,     -- provider name, company name, page id, handle, domain
  url TEXT,
  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  last_verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competitor_id, source_type, identifier)
);

CREATE INDEX IF NOT EXISTS idx_cds_competitor ON competitor_data_sources(competitor_id, source_type);

ALTER TABLE competitor_data_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read competitor_data_sources" ON competitor_data_sources;
CREATE POLICY "Authenticated read competitor_data_sources" ON competitor_data_sources
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all competitor_data_sources" ON competitor_data_sources;
CREATE POLICY "Service role all competitor_data_sources" ON competitor_data_sources
  TO service_role USING (true) WITH CHECK (true);

-- ─── Seed MySkillsFuture provider aliases ─────────────────────────────────────
-- Moves the mapping previously hardcoded in src/lib/services/ingestion/sf_courses.ts
-- into the database. Note Hustle SG maps to TWO provider entities.
INSERT INTO competitor_data_sources (competitor_id, source_type, identifier, is_primary)
SELECT c.id, 'myskillsfuture', v.alias, v.is_primary
FROM (VALUES
  ('BELLS Institute',    'BELLS INSTITUTE OF HIGHER LEARNING PTE. LTD.', true),
  ('Vertical Institute', 'VERTICAL INSTITUTE PTE. LTD.',                 true),
  ('OOm Pte Ltd',        'OOM PTE. LTD.',                                true),
  ('Skills Dev Academy', 'SKILLS DEVELOPMENT ACADEMY PTE. LTD.',         true),
  ('InfoTech Academy',   'INFO-TECH SYSTEMS LTD.',                       true),
  ('ASK Training',       '@ASK TRAINING PTE. LTD.',                      true),
  ('Heicoders Academy',  'HEICODERS ACADEMY PRIVATE LIMITED',            true),
  ('Happy Together',     'HAPPY TOGETHER PTE. LTD.',                     true),
  ('Equinet Academy',    'EQUINET ACADEMY PRIVATE LIMITED',              true),
  ('Hustle SG',          'HUSTLE INSTITUTE PTE. LTD.',                   true),
  ('Hustle SG',          'HUSTLE ACADEMY PTE. LTD.',                     false)
) AS v(comp_name, alias, is_primary)
JOIN competitors c ON c.name = v.comp_name
ON CONFLICT (competitor_id, source_type, identifier) DO NOTHING;

-- Backfill aliases from existing single-value competitor columns where present
INSERT INTO competitor_data_sources (competitor_id, source_type, identifier, is_primary)
SELECT id, 'mycareersfuture', mycareersfuture_name, true
FROM competitors
WHERE mycareersfuture_name IS NOT NULL AND mycareersfuture_name <> ''
ON CONFLICT (competitor_id, source_type, identifier) DO NOTHING;

INSERT INTO competitor_data_sources (competitor_id, source_type, identifier, is_primary)
SELECT id, 'google_business', google_business_name, true
FROM competitors
WHERE google_business_name IS NOT NULL AND google_business_name <> ''
ON CONFLICT (competitor_id, source_type, identifier) DO NOTHING;
