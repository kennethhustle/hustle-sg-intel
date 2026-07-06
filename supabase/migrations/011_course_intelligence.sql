-- Migration 011: course market intelligence — category registry, per-provider
-- daily snapshots, and course-level change detection.

-- ─── course_categories: registry of strategic category clusters ──────────────
CREATE TABLE IF NOT EXISTS course_categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  keywords TEXT[],                -- indicative keywords (classification authority lives in code: src/lib/services/courses/categories.ts)
  description TEXT,
  priority INTEGER DEFAULT 50,    -- how strategic this category is to Hustle (0-100)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO course_categories (name, keywords, description, priority) VALUES
  ('ChatGPT / Claude / Copilot Tools', ARRAY['chatgpt','claude','gemini','copilot','prompt engineering'], 'Tool-specific generative AI courses', 90),
  ('AI / Generative AI', ARRAY['ai','artificial intelligence','generative ai','machine learning'], 'General AI and GenAI skills', 90),
  ('Social Media Marketing', ARRAY['social media','tiktok','instagram','influencer'], 'Platform-led social marketing', 80),
  ('Digital Marketing', ARRAY['digital marketing','seo','google ads','content marketing','e-commerce'], 'Broad digital marketing skills', 85),
  ('Canva / Design', ARRAY['canva','graphic design','figma','photoshop'], 'Design tools and visual content', 75),
  ('Videography / Photography / Content Creation', ARRAY['video','photography','capcut','content creation'], 'Media production and content', 75),
  ('Cybersecurity', ARRAY['cybersecurity','ethical hacking','data protection','pdpa'], 'Security and data protection', 40),
  ('Coding / Data / Analytics', ARRAY['python','data analytics','sql','excel','power bi'], 'Programming and data skills', 60),
  ('Finance / Accounting', ARRAY['finance','accounting','investment','xero'], 'Finance and accounting skills', 30),
  ('Culinary', ARRAY['culinary','baking','cooking','barista'], 'Food and beverage skills', 20),
  ('Wellness / Lifestyle', ARRAY['wellness','yoga','beauty','floristry'], 'Lifestyle and wellbeing', 20),
  ('Leadership / Management', ARRAY['leadership','management','coaching'], 'Leadership and people management', 50),
  ('Communication / Soft Skills', ARRAY['communication','presentation','soft skills'], 'Communication and interpersonal skills', 50),
  ('Business Productivity', ARRAY['business','productivity','project management','sales'], 'Business and productivity skills', 55),
  ('Other', ARRAY[]::TEXT[], 'Unclassified courses', 10)
ON CONFLICT (name) DO NOTHING;

-- ─── course_intelligence_snapshots: daily per-provider aggregates ─────────────
CREATE TABLE IF NOT EXISTS course_intelligence_snapshots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  snapshot_date DATE NOT NULL,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  total_courses INTEGER DEFAULT 0,
  total_runs INTEGER DEFAULT 0,
  category_breakdown JSONB,       -- { "<cluster>": { courses: n, runs: n } }
  top_courses JSONB,              -- [{ sf_ref_no, title, runs, respondents }]
  median_fee NUMERIC(10,2),
  average_rating NUMERIC(3,2),
  total_respondents INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(snapshot_date, provider_name)
);

CREATE INDEX IF NOT EXISTS idx_cis_provider_date
  ON course_intelligence_snapshots(provider_name, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_cis_competitor
  ON course_intelligence_snapshots(competitor_id, snapshot_date DESC);

-- ─── course_changes: detected differences between refreshes ───────────────────
CREATE TABLE IF NOT EXISTS course_changes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  provider_name TEXT,
  sf_ref_no TEXT,
  course_title TEXT,
  category TEXT,
  change_type TEXT NOT NULL CHECK (change_type IN (
    'new_course','removed_course','run_count_increase','run_count_decrease',
    'fee_change','rating_change','respondent_count_change','new_provider','provider_growth'
  )),
  old_value NUMERIC,
  new_value NUMERIC,
  change_amount NUMERIC,
  change_percentage NUMERIC(8,2),
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'myskillsfuture',
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_course_changes_detected
  ON course_changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_changes_type
  ON course_changes(change_type, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_course_changes_competitor
  ON course_changes(competitor_id, detected_at DESC);

-- ─── sf_courses: previous-value columns for cheap change detection ────────────
ALTER TABLE sf_courses
  ADD COLUMN IF NOT EXISTS prev_run_count INTEGER,
  ADD COLUMN IF NOT EXISTS prev_fee NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS prev_rating NUMERIC(3,2),
  ADD COLUMN IF NOT EXISTS prev_respondent_count INTEGER,
  ADD COLUMN IF NOT EXISTS demand_score NUMERIC(5,1),
  ADD COLUMN IF NOT EXISTS demand_breakdown JSONB;

-- ─── provider threat scores (course-market) stored per refresh ────────────────
CREATE TABLE IF NOT EXISTS provider_threat_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  provider_name TEXT NOT NULL,
  total_score NUMERIC(5,1) NOT NULL,
  threat_label TEXT CHECK (threat_label IN ('Critical Threat','High Threat','Medium Threat','Low Threat','Monitor')),
  breakdown JSONB,                -- per-factor inputs, normalized scores, weights
  evidence JSONB,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  is_current BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_pts_current ON provider_threat_scores(is_current, total_score DESC);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE course_categories             ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_intelligence_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_changes                ENABLE ROW LEVEL SECURITY;
ALTER TABLE provider_threat_scores        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'course_categories','course_intelligence_snapshots','course_changes','provider_threat_scores'
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
