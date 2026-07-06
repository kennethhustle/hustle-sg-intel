/**
 * Intelligence payload builder — gathers a compact, structured snapshot of
 * competitive data from Supabase for the Claude strategic-insights prompt.
 *
 * Filters competitors to: active = true, archived_at IS NULL,
 * include_in_opportunity_engine = true.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_CLUSTERS, classifyCourse, type CategoryCluster } from '@/lib/services/courses/categories'
import { getSourceStatuses } from '@/lib/services/data-sources'
import { getCategoryIntelligence } from '@/lib/services/courses/intelligence'

type SupabaseClient = Awaited<ReturnType<typeof createServiceClient>>

export interface CompetitorOverview {
  /** Competitor UUID — included so consumers (e.g. claude.ts) can resolve
   *  AI-referenced competitor names back to DB ids for competitor_ids columns.
   *  Not sent to Claude itself (stripped from the prompt JSON). */
  id: string
  name: string
  tier: string
  website: string
  is_hustle: boolean
  top_category_clusters: string[]
}

export interface TopCourse {
  title: string
  runs: number
  respondents: number | null
  fee: number | null
}

export interface ClusterTotals {
  cluster: string
  runs: number
  course_count: number
}

export interface CourseIntelEntry {
  competitor: string
  active_course_count: number
  total_upcoming_runs: number
  top_courses: TopCourse[]
  courses_added_last_7d: number
  courses_deactivated_last_14d: number
  cluster_totals: ClusterTotals[]
  median_course_fee: number | null
}

export interface MarketingIntelEntry {
  competitor: string
  meta_ads: number | null
  google_ads: number | null
  google_ads_is_manual_estimate: boolean
  google_ads_verified_at: string | null
  google_reviews: number | null
  google_rating: number | null
  review_growth: number | null
  sf_runs: number | null
}

export interface SeoKeywordEntry {
  keyword: string
  category: string | null
  positions: Array<{ competitor: string; position: number | null; is_ad: boolean }>
}

export interface SeoIntelAvailable {
  available: true
  keywords: SeoKeywordEntry[]
  keywords_missing_hustle: string[]
  uncontested_keywords: string[]
  verified_at: string | null
  note: string
}

export interface SeoIntelUnavailable {
  available: false
}

export type SeoIntel = SeoIntelAvailable | SeoIntelUnavailable

export interface HiringIntelEntry {
  competitor: string
  active_job_count: number
  jobs_added_last_7d: number
  keyword_breakdown: { sales: number; trainer: number; curriculum: number; marketing: number; other: number }
  salary_ranges: Array<{ title: string; salary_min: number | null; salary_max: number | null; currency: string }>
}

export interface SocialIntelEntry {
  competitor: string
  youtube_followers: number | null
  youtube_snapshot_date: string | null
  verified_manual_entries: Array<{ platform: string; follower_count: number | null; verified_by: string | null; snapshot_date: string }>
}

export interface SocialIntel {
  competitors: SocialIntelEntry[]
  platforms_not_available_note: string
}

export interface AlertEntry {
  title: string
  severity: string
  created_at: string
}

export interface RefreshFailureEntry {
  module: string
  status: string
  error_message: string | null
  started_at: string
}

export interface DataFreshnessEntry {
  module: string
  last_success_at: string | null
}

export interface SourceStatusEntry {
  name: string
  module: string
  status: string
  reliability_level: 'high' | 'medium' | 'low'
  is_stale: boolean
  last_success_at: string | null
}

export interface ExcludedDataEntry {
  source: string
  module: string
  reason: string
  last_success_at: string | null
}

export interface CourseChangeSummaryEntry {
  change_type: string
  provider_name: string | null
  course_title: string | null
  category: string | null
  change_amount: number | null
  change_percentage: number | null
  detected_at: string
}

export interface ProviderThreatSummaryEntry {
  name: string
  score: number
  label: string
}

export interface CategoryIntelSummaryEntry {
  category: string
  runs: number
  providersCount: number
  hustleSharePct: number
  opportunityScore: number | null
}

