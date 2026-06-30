-- Migration: extend competitors table for full SaaS Competitor Management System
-- Adds social URLs, platform integration fields, ads data, display ordering

ALTER TABLE competitors
  ADD COLUMN IF NOT EXISTS short_name            text,
  ADD COLUMN IF NOT EXISTS logo_url              text,
  ADD COLUMN IF NOT EXISTS country               text DEFAULT 'Singapore',
  ADD COLUMN IF NOT EXISTS industry              text DEFAULT 'Training & Education',
  ADD COLUMN IF NOT EXISTS notes                 text,
  ADD COLUMN IF NOT EXISTS google_business_name  text,
  ADD COLUMN IF NOT EXISTS linkedin_company_slug text,
  ADD COLUMN IF NOT EXISTS facebook_url          text,
  ADD COLUMN IF NOT EXISTS instagram_url         text,
  ADD COLUMN IF NOT EXISTS youtube_url           text,
  ADD COLUMN IF NOT EXISTS tiktok_url            text,
  ADD COLUMN IF NOT EXISTS threads_url           text,
  ADD COLUMN IF NOT EXISTS twitter_url           text,
  ADD COLUMN IF NOT EXISTS mycareersfuture_name  text,
  ADD COLUMN IF NOT EXISTS myskillsfuture_provider_name text,
  ADD COLUMN IF NOT EXISTS google_ads_domain     text,
  ADD COLUMN IF NOT EXISTS meta_ads_page         text,
  ADD COLUMN IF NOT EXISTS display_order         integer DEFAULT 99,
  ADD COLUMN IF NOT EXISTS meta_ads_count        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS google_ads_est        integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_url            text;
