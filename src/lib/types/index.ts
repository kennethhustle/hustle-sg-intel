export type Platform = 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube'
export type DataSource = 'scraped' | 'api' | 'verified' | 'unavailable'
export type Tier = 'High' | 'Mid' | 'Low'
export type AlertSeverity = 'low' | 'medium' | 'high' | 'critical'
export type InsightType =
  | 'threat'
  | 'opportunity'
  | 'recommendation'
  | 'market_position'
  | 'growth_analysis'
  | 'social_insight'
  | 'hiring_intel'
  | 'course_intel'
export type UserRole = 'admin' | 'analyst' | 'viewer'

export interface Competitor {
  id: string
  name: string
  slug: string
  website: string
  is_hustle: boolean
  color: string
  tier: Tier
  active: boolean
  created_at: string
  updated_at: string
}

export interface SocialProfile {
  id: string
  competitor_id: string
  platform: Platform
  handle: string | null
  url: string | null
  active: boolean
}

export interface SocialMetric {
  id: string
  profile_id: string
  competitor_id: string
  platform: Platform
  followers: number | null
  following: number | null
  posts_count: number | null
  engagement_rate: number | null
  data_source: DataSource
  scraped_at: string
  error_message: string | null
}

export interface JobPosting {
  id: string
  competitor_id: string
  title: string
  department: string | null
  location: string | null
  job_type: string | null
  source: string
  source_url: string | null
  posted_at: string | null
  scraped_at: string
  is_active: boolean
  salary_min: number | null
  salary_max: number | null
  currency: string
}

export interface Course {
  id: string
  competitor_id: string
  title: string
  category: string | null
  sub_category: string | null
  price: number | null
  currency: string
  duration_hours: number | null
  is_skillsfuture_claimable: boolean
  skillsfuture_credit: number | null
  source: string
  source_url: string | null
  scraped_at: string
  is_active: boolean
}

export interface Alert {
  id: string
  competitor_id: string | null
  alert_type: string
  severity: AlertSeverity
  title: string
  description: string | null
  is_read: boolean
  is_dismissed: boolean
  created_at: string
  metadata: Record<string, unknown> | null
}

export interface StrategicInsight {
  id: string
  insight_type: InsightType
  title: string
  body: string
  severity: AlertSeverity
  competitor_ids: string[] | null
  generated_by: string
  model_version: string | null
  created_at: string
  expires_at: string | null
}

export interface User {
  id: string
  email: string
  full_name: string | null
  role: UserRole
  company: string
  avatar_url: string | null
  created_at: string
  last_seen_at: string
}

export interface SocialRankingEntry {
  competitor: Competitor
  metrics: Partial<Record<Platform, SocialMetric | null>>
  total_followers: number
  rank: number
}

export interface DashboardSummary {
  total_competitors: number
  our_social_rank: number
  total_social_reach: number
  active_job_postings: number
  total_courses: number
  unread_alerts: number
  last_updated: string
}

export interface ScraperResult<T> {
  success: boolean
  data: T | null
  error: string | null
  scraped_at: string
  source: string
}

export interface BenchmarkRow {
  competitor: Competitor
  instagram: number | null
  facebook: number | null
  linkedin: number | null
  tiktok: number | null
  youtube: number | null
  total: number
  last_updated: string | null
  data_sources: Partial<Record<Platform, DataSource>>
}

export interface PlatformRankingEntry {
  competitor_id: string
  competitor_name: string
  competitor_slug: string
  competitor_color: string
  is_hustle: boolean
  followers: number | null
  data_source: DataSource | null
  scraped_at: string | null
  rank: number
}