export interface IntelligencePayload {
  competitorOverview: CompetitorOverview[]
  courseIntel: CourseIntelEntry[]
  marketingIntel: MarketingIntelEntry[]
  seoIntel: SeoIntel
  hiringIntel: HiringIntelEntry[]
  socialIntel: SocialIntel
  alertsAndChanges: {
    recentAlerts: AlertEntry[]
    recentRefreshFailures: RefreshFailureEntry[]
  }
  dataFreshness: DataFreshnessEntry[]
  recentInsightTitles: string[]
  sourceStatus: SourceStatusEntry[]
  excludedData: ExcludedDataEntry[]
  topCourseChanges: CourseChangeSummaryEntry[]
  providerThreatScores: ProviderThreatSummaryEntry[]
  categoryIntelSummary: CategoryIntelSummaryEntry[]
}

const TOP_N_COURSES = 5
const TOP_N_CLUSTERS = 3

interface CompetitorRow {
  id: string
  name: string
  tier: string
  website: string
  is_hustle: boolean
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function classifyJobKeyword(title: string, department: string | null): 'sales' | 'trainer' | 'curriculum' | 'marketing' | 'other' {
  const text = `${title} ${department ?? ''}`.toLowerCase()
  if (/sales|business development|bd exec/i.test(text)) return 'sales'
  if (/trainer|facilitator|instructor|coach/i.test(text)) return 'trainer'
  if (/curriculum|content develop|instructional design/i.test(text)) return 'curriculum'
  if (/marketing|brand|growth|social media/i.test(text)) return 'marketing'
  return 'other'
}

/**
 * Build the sourceStatus and excludedData sections from the live data source
 * registry (see data-sources.ts / migration 010_data_sources.sql). Only
 * enabled sources are included in sourceStatus, per spec. excludedData is
 * derived dynamically — any enabled source whose status means it can't
 * currently back a claim (unavailable/failed/not_configured), plus manual
 * and static sources (which are always "weak" in the sense of being
 * point-in-time snapshots rather than live data).
 */
async function buildSourceAwareness(): Promise<{ sourceStatus: SourceStatusEntry[]; excludedData: ExcludedDataEntry[] }> {
  const sources = await getSourceStatuses()
  const enabled = sources.filter((s) => s.is_enabled)

  const sourceStatus: SourceStatusEntry[] = enabled.map((s) => ({
    name: s.source_name,
    module: s.module,
    status: s.status,
    reliability_level: s.reliability_level,
    is_stale: s.is_stale,
    last_success_at: s.last_success_at,
  }))

  const excludedData: ExcludedDataEntry[] = enabled
    .filter((s) => ['unavailable', 'failed', 'not_configured', 'manual_only', 'static_only'].includes(s.status))
    .map((s) => {
      let reason: string
      switch (s.status) {
        case 'unavailable':
          reason = 'Source unavailable — do not cite as live data.'
          break
        case 'failed':
          reason = `Most recent run failed${s.error_message ? `: ${s.error_message}` : ''}.`
          break
        case 'not_configured':
          reason = 'Not configured — no API key/credential set up.'
          break
        case 'manual_only':
          reason = `Manual/point-in-time entry${s.last_success_at ? `, last verified ${s.last_success_at}` : ', never verified'}.`
          break
        default:
          reason = `Static snapshot${s.last_success_at ? `, last verified ${s.last_success_at}` : ', never verified'}.`
      }
      return {
        source: s.source_name,
        module: s.module,
        reason,
        last_success_at: s.last_success_at,
      }
    })

  return { sourceStatus, excludedData }
}

export async function buildIntelligencePayload(supabase: SupabaseClient): Promise<IntelligencePayload> {
  const now = Date.now()
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString()
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()
  const threeDaysAgo = new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString()

  // Base competitor set — active, not archived, included in opportunity engine
  const { data: competitorsRaw } = await supabase
    .from('competitors')
    .select('id, name, tier, website, is_hustle, active, archived_at, include_in_opportunity_engine')
    .eq('active', true)
    .is('archived_at', null)
    .eq('include_in_opportunity_engine', true)

  const competitors: CompetitorRow[] = (competitorsRaw ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    tier: c.tier as string,
    website: c.website as string,
    is_hustle: c.is_hustle as boolean,
  }))

  const competitorIds = competitors.map((c) => c.id)
  const competitorNameById = new Map(competitors.map((c) => [c.id, c.name]))

  if (competitorIds.length === 0) {
    const { sourceStatus, excludedData } = await buildSourceAwareness()
    return {
      competitorOverview: [],
      courseIntel: [],
      marketingIntel: [],
      seoIntel: { available: false },
      hiringIntel: [],
      socialIntel: { competitors: [], platforms_not_available_note: 'No competitors currently included in the opportunity engine.' },
      alertsAndChanges: { recentAlerts: [], recentRefreshFailures: [] },
      dataFreshness: [],
      recentInsightTitles: [],
      sourceStatus,
      excludedData,
      topCourseChanges: [],
      providerThreatScores: [],
      categoryIntelSummary: [],
    }
  }

  // ---------- Course intel ----------
  const { data: coursesRaw } = await supabase
    .from('sf_courses')
    .select('competitor_id, title, category_text, category_cluster, course_fee, popularity_score, respondent_count, quality_rating, upcoming_run_count, is_active, first_seen_at, last_seen_at')
    .in('competitor_id', competitorIds)

  type CourseRow = {
    competitor_id: string
    title: string
    category_text: string | null
    category_cluster: string | null
    course_fee: number | null
    popularity_score: number | null
    respondent_count: number | null
    quality_rating: number | null
    upcoming_run_count: number | null
    is_active: boolean
    first_seen_at: string | null
    last_seen_at: string | null
  }
  const courses: CourseRow[] = (coursesRaw ?? []) as CourseRow[]

  const courseIntel: CourseIntelEntry[] = competitors.map((comp) => {
    const compCourses = courses.filter((c) => c.competitor_id === comp.id)
    const activeCourses = compCourses.filter((c) => c.is_active)

    const totalUpcomingRuns = activeCourses.reduce((sum, c) => sum + (c.upcoming_run_count ?? 0), 0)

    const topCourses: TopCourse[] = [...activeCourses]
      .sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
      .slice(0, TOP_N_COURSES)
      .map((c) => ({
        title: c.title,
        runs: c.upcoming_run_count ?? 0,
        respondents: c.respondent_count ?? null,
        fee: c.course_fee ?? null,
      }))

    const addedLast7d = compCourses.filter((c) => c.first_seen_at && c.first_seen_at >= sevenDaysAgo).length
    const deactivatedLast14d = compCourses.filter(
      (c) => !c.is_active && c.last_seen_at && c.last_seen_at >= fourteenDaysAgo
    ).length

    const clusterMap = new Map<string, { runs: number; course_count: number }>()
    for (const c of activeCourses) {
      const cluster = (c.category_cluster as CategoryCluster) || classifyCourse(c.title, c.category_text)
      const entry = clusterMap.get(cluster) ?? { runs: 0, course_count: 0 }
      entry.runs += c.upcoming_run_count ?? 0
      entry.course_count += 1
      clusterMap.set(cluster, entry)
    }
    const clusterTotals: ClusterTotals[] = Array.from(clusterMap.entries())
      .map(([cluster, v]) => ({ cluster, runs: v.runs, course_count: v.course_count }))
      .sort((a, b) => b.runs - a.runs)

    const fees = activeCourses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)

    return {
      competitor: comp.name,
      active_course_count: activeCourses.length,
      total_upcoming_runs: totalUpcomingRuns,
      top_courses: topCourses,
      courses_added_last_7d: addedLast7d,
      courses_deactivated_last_14d: deactivatedLast14d,
      cluster_totals: clusterTotals.slice(0, TOP_N_CLUSTERS),
      median_course_fee: median(fees),
    }
  })

  // Competitor overview — top clusters by course count/runs
  const competitorOverview: CompetitorOverview[] = competitors.map((comp) => {
    const entry = courseIntel.find((ci) => ci.competitor === comp.name)
    return {
      id: comp.id,
      name: comp.name,
      tier: comp.tier,
      website: comp.website,
      is_hustle: comp.is_hustle,
      top_category_clusters: (entry?.cluster_totals ?? []).map((c) => c.cluster),
    }
  })

  // ---------- Marketing intel ----------
  const { data: marketingDataRaw } = await supabase
    .from('competitor_marketing_data')
    .select('competitor_id, meta_ads, google_ads, google_ads_verified_at, google_reviews, google_rating, sf_runs')
    .in('competitor_id', competitorIds)

  type MarketingRow = {
    competitor_id: string
    meta_ads: number | null
    google_ads: number | null
    google_ads_verified_at: string | null
    google_reviews: number | null
    google_rating: number | null
    sf_runs: number | null
  }
  const marketingData: MarketingRow[] = (marketingDataRaw ?? []) as MarketingRow[]

  const { data: snapshotsRaw } = await supabase
    .from('marketing_snapshots')
    .select('competitor_id, snapshot_date, google_reviews')
    .in('competitor_id', competitorIds)
    .order('snapshot_date', { ascending: false })

  type SnapshotRow = { competitor_id: string; snapshot_date: string; google_reviews: number | null }
  const snapshots: SnapshotRow[] = (snapshotsRaw ?? []) as SnapshotRow[]

  const marketingIntel: MarketingIntelEntry[] = competitors.map((comp) => {
    const md = marketingData.find((m) => m.competitor_id === comp.id)
    const compSnapshots = snapshots.filter((s) => s.competitor_id === comp.id)
    let reviewGrowth: number | null = null
    if (compSnapshots.length >= 2) {
      const [latest, prev] = compSnapshots
      if (latest.google_reviews !== null && prev.google_reviews !== null) {
        reviewGrowth = latest.google_reviews - prev.google_reviews
      }
    }
    return {
      competitor: comp.name,
      meta_ads: md?.meta_ads ?? null,
      google_ads: md?.google_ads ?? null,
      google_ads_is_manual_estimate: true,
      google_ads_verified_at: md?.google_ads_verified_at ?? null,
      google_reviews: md?.google_reviews ?? null,
      google_rating: md?.google_rating ?? null,
      review_growth: reviewGrowth,
      sf_runs: md?.sf_runs ?? null,
    }
  })

  // ---------- SEO intel ----------
  const { data: seoKeywordsRaw } = await supabase
    .from('seo_keywords')
    .select('id, keyword, category')
    .eq('active', true)
    .limit(50)

  type SeoKeywordRow = { id: string; keyword: string; category: string | null }
  const seoKeywords: SeoKeywordRow[] = (seoKeywordsRaw ?? []) as SeoKeywordRow[]

  let seoIntel: SeoIntel = { available: false }

  if (seoKeywords.length > 0) {
    const keywordIds = seoKeywords.map((k) => k.id)
    const { data: rankingsRaw } = await supabase
      .from('seo_rankings')
      .select('keyword_id, competitor_id, competitor_name, position, is_ad, checked_at')
      .in('keyword_id', keywordIds)
      .order('checked_at', { ascending: false })

    type RankingRow = {
      keyword_id: string
      competitor_id: string | null
      competitor_name: string | null
      position: number | null
      is_ad: boolean
      checked_at: string
    }
    const rankings: RankingRow[] = (rankingsRaw ?? []) as RankingRow[]

    const { data: metaRaw } = await supabase
      .from('seo_snapshot_meta')
      .select('verified_at')
      .order('verified_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (rankings.length > 0) {
      const hustleNames = new Set(competitors.filter((c) => c.is_hustle).map((c) => c.name))

      const keywordEntries: SeoKeywordEntry[] = seoKeywords.slice(0, 30).map((kw) => {
        const kwRankings = rankings.filter((r) => r.keyword_id === kw.id)
        const positions = kwRankings.map((r) => ({
          competitor: r.competitor_name ?? competitorNameById.get(r.competitor_id ?? '') ?? 'Unknown',
          position: r.position,
          is_ad: r.is_ad,
        }))
        return { keyword: kw.keyword, category: kw.category, positions }
      })

      const keywordsMissingHustle = keywordEntries
        .filter((ke) => !ke.positions.some((p) => hustleNames.has(p.competitor)))
        .map((ke) => ke.keyword)
        .slice(0, 20)

      const uncontestedKeywords = seoKeywords
        .filter((kw) => !rankings.some((r) => r.keyword_id === kw.id))
        .map((kw) => kw.keyword)
        .slice(0, 20)

      seoIntel = {
        available: true,
        keywords: keywordEntries,
        keywords_missing_hustle: keywordsMissingHustle,
        uncontested_keywords: uncontestedKeywords,
        verified_at: (metaRaw as { verified_at: string } | null)?.verified_at ?? null,
        note: 'manual snapshot',
      }
    }
  }

  // ---------- Hiring intel ----------
  const { data: jobsRaw } = await supabase
    .from('job_postings')
    .select('competitor_id, title, department, is_active, posted_at, scraped_at, salary_min, salary_max, currency')
    .in('competitor_id', competitorIds)
    .eq('is_active', true)

  type JobRow = {
    competitor_id: string
    title: string
    department: string | null
    is_active: boolean
    posted_at: string | null
    scraped_at: string
    salary_min: number | null
    salary_max: number | null
    currency: string
  }
  const jobs: JobRow[] = (jobsRaw ?? []) as JobRow[]

  const hiringIntel: HiringIntelEntry[] = competitors.map((comp) => {
    const compJobs = jobs.filter((j) => j.competitor_id === comp.id)
    const addedLast7d = compJobs.filter((j) => (j.posted_at ?? j.scraped_at) >= sevenDaysAgo).length

    const breakdown = { sales: 0, trainer: 0, curriculum: 0, marketing: 0, other: 0 }
    for (const j of compJobs) {
      breakdown[classifyJobKeyword(j.title, j.department)] += 1
    }

    const salaryRanges = compJobs
      .filter((j) => j.salary_min !== null || j.salary_max !== null)
      .slice(0, 10)
      .map((j) => ({ title: j.title, salary_min: j.salary_min, salary_max: j.salary_max, currency: j.currency }))

    return {
      competitor: comp.name,
      active_job_count: compJobs.length,
      jobs_added_last_7d: addedLast7d,
      keyword_breakdown: breakdown,
      salary_ranges: salaryRanges,
    }
  })

  // ---------- Social intel ----------
  const { data: socialRaw } = await supabase
    .from('social_snapshots')
    .select('competitor_id, platform, follower_count, snapshot_date, data_source, verified_by')
    .in('competitor_id', competitorIds)
    .order('snapshot_date', { ascending: false })

  type SocialRow = {
    competitor_id: string
    platform: string
    follower_count: number | null
    snapshot_date: string
    data_source: string | null
    verified_by: string | null
  }
  const socialRows: SocialRow[] = (socialRaw ?? []) as SocialRow[]

  const observedPlatforms = new Set(socialRows.map((s) => s.platform))

  const socialIntelEntries: SocialIntelEntry[] = competitors.map((comp) => {
    const compRows = socialRows.filter((s) => s.competitor_id === comp.id)
    const youtubeRows = compRows.filter((s) => s.platform === 'youtube')
    const latestYoutube = youtubeRows[0] // already sorted desc by snapshot_date

    const verifiedManual = compRows
      .filter((s) => s.data_source === 'verified_manual')
      .map((s) => ({
        platform: s.platform,
        follower_count: s.follower_count,
        verified_by: s.verified_by,
        snapshot_date: s.snapshot_date,
      }))

    return {
      competitor: comp.name,
      youtube_followers: latestYoutube?.follower_count ?? null,
      youtube_snapshot_date: latestYoutube?.snapshot_date ?? null,
      verified_manual_entries: verifiedManual,
    }
  })

  const fullPlatformSet = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'threads']
  const missingPlatforms = fullPlatformSet.filter((p) => !observedPlatforms.has(p) && p !== 'youtube')
  const platformsNote =
    missingPlatforms.length > 0
      ? `Only YouTube follower counts and manually verified entries are available. No automated data source covers: ${missingPlatforms.join(', ')}.`
      : 'Only YouTube and manually verified entries are available.'

  const socialIntel: SocialIntel = {
    competitors: socialIntelEntries,
    platforms_not_available_note: platformsNote,
  }

  // ---------- Alerts and changes ----------
  const { data: alertsRaw } = await supabase
    .from('alerts')
    .select('title, severity, created_at')
    .order('created_at', { ascending: false })
    .limit(20)

  const recentAlerts: AlertEntry[] = ((alertsRaw ?? []) as Array<{ title: string; severity: string; created_at: string }>).map((a) => ({
    title: a.title,
    severity: a.severity,
    created_at: a.created_at,
  }))

  const { data: refreshFailuresRaw } = await supabase
    .from('data_refresh_logs')
    .select('module, status, error_message, started_at')
    .in('status', ['failed', 'partial'])
    .order('started_at', { ascending: false })
    .limit(10)

  const recentRefreshFailures: RefreshFailureEntry[] = ((refreshFailuresRaw ?? []) as Array<{
    module: string
    status: string
    error_message: string | null
    started_at: string
  }>).map((r) => ({ module: r.module, status: r.status, error_message: r.error_message, started_at: r.started_at }))

  // ---------- Data freshness ----------
  const { data: freshnessRaw } = await supabase
    .from('data_refresh_logs')
    .select('module, status, started_at')
    .eq('status', 'success')
    .order('started_at', { ascending: false })
    .limit(200)

  type FreshnessRow = { module: string; status: string; started_at: string }
  const freshnessRows: FreshnessRow[] = (freshnessRaw ?? []) as FreshnessRow[]
  const freshnessByModule = new Map<string, string>()
  for (const row of freshnessRows) {
    if (!freshnessByModule.has(row.module)) {
      freshnessByModule.set(row.module, row.started_at)
    }
  }
  const dataFreshness: DataFreshnessEntry[] = Array.from(freshnessByModule.entries()).map(([module, last_success_at]) => ({
    module,
    last_success_at,
  }))

  // ---------- Recent insight titles (dedup instruction) ----------
  const { data: recentInsightsRaw } = await supabase
    .from('strategic_insights')
    .select('title, created_at')
    .gte('created_at', threeDaysAgo)
    .order('created_at', { ascending: false })
    .limit(50)

  const recentInsightTitles: string[] = ((recentInsightsRaw ?? []) as Array<{ title: string }>).map((i) => i.title)

  // ---------- Data source status awareness ----------
  const { sourceStatus, excludedData } = await buildSourceAwareness()

  // ---------- Course market intelligence (additive, migration 011) ----------
  const TOP_N_COURSE_CHANGES = 15

  const { data: courseChangesRaw } = await supabase
    .from('course_changes')
    .select('change_type, provider_name, course_title, category, change_amount, change_percentage, detected_at')
    .gte('detected_at', sevenDaysAgo)
    .order('detected_at', { ascending: false })
    .limit(TOP_N_COURSE_CHANGES)

  const topCourseChanges: CourseChangeSummaryEntry[] = ((courseChangesRaw ?? []) as Array<{
    change_type: string
    provider_name: string | null
    course_title: string | null
    category: string | null
    change_amount: number | null
    change_percentage: number | null
    detected_at: string
  }>).map((r) => ({
    change_type: r.change_type,
    provider_name: r.provider_name,
    course_title: r.course_title,
    category: r.category,
    change_amount: r.change_amount,
    change_percentage: r.change_percentage,
    detected_at: r.detected_at,
  }))

  const { data: threatRaw } = await supabase
    .from('provider_threat_scores')
    .select('provider_name, total_score, threat_label')
    .eq('is_current', true)
    .order('total_score', { ascending: false })

  const providerThreatScores: ProviderThreatSummaryEntry[] = ((threatRaw ?? []) as Array<{
    provider_name: string
    total_score: number
    threat_label: string
  }>).map((r) => ({ name: r.provider_name, score: r.total_score, label: r.threat_label }))

  let categoryIntelSummary: CategoryIntelSummaryEntry[] = []
  try {
    const categoryIntel = await getCategoryIntelligence()
    categoryIntelSummary = categoryIntel
      .filter((c) => c.category !== 'Other')
      .map((c) => ({
        category: c.category,
        runs: c.runs,
        providersCount: c.providersCount,
        hustleSharePct: c.hustle.sharePct,
        opportunityScore: c.opportunity?.score ?? null,
      }))
  } catch (err) {
    console.error('buildIntelligencePayload: getCategoryIntelligence failed:', err)
  }

  return {
    competitorOverview,
    courseIntel,
    marketingIntel,
    seoIntel,
    hiringIntel,
    socialIntel,
    alertsAndChanges: { recentAlerts, recentRefreshFailures },
    dataFreshness,
    recentInsightTitles,
    sourceStatus,
    excludedData,
    topCourseChanges,
    providerThreatScores,
    categoryIntelSummary,
  }
}

// Re-export for consumers that want the canonical cluster list alongside the payload type.
export type { CategoryCluster }
export { CATEGORY_CLUSTERS }
