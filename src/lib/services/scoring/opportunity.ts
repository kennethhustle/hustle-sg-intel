/**
 * Rule-based opportunity scoring — computes a Demand / Competition-Gap /
 * Hustle-Fit / Urgency score per CATEGORY_CLUSTER (excluding 'Other') from
 * live Supabase data, persists the batch to opportunity_scores, and returns
 * it for immediate use (e.g. attaching to the Claude prompt payload).
 */
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_CLUSTERS, classifyCourse, type CategoryCluster } from '@/lib/services/courses/categories'

type SupabaseClient = Awaited<ReturnType<typeof createServiceClient>>

export interface ScoreFactor {
  /** Raw input value pulled from the data, before normalization. */
  raw: number | string
  /** Normalized 0-100 sub-score contributed by this factor. */
  normalized: number
  /** Weight of this factor within its parent score (0-1). */
  weight: number
}

export interface OpportunityBreakdown {
  demand: Record<string, ScoreFactor>
  competition_gap: Record<string, ScoreFactor>
  hustle_fit: Record<string, ScoreFactor>
  urgency: Record<string, ScoreFactor>
}

export interface OpportunityScore {
  id?: string
  category: string
  title: string
  demand_score: number
  competition_gap_score: number
  hustle_fit_score: number
  urgency_score: number
  total_score: number
  breakdown: OpportunityBreakdown
  evidence: string[]
  computed_at?: string
  is_current?: boolean
}

/**
 * Heuristic capability prior: Hustle is assumed to have baseline operational
 * capability (venues, trainers-on-call, SkillsFuture accreditation pipeline)
 * to launch a course in most clusters within a quarter. This is a fixed
 * constant, not derived from data — documented here for transparency.
 */
const HUSTLE_CAPABILITY_PRIOR = 20

interface CompetitorRow {
  id: string
  name: string
  is_hustle: boolean
}

interface CourseRow {
  competitor_id: string
  title: string
  category_text: string | null
  category_cluster: string | null
  respondent_count: number | null
  upcoming_run_count: number | null
  is_active: boolean
  first_seen_at: string | null
}

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Scale a value linearly against a soft max, clamped to 0-100. */
function scaleTo100(value: number, softMax: number): number {
  if (softMax <= 0) return 0
  return clamp((value / softMax) * 100)
}

