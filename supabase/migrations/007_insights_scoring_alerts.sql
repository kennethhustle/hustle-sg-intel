-- Migration 007: richer AI insights, transparent opportunity scoring,
-- and expanded alert fields.

-- ─── strategic_insights: new insight types + structured fields ────────────────
ALTER TABLE strategic_insights DROP CONSTRAINT IF EXISTS strategic_insights_insight_type_check;
ALTER TABLE strategic_insights ADD CONSTRAINT strategic_insights_insight_type_check
  CHECK (insight_type IN (
    -- legacy values (kept for existing rows)
    'threat','opportunity','recommendation','market_position','growth_analysis',
    'social_insight','hiring_intel','course_intel',
    -- new values
    'defensive_action','course_launch_idea','seo_opportunity',
    'marketing_opportunity','hiring_signal','market_shift'
  ));

ALTER TABLE strategic_insights
  ADD COLUMN IF NOT EXISTS confidence TEXT CHECK (confidence IN ('low','medium','high')),
  ADD COLUMN IF NOT EXISTS evidence JSONB,               -- array of evidence bullet strings
  ADD COLUMN IF NOT EXISTS recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS suggested_owner TEXT,          -- Marketing / Course Development / Sales / Management
  ADD COLUMN IF NOT EXISTS timeframe TEXT,                -- Immediate / This week / This month / Monitor
  ADD COLUMN IF NOT EXISTS related_categories TEXT[],
  ADD COLUMN IF NOT EXISTS data_sources TEXT[],
  ADD COLUMN IF NOT EXISTS data_freshness TEXT,
  ADD COLUMN IF NOT EXISTS opportunity_score NUMERIC(5,1);

-- ─── opportunity_scores: transparent rule-based 0–100 scoring ─────────────────
CREATE TABLE IF NOT EXISTS opportunity_scores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT NOT NULL,          -- course category cluster (e.g. 'AI / Generative AI')
  title TEXT NOT NULL,
  demand_score NUMERIC(5,1) NOT NULL DEFAULT 0,          -- 0–100
  competition_gap_score NUMERIC(5,1) NOT NULL DEFAULT 0, -- 0–100
  hustle_fit_score NUMERIC(5,1) NOT NULL DEFAULT 0,      -- 0–100
  urgency_score NUMERIC(5,1) NOT NULL DEFAULT 0,         -- 0–100
  total_score NUMERIC(5,1) NOT NULL DEFAULT 0,           -- weighted 35/25/20/20
  breakdown JSONB,                 -- per-factor inputs + weights, for explainable UI
  evidence JSONB,                  -- supporting data points shown on click
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  is_current BOOLEAN DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_opportunity_scores_current
  ON opportunity_scores(is_current, total_score DESC);

ALTER TABLE opportunity_scores ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated read opportunity_scores" ON opportunity_scores;
CREATE POLICY "Authenticated read opportunity_scores" ON opportunity_scores
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Service role all opportunity_scores" ON opportunity_scores;
CREATE POLICY "Service role all opportunity_scores" ON opportunity_scores
  TO service_role USING (true) WITH CHECK (true);

-- ─── alerts: evidence + action + source fields ────────────────────────────────
ALTER TABLE alerts
  ADD COLUMN IF NOT EXISTS recommended_action TEXT,
  ADD COLUMN IF NOT EXISTS data_source TEXT,
  ADD COLUMN IF NOT EXISTS evidence JSONB;
