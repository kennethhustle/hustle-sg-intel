-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- competitors
CREATE TABLE competitors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  website TEXT NOT NULL,
  is_hustle BOOLEAN DEFAULT false,
  color TEXT DEFAULT '#6366f1',
  tier TEXT CHECK (tier IN ('High','Mid','Low')) DEFAULT 'Mid',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- social_profiles
CREATE TABLE social_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('instagram','facebook','linkedin','tiktok','youtube')),
  handle TEXT,
  url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(competitor_id, platform)
);

-- social_metrics
CREATE TABLE social_metrics (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID REFERENCES social_profiles(id) ON DELETE CASCADE,
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  followers INTEGER,
  following INTEGER,
  posts_count INTEGER,
  engagement_rate DECIMAL(5,2),
  data_source TEXT CHECK (data_source IN ('scraped','api','verified','unavailable')) DEFAULT 'scraped',
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  error_message TEXT
);

-- job_postings
CREATE TABLE job_postings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  department TEXT,
  location TEXT,
  job_type TEXT,
  source TEXT NOT NULL,
  source_url TEXT,
  posted_at TIMESTAMPTZ,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  salary_min INTEGER,
  salary_max INTEGER,
  currency TEXT DEFAULT 'SGD',
  raw_data JSONB
);

-- course_catalog
CREATE TABLE course_catalog (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT,
  sub_category TEXT,
  price DECIMAL(10,2),
  currency TEXT DEFAULT 'SGD',
  duration_hours INTEGER,
  is_skillsfuture_claimable BOOLEAN DEFAULT false,
  skillsfuture_credit DECIMAL(10,2),
  source TEXT NOT NULL,
  source_url TEXT,
  scraped_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT true,
  raw_data JSONB
);

-- competitor_activity
CREATE TABLE competitor_activity (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  activity_type TEXT NOT NULL,
  platform TEXT,
  title TEXT,
  description TEXT,
  url TEXT,
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

-- alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  competitor_id UUID REFERENCES competitors(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('low','medium','high','critical')) DEFAULT 'medium',
  title TEXT NOT NULL,
  description TEXT,
  is_read BOOLEAN DEFAULT false,
  is_dismissed BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  metadata JSONB
);

-- strategic_insights
CREATE TABLE strategic_insights (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  insight_type TEXT NOT NULL CHECK (insight_type IN ('threat','opportunity','recommendation','market_position','growth_analysis','social_insight','hiring_intel','course_intel')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('low','medium','high','critical')) DEFAULT 'medium',
  competitor_ids UUID[],
  generated_by TEXT DEFAULT 'claude',
  model_version TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  metadata JSONB
);

-- users (extends Supabase auth.users)
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  role TEXT CHECK (role IN ('admin','analyst','viewer')) DEFAULT 'viewer',
  company TEXT DEFAULT 'Hustle SG',
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ DEFAULT NOW()
);

-- audit_logs
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT,
  resource_id UUID,
  metadata JSONB,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_social_metrics_competitor_id ON social_metrics(competitor_id);
CREATE INDEX idx_social_metrics_scraped_at ON social_metrics(scraped_at DESC);
CREATE INDEX idx_social_metrics_platform ON social_metrics(platform);
CREATE INDEX idx_job_postings_competitor_id ON job_postings(competitor_id);
CREATE INDEX idx_job_postings_posted_at ON job_postings(posted_at DESC);
CREATE INDEX idx_course_catalog_competitor_id ON course_catalog(competitor_id);
CREATE INDEX idx_alerts_is_read ON alerts(is_read, created_at DESC);
CREATE INDEX idx_strategic_insights_type ON strategic_insights(insight_type, created_at DESC);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id, created_at DESC);

-- RLS Policies
ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_postings ENABLE ROW LEVEL SECURITY;
ALTER TABLE course_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_activity ENABLE ROW LEVEL SECURITY;
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategic_insights ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read all data
CREATE POLICY "Authenticated read competitors" ON competitors FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read social_profiles" ON social_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read social_metrics" ON social_metrics FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read job_postings" ON job_postings FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read course_catalog" ON course_catalog FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read competitor_activity" ON competitor_activity FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read alerts" ON alerts FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated read strategic_insights" ON strategic_insights FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users read own" ON users FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Authenticated read audit_logs" ON audit_logs FOR SELECT TO authenticated USING (true);

-- Alerts update (mark read/dismissed)
CREATE POLICY "Authenticated update alerts" ON alerts FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- Service role can do anything (for cron jobs)
CREATE POLICY "Service role all competitors" ON competitors TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all social_profiles" ON social_profiles TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all social_metrics" ON social_metrics TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all job_postings" ON job_postings TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all course_catalog" ON course_catalog TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all competitor_activity" ON competitor_activity TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all alerts" ON alerts TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all strategic_insights" ON strategic_insights TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all users" ON users TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role all audit_logs" ON audit_logs TO service_role USING (true) WITH CHECK (true);

-- Function to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_competitors_updated_at
  BEFORE UPDATE ON competitors
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