export async function computeOpportunityScores(
  supabase: SupabaseClient
): Promise<{ scores: OpportunityScore[]; persisted: number }> {
  const now = Date.now()
  const fourteenDaysAgo = new Date(now - 14 * 24 * 60 * 60 * 1000).toISOString()

  const { data: competitorsRaw } = await supabase
    .from('competitors')
    .select('id, name, is_hustle')
    .eq('active', true)
    .is('archived_at', null)
    .eq('include_in_opportunity_engine', true)

  const competitors: CompetitorRow[] = ((competitorsRaw ?? []) as CompetitorRow[])
  const competitorIds = competitors.map((c) => c.id)
  const hustleCompetitor = competitors.find((c) => c.is_hustle) ?? null

  if (competitorIds.length === 0) {
    await markAllNotCurrent(supabase)
    return { scores: [], persisted: 0 }
  }

  const { data: coursesRaw } = await supabase
    .from('sf_courses')
    .select('competitor_id, title, category_text, category_cluster, respondent_count, upcoming_run_count, is_active, first_seen_at')
    .in('competitor_id', competitorIds)

  const courses: CourseRow[] = ((coursesRaw ?? []) as CourseRow[])

  const { data: marketingRaw } = await supabase
    .from('competitor_marketing_data')
    .select('competitor_id, meta_ads, google_reviews, google_rating')
    .in('competitor_id', competitorIds)

  type MarketingRow = { competitor_id: string; meta_ads: number | null; google_reviews: number | null; google_rating: number | null }
  const marketing: MarketingRow[] = ((marketingRaw ?? []) as MarketingRow[])

  const { data: snapshotsRaw } = await supabase
    .from('marketing_snapshots')
    .select('competitor_id, snapshot_date, meta_ads, sf_runs')
    .in('competitor_id', competitorIds)
    .order('snapshot_date', { ascending: false })

  type SnapshotRow = { competitor_id: string; snapshot_date: string; meta_ads: number | null; sf_runs: number | null }
  const snapshots: SnapshotRow[] = ((snapshotsRaw ?? []) as SnapshotRow[])

  const { data: jobsRaw } = await supabase
    .from('job_postings')
    .select('competitor_id, title, department, is_active, posted_at, scraped_at')
    .in('competitor_id', competitorIds)
    .eq('is_active', true)

  type JobRow = { competitor_id: string; title: string; department: string | null; is_active: boolean; posted_at: string | null; scraped_at: string }
  const jobs: JobRow[] = ((jobsRaw ?? []) as JobRow[])

  // Helper: classify a course into its cluster (fallback to classifyCourse if category_cluster is null)
  function clusterOf(c: CourseRow): CategoryCluster {
    return (c.category_cluster as CategoryCluster) || classifyCourse(c.title, c.category_text)
  }

  const clusters = CATEGORY_CLUSTERS.filter((c) => c !== 'Other')

  // Precompute per-cluster aggregates across the whole market
  const clusterAgg = new Map<
    CategoryCluster,
    {
      totalRuns: number
      totalRespondents: number
      competitorIdsInCluster: Set<string>
      runsByCompetitor: Map<string, number>
      newCoursesLast14d: number
    }
  >()

  for (const cluster of clusters) {
    clusterAgg.set(cluster, {
      totalRuns: 0,
      totalRespondents: 0,
      competitorIdsInCluster: new Set(),
      runsByCompetitor: new Map(),
      newCoursesLast14d: 0,
    })
  }

  for (const c of courses) {
    if (!c.is_active) continue
    const cluster = clusterOf(c)
    if (cluster === 'Other') continue
    const agg = clusterAgg.get(cluster)
    if (!agg) continue
    const runs = c.upcoming_run_count ?? 0
    agg.totalRuns += runs
    agg.totalRespondents += c.respondent_count ?? 0
    agg.competitorIdsInCluster.add(c.competitor_id)
    agg.runsByCompetitor.set(c.competitor_id, (agg.runsByCompetitor.get(c.competitor_id) ?? 0) + runs)
    if (c.first_seen_at && c.first_seen_at >= fourteenDaysAgo) {
      agg.newCoursesLast14d += 1
    }
  }

  // Market-wide soft maxima for normalization (derived from the data itself, avoids hardcoding)
  const maxTotalRuns = Math.max(1, ...Array.from(clusterAgg.values()).map((a) => a.totalRuns))
  const maxTotalRespondents = Math.max(1, ...Array.from(clusterAgg.values()).map((a) => a.totalRespondents))
  const maxCompetitorCount = Math.max(1, competitors.length)
  const maxRunsByAnyCompetitor = Math.max(1, ...Array.from(clusterAgg.values()).flatMap((a) => Array.from(a.runsByCompetitor.values())))

  // Marketing lookups
  const marketingByCompetitor = new Map(marketing.map((m) => [m.competitor_id, m]))

  // meta_ads growth: compare latest vs prior snapshot per competitor
  const metaAdsGrowthByCompetitor = new Map<string, number>()
  for (const compId of competitorIds) {
    const compSnaps = snapshots.filter((s) => s.competitor_id === compId)
    if (compSnaps.length >= 2) {
      const [latest, prev] = compSnaps
      if (latest.meta_ads !== null && prev.meta_ads !== null) {
        metaAdsGrowthByCompetitor.set(compId, latest.meta_ads - prev.meta_ads)
      }
    }
  }

  const scores: OpportunityScore[] = []

  for (const cluster of clusters) {
    const agg = clusterAgg.get(cluster)!
    const competitorCountInCluster = agg.competitorIdsInCluster.size

    // Skip clusters with zero market activity — nothing to score
    if (competitorCountInCluster === 0 && agg.totalRuns === 0) continue

    const evidence: string[] = []

    // ---------- Demand (0-100) ----------
    const demandRunsNorm = scaleTo100(agg.totalRuns, maxTotalRuns)
    const demandRespondentsNorm = scaleTo100(agg.totalRespondents, maxTotalRespondents)
    const demandCompetitorsNorm = scaleTo100(competitorCountInCluster, maxCompetitorCount)
    // Run growth vs marketing_snapshots history — not derivable at cluster granularity
    // (snapshots don't carry category breakdowns), so use neutral 50.
    const demandGrowthNorm = 50

    const demand =
      demandRunsNorm * 0.4 + demandRespondentsNorm * 0.3 + demandCompetitorsNorm * 0.15 + demandGrowthNorm * 0.15

    const demandBreakdown: Record<string, ScoreFactor> = {
      total_upcoming_runs: { raw: agg.totalRuns, normalized: round1(demandRunsNorm), weight: 0.4 },
      total_respondents: { raw: agg.totalRespondents, normalized: round1(demandRespondentsNorm), weight: 0.3 },
      competitor_count: { raw: competitorCountInCluster, normalized: round1(demandCompetitorsNorm), weight: 0.15 },
      run_growth: { raw: 'not derivable from cluster-level snapshots', normalized: demandGrowthNorm, weight: 0.15 },
    }

    if (agg.totalRuns > 0) {
      evidence.push(`Market has ${agg.totalRuns} upcoming runs across ${cluster} from ${competitorCountInCluster} competitor(s).`)
    }
    if (agg.totalRespondents > 0) {
      evidence.push(`${agg.totalRespondents} total respondents recorded for ${cluster} courses.`)
    }

    // ---------- Competition gap (0-100, higher = weaker competition) ----------
    const leaderCompId = [...agg.runsByCompetitor.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
    const leaderRuns = leaderCompId ? agg.runsByCompetitor.get(leaderCompId) ?? 0 : 0
    const leaderName = leaderCompId ? competitors.find((c) => c.id === leaderCompId)?.name ?? 'Unknown' : null

    const gapCompetitorsNorm = scaleTo100(competitorCountInCluster, maxCompetitorCount)
    const gapMaxRunsNorm = scaleTo100(leaderRuns, maxRunsByAnyCompetitor)

    // Review strength of cluster leader(s): use the leader's google_rating * log-scaled reviews as a proxy
    let leaderReviewStrengthNorm = 0
    if (leaderCompId) {
      const md = marketingByCompetitor.get(leaderCompId)
      if (md && md.google_rating !== null && md.google_reviews !== null) {
        // Normalize rating (0-5 -> 0-100) blended with review volume (soft max 500)
        const ratingNorm = clamp((md.google_rating / 5) * 100)
        const volumeNorm = scaleTo100(md.google_reviews, 500)
        leaderReviewStrengthNorm = ratingNorm * 0.5 + volumeNorm * 0.5
      }
    }

    const competitionStrength = gapCompetitorsNorm * 0.4 + gapMaxRunsNorm * 0.3 + leaderReviewStrengthNorm * 0.3
    const gap = clamp(100 - competitionStrength)

    const gapBreakdown: Record<string, ScoreFactor> = {
      competitor_count: { raw: competitorCountInCluster, normalized: round1(gapCompetitorsNorm), weight: 0.4 },
      max_competitor_runs: { raw: leaderRuns, normalized: round1(gapMaxRunsNorm), weight: 0.3 },
      leader_review_strength: {
        raw: leaderName ? `${leaderName}: ${marketingByCompetitor.get(leaderCompId!)?.google_rating ?? 'N/A'}★ / ${marketingByCompetitor.get(leaderCompId!)?.google_reviews ?? 'N/A'} reviews` : 'no leader',
        normalized: round1(leaderReviewStrengthNorm),
        weight: 0.3,
      },
    }

    if (leaderName) {
      evidence.push(`${leaderName} leads ${cluster} with ${leaderRuns} upcoming runs.`)
    } else {
      evidence.push(`No competitor currently leads ${cluster} — open field.`)
    }

    // ---------- Hustle fit (0-100) ----------
    const hustleOffersCluster = hustleCompetitor ? agg.competitorIdsInCluster.has(hustleCompetitor.id) : false
    const hustleRuns = hustleCompetitor ? agg.runsByCompetitor.get(hustleCompetitor.id) ?? 0 : 0
    const hustleShareNorm = agg.totalRuns > 0 ? clamp((hustleRuns / agg.totalRuns) * 100) : 0
    const hustleShareContribution = clamp((hustleShareNorm / 100) * 40)

    const offersFitPoints = hustleOffersCluster ? 40 : 20 // 20 = adjacent-cluster heuristic (no adjacency graph available, so any non-offering cluster gets the adjacent-cluster credit)

    const hustleFit = clamp(offersFitPoints + hustleShareContribution + HUSTLE_CAPABILITY_PRIOR)

    const fitBreakdown: Record<string, ScoreFactor> = {
      offers_cluster: {
        raw: hustleOffersCluster ? 'Hustle already offers this cluster' : 'Hustle does not currently offer this cluster (adjacent-cluster credit applied)',
        normalized: offersFitPoints,
        weight: offersFitPoints / 100,
      },
      hustle_run_share: { raw: `${hustleRuns}/${agg.totalRuns} runs`, normalized: round1(hustleShareNorm), weight: 0.4 },
      capability_prior: { raw: 'fixed heuristic constant', normalized: HUSTLE_CAPABILITY_PRIOR, weight: HUSTLE_CAPABILITY_PRIOR / 100 },
    }

    if (hustleCompetitor) {
      evidence.push(
        hustleOffersCluster
          ? `Hustle already runs ${hustleRuns} of ${agg.totalRuns} upcoming runs (${round1(hustleShareNorm)}% share) in ${cluster}.`
          : `Hustle has no active courses in ${cluster} yet.`
      )
    }

    // ---------- Urgency (0-100) ----------
    const urgencyNewCoursesNorm = scaleTo100(agg.newCoursesLast14d, Math.max(1, agg.competitorIdsInCluster.size))

    let urgencyMetaAdsNorm = 30 // neutral default
    if (leaderCompId && metaAdsGrowthByCompetitor.has(leaderCompId)) {
      const growth = metaAdsGrowthByCompetitor.get(leaderCompId)!
      urgencyMetaAdsNorm = growth > 0 ? clamp(50 + growth * 5) : clamp(50 + growth * 5, 0, 50)
    }

    // Hiring spike among cluster leaders — best-effort using leader's active job count as a proxy signal
    let urgencyHiringNorm = 30 // neutral default (not reliably derivable from cluster-level hiring data)
    if (leaderCompId) {
      const leaderJobs = jobs.filter((j) => j.competitor_id === leaderCompId)
      if (leaderJobs.length > 0) {
        urgencyHiringNorm = scaleTo100(leaderJobs.length, 10)
      }
    }

    const urgency = urgencyNewCoursesNorm * 0.4 + urgencyMetaAdsNorm * 0.3 + urgencyHiringNorm * 0.3

    const urgencyBreakdown: Record<string, ScoreFactor> = {
      new_courses_last_14d: { raw: agg.newCoursesLast14d, normalized: round1(urgencyNewCoursesNorm), weight: 0.4 },
      leader_meta_ads_change: {
        raw: leaderCompId && metaAdsGrowthByCompetitor.has(leaderCompId) ? metaAdsGrowthByCompetitor.get(leaderCompId)! : 'not derivable — neutral default applied',
        normalized: round1(urgencyMetaAdsNorm),
        weight: 0.3,
      },
      leader_hiring_activity: {
        raw: leaderCompId ? jobs.filter((j) => j.competitor_id === leaderCompId).length : 'no leader',
        normalized: round1(urgencyHiringNorm),
        weight: 0.3,
      },
    }

    if (agg.newCoursesLast14d > 0) {
      evidence.push(`${agg.newCoursesLast14d} new ${cluster} course(s) launched by competitors in the last 14 days.`)
    }

    const total = demand * 0.35 + gap * 0.25 + hustleFit * 0.2 + urgency * 0.2

    scores.push({
      category: cluster,
      title: `${cluster} Opportunity`,
      demand_score: round1(demand),
      competition_gap_score: round1(gap),
      hustle_fit_score: round1(hustleFit),
      urgency_score: round1(urgency),
      total_score: round1(total),
      breakdown: {
        demand: demandBreakdown,
        competition_gap: gapBreakdown,
        hustle_fit: fitBreakdown,
        urgency: urgencyBreakdown,
      },
      evidence: evidence.slice(0, 6),
    })
  }

  scores.sort((a, b) => b.total_score - a.total_score)

  const persisted = await persistScores(supabase, scores)

  return { scores, persisted }
}

async function markAllNotCurrent(supabase: SupabaseClient): Promise<void> {
  await supabase.from('opportunity_scores').update({ is_current: false }).eq('is_current', true)
}

async function persistScores(supabase: SupabaseClient, scores: OpportunityScore[]): Promise<number> {
  // Mark all existing rows as no longer current
  await markAllNotCurrent(supabase)

  if (scores.length === 0) return 0

  const rows = scores.map((s) => ({
    category: s.category,
    title: s.title,
    demand_score: s.demand_score,
    competition_gap_score: s.competition_gap_score,
    hustle_fit_score: s.hustle_fit_score,
    urgency_score: s.urgency_score,
    total_score: s.total_score,
    breakdown: s.breakdown,
    evidence: s.evidence,
    is_current: true,
  }))

  const { data: inserted, error } = await supabase.from('opportunity_scores').insert(rows).select('id')
  if (error) {
    throw new Error(`Failed to persist opportunity scores: ${error.message}`)
  }

  return inserted?.length ?? 0
}
