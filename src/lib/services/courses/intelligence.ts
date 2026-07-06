/**
 * Course market intelligence — the post-refresh computation layer for the
 * MySkillsFuture course dataset (migration 011).
 *
 * Pipeline (runCourseIntelligencePipeline): demand scoring -> change
 * detection -> daily snapshots -> provider growth changes -> threat scores
 * -> opportunity scores. Called after run counts refresh (cron + manual).
 *
 * Read-side functions (getCourseMarketSnapshot, getProviderCourseLeaderboard,
 * getCourseLeaderboard, getCategoryIntelligence, getHustleGapAnalysis,
 * getRecentCourseChanges) are the contract the UI is built against — field
 * names and shapes here are load-bearing, do not rename without updating
 * consumers.
 *
 * DUAL HUSTLE PROVIDERS (migration 012): Hustle Singapore has TWO
 * MySkillsFuture provider entities — 'HUSTLE ACADEMY' and 'HUSTLE INSTITUTE
 * PTE. LTD.' — stored as two competitor_data_sources aliases under the SAME
 * competitor row ('Hustle SG', is_hustle=true). Every grouping in this file
 * keys by PROVIDER ENTITY (sf_courses.provider_name), not by competitor_id,
 * so the two Hustle entities are ranked/displayed as separate provider rows
 * everywhere while still resolving to the same underlying competitor (color,
 * is_hustle) via buildProviderDisplayMap(). Non-Hustle competitors have
 * exactly one active alias each, so this is a no-op behavior change for them.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { CATEGORY_CLUSTERS, normalizeCluster, type CategoryCluster } from '@/lib/services/courses/categories'
import { computeOpportunityScores } from '@/lib/services/scoring/opportunity'

type SupabaseClient = Awaited<ReturnType<typeof createServiceClient>>

// ─── Shared helpers ─────────────────────────────────────────────────────────

function clamp(n: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, n))
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((s, v) => s + v, 0) / values.length
}

function scaleTo100(value: number, softMax: number): number {
  if (softMax <= 0) return 0
  return clamp((value / softMax) * 100)
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function todayDateString(): string {
  return new Date().toISOString().slice(0, 10)
}

/** MySkillsFuture course-detail URL, mirrors ingestion/sf_run_counts.ts. */
function buildCourseUrl(sfRefNo: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${sfRefNo}#schedule`
}

// ─── Shared row types ───────────────────────────────────────────────────────

interface CompetitorRow {
  id: string
  name: string
  color: string | null
  is_hustle: boolean
}

interface SfCourseRow {
  id: string
  competitor_id: string | null
  sf_ref_no: string
  title: string
  provider_name: string | null
  category_text: string | null
  category_cluster: string | null
  course_fee: number | null
  popularity_score: number | null
  respondent_count: number | null
  quality_rating: number | null
  has_active_runs: boolean | null
  course_mode: string | null
  upcoming_run_count: number | null
  prev_run_count: number | null
  prev_fee: number | null
  prev_rating: number | null
  prev_respondent_count: number | null
  demand_score: number | null
  demand_breakdown: unknown
  scraped_at: string | null
  first_seen_at: string | null
  last_seen_at: string | null
  is_active: boolean
}

const SF_COURSE_COLUMNS =
  'id, competitor_id, sf_ref_no, title, provider_name, category_text, category_cluster, course_fee, popularity_score, respondent_count, quality_rating, has_active_runs, course_mode, upcoming_run_count, prev_run_count, prev_fee, prev_rating, prev_respondent_count, demand_score, demand_breakdown, scraped_at, first_seen_at, last_seen_at, is_active'

async function loadActiveCompetitors(supabase: SupabaseClient): Promise<CompetitorRow[]> {
  const { data } = await supabase
    .from('competitors')
    .select('id, name, color, is_hustle')
    .eq('active', true)
    .is('archived_at', null)
  return ((data ?? []) as CompetitorRow[])
}

async function loadActiveCourses(supabase: SupabaseClient): Promise<SfCourseRow[]> {
  const { data } = await supabase
    .from('sf_courses')
    .select(SF_COURSE_COLUMNS)
    .eq('is_active', true)
  return ((data ?? []) as unknown as SfCourseRow[])
}

function clusterOf(c: { category_cluster: string | null }): CategoryCluster {
  return normalizeCluster(c.category_cluster)
}

// ─── Provider entity display resolution (migration 012) ────────────────────
//
// Grouping key everywhere in this file is PROVIDER_NAME (sf_courses raw
// TP_ALIAS), not competitor_id — a competitor with two active MySkillsFuture
// aliases (Hustle SG) therefore produces two separate provider rows. This
// map resolves each provider_name to its display name + competitor metadata.

export interface ProviderDisplay {
  providerName: string
  displayName: string
  color: string | null
  isHustle: boolean
  competitorId: string | null
}

/** Title-case a raw provider_name and strip common company suffixes, for providers with no alias row. */
function fallbackDisplayName(providerName: string): string {
  const stripped = providerName
    .replace(/\bPTE\.?\s*LTD\.?$/i, '')
    .replace(/\bPRIVATE\s+LIMITED$/i, '')
    .replace(/\bLTD\.?$/i, '')
    .trim()
  const base = stripped.length > 0 ? stripped : providerName
  return base
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/**
 * Build provider_name -> display metadata for every active MySkillsFuture
 * alias, joined to its competitor. Providers appearing in sf_courses without
 * a matching alias row (should not normally happen) fall back to a
 * title-cased provider_name with no color/competitor and isHustle=false.
 */
async function buildProviderDisplayMap(
  supabase: SupabaseClient,
  competitors: CompetitorRow[]
): Promise<Map<string, ProviderDisplay>> {
  const competitorById = new Map(competitors.map((c) => [c.id, c]))

  const { data: sourceRows } = await supabase
    .from('competitor_data_sources')
    .select('competitor_id, identifier, display_name')
    .eq('source_type', 'myskillsfuture')
    .eq('is_active', true)

  const map = new Map<string, ProviderDisplay>()
  for (const row of (sourceRows ?? []) as Array<{ competitor_id: string; identifier: string; display_name: string | null }>) {
    const comp = competitorById.get(row.competitor_id) ?? null
    map.set(row.identifier, {
      providerName: row.identifier,
      displayName: row.display_name ?? comp?.name ?? row.identifier,
      color: comp?.color ?? null,
      isHustle: comp?.is_hustle ?? false,
      competitorId: row.competitor_id,
    })
  }
  return map
}

/** Resolve a provider_name to its display metadata, with a safe fallback for unmapped providers. */
function resolveProvider(providerName: string | null, providerMap: Map<string, ProviderDisplay>): ProviderDisplay {
  const name = providerName ?? 'Unknown'
  const found = providerMap.get(name)
  if (found) return found
  return {
    providerName: name,
    displayName: name === 'Unknown' ? 'Unknown' : fallbackDisplayName(name),
    color: null,
    isHustle: false,
    competitorId: null,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// a. runCourseIntelligencePipeline
// ══════════════════════════════════════════════════════════════════════════

export interface PipelineResult {
  changes: number
  snapshots: number
  threats: number
}

export async function runCourseIntelligencePipeline(): Promise<PipelineResult> {
  const supabase = await createServiceClient()

  let changes = 0
  let snapshots = 0
  let threats = 0

  try {
    await computeDemandScores(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: demand scoring failed:', err)
  }

  try {
    changes += await detectCourseChanges(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: course change detection failed:', err)
  }

  try {
    snapshots = await writeDailySnapshots(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: snapshot write failed:', err)
  }

  try {
    changes += await detectProviderGrowthChanges(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: provider growth detection failed:', err)
  }

  try {
    threats = await computeProviderThreatScores(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: threat scoring failed:', err)
  }

  try {
    await computeOpportunityScores(supabase)
  } catch (err) {
    console.error('runCourseIntelligencePipeline: opportunity scoring failed:', err)
  }

  return { changes, snapshots, threats }
}

// ─── Demand scoring ─────────────────────────────────────────────────────────

async function computeDemandScores(supabase: SupabaseClient): Promise<void> {
  const courses = await loadActiveCourses(supabase)
  if (courses.length === 0) return

  const maxRuns = Math.max(1, ...courses.map((c) => c.upcoming_run_count ?? 0))
  const maxRespondents = Math.max(1, ...courses.map((c) => c.respondent_count ?? 0))

  // Category momentum: today's aggregate runs per cluster vs the most recent
  // prior snapshot day's aggregate (any provider), computed here directly
  // from sf_courses (this runs BEFORE snapshots are written for today).
  const categoryRunsNow = new Map<CategoryCluster, number>()
  for (const c of courses) {
    const cluster = clusterOf(c)
    categoryRunsNow.set(cluster, (categoryRunsNow.get(cluster) ?? 0) + (c.upcoming_run_count ?? 0))
  }

  const { data: snapshotRows } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, category_breakdown')
    .order('snapshot_date', { ascending: false })
    .limit(500)

  const mostRecentPriorDate = Array.from(
    new Set(((snapshotRows ?? []) as Array<{ snapshot_date: string }>).map((r) => r.snapshot_date))
  ).find((d) => d !== todayDateString())

  const categoryRunsPrior = new Map<CategoryCluster, number>()
  if (mostRecentPriorDate) {
    for (const row of (snapshotRows ?? []) as Array<{ snapshot_date: string; category_breakdown: unknown }>) {
      if (row.snapshot_date !== mostRecentPriorDate) continue
      const breakdown = (row.category_breakdown ?? {}) as Record<string, { courses: number; runs: number }>
      for (const [cluster, v] of Object.entries(breakdown)) {
        categoryRunsPrior.set(cluster as CategoryCluster, (categoryRunsPrior.get(cluster as CategoryCluster) ?? 0) + (v.runs ?? 0))
      }
    }
  }

  const updates: Array<{ sf_ref_no: string; demand_score: number; demand_breakdown: unknown }> = []

  for (const c of courses) {
    const runs = c.upcoming_run_count ?? 0
    const runScore = scaleTo100(runs, maxRuns)

    const respondents = c.respondent_count ?? 0
    const respondentScore = respondents > 0 ? scaleTo100(Math.log10(respondents + 1), Math.log10(maxRespondents + 1)) : 0

    const ratingScore = c.quality_rating !== null && c.quality_rating !== undefined ? clamp((c.quality_rating / 5) * 100) : 50

    let growthScore = 50
    let growthInput: string | number = 'no prior run count recorded'
    if (c.prev_run_count !== null && c.prev_run_count !== undefined) {
      const delta = runs - c.prev_run_count
      growthInput = delta
      if (delta > 0) {
        growthScore = clamp(50 + scaleTo100(delta, Math.max(1, c.prev_run_count)) * 0.5)
      } else if (delta < 0) {
        growthScore = clamp(50 + delta * 5, 0, 50)
      } else {
        growthScore = 50
      }
    }

    const cluster = clusterOf(c)
    let categoryMomentumScore = 50
    let momentumInput: string | number = 'no prior snapshot for category'
    if (mostRecentPriorDate) {
      const now = categoryRunsNow.get(cluster) ?? 0
      const prior = categoryRunsPrior.get(cluster) ?? 0
      if (prior > 0) {
        const pct = ((now - prior) / prior) * 100
        momentumInput = round1(pct)
        categoryMomentumScore = pct > 0 ? clamp(50 + scaleTo100(pct, 50) * 0.5) : clamp(50 + pct * 0.5, 0, 50)
      } else if (now > 0) {
        momentumInput = 'category newly active'
        categoryMomentumScore = 70
      }
    }

    const demandScore =
      runScore * 0.4 + respondentScore * 0.25 + ratingScore * 0.15 + growthScore * 0.1 + categoryMomentumScore * 0.1

    const breakdown = {
      run_volume: { input: runs, normalized: round1(runScore), weight: 0.4 },
      respondents: { input: respondents, normalized: round1(respondentScore), weight: 0.25 },
      rating: { input: c.quality_rating ?? null, normalized: round1(ratingScore), weight: 0.15 },
      run_growth: { input: growthInput, normalized: round1(growthScore), weight: 0.1 },
      category_momentum: { input: momentumInput, normalized: round1(categoryMomentumScore), weight: 0.1 },
    }

    updates.push({ sf_ref_no: c.sf_ref_no, demand_score: round1(demandScore), demand_breakdown: breakdown })
  }

  // Batch upsert in chunks on minimal columns (onConflict sf_ref_no).
  const CHUNK = 500
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK)
    const { error } = await supabase
      .from('sf_courses')
      .upsert(chunk, { onConflict: 'sf_ref_no', ignoreDuplicates: false })
    if (error) {
      console.error('computeDemandScores: batch upsert failed:', error.message)
    }
  }
}

// ─── Change detection ───────────────────────────────────────────────────────

interface ChangeRow {
  competitor_id: string | null
  provider_name: string | null
  sf_ref_no: string | null
  course_title: string | null
  category: string | null
  change_type: string
  old_value: number | null
  new_value: number | null
  change_amount: number | null
  change_percentage: number | null
  metadata?: Record<string, unknown> | null
}

async function alreadyChanged(
  supabase: SupabaseClient,
  changeType: string,
  sfRefNo: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from('course_changes')
    .select('id')
    .eq('change_type', changeType)
    .eq('sf_ref_no', sfRefNo)
    .gte('detected_at', daysAgoIso(2))
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

async function insertChanges(supabase: SupabaseClient, rows: ChangeRow[]): Promise<number> {
  if (rows.length === 0) return 0
  const { data, error } = await supabase.from('course_changes').insert(rows).select('id')
  if (error) {
    console.error('insertChanges failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

async function detectCourseChanges(supabase: SupabaseClient): Promise<number> {
  // Pull both active + recently-deactivated courses (removed_course needs
  // is_active=false rows too).
  const { data: allRows } = await supabase
    .from('sf_courses')
    .select(SF_COURSE_COLUMNS)
    .gte('last_seen_at', daysAgoIso(30)) // bound the scan; changes are always recent
  const courses = ((allRows ?? []) as unknown as SfCourseRow[])

  const twoDaysAgo = daysAgoIso(2)
  const pending: ChangeRow[] = []

  for (const c of courses) {
    const cluster = clusterOf(c)

    // new_course
    if (c.is_active && c.first_seen_at && c.first_seen_at >= twoDaysAgo) {
      if (!(await alreadyChanged(supabase, 'new_course', c.sf_ref_no))) {
        pending.push({
          competitor_id: c.competitor_id,
          provider_name: c.provider_name,
          sf_ref_no: c.sf_ref_no,
          course_title: c.title,
          category: cluster,
          change_type: 'new_course',
          old_value: null,
          new_value: c.upcoming_run_count,
          change_amount: null,
          change_percentage: null,
          metadata: { demand_score: c.demand_score },
        })
      }
    }

    // removed_course
    if (!c.is_active && c.last_seen_at && c.last_seen_at >= twoDaysAgo) {
      if (!(await alreadyChanged(supabase, 'removed_course', c.sf_ref_no))) {
        pending.push({
          competitor_id: c.competitor_id,
          provider_name: c.provider_name,
          sf_ref_no: c.sf_ref_no,
          course_title: c.title,
          category: cluster,
          change_type: 'removed_course',
          old_value: c.upcoming_run_count,
          new_value: null,
          change_amount: null,
          change_percentage: null,
          metadata: {},
        })
      }
      continue // no other diffs matter once removed
    }

    if (!c.is_active) continue

    // run_count_increase / run_count_decrease — abs change >=2 AND >=15%
    if (c.prev_run_count !== null && c.prev_run_count !== undefined && c.upcoming_run_count !== null) {
      const delta = c.upcoming_run_count - c.prev_run_count
      const pct = c.prev_run_count > 0 ? (delta / c.prev_run_count) * 100 : (delta !== 0 ? 100 : 0)
      if (Math.abs(delta) >= 2 && Math.abs(pct) >= 15) {
        const changeType = delta > 0 ? 'run_count_increase' : 'run_count_decrease'
        if (!(await alreadyChanged(supabase, changeType, c.sf_ref_no))) {
          pending.push({
            competitor_id: c.competitor_id,
            provider_name: c.provider_name,
            sf_ref_no: c.sf_ref_no,
            course_title: c.title,
            category: cluster,
            change_type: changeType,
            old_value: c.prev_run_count,
            new_value: c.upcoming_run_count,
            change_amount: delta,
            change_percentage: round1(pct),
            metadata: {},
          })
        }
      }
    }

    // fee_change — >=5%
    if (c.prev_fee !== null && c.prev_fee !== undefined && c.course_fee !== null && c.prev_fee > 0) {
      const delta = c.course_fee - c.prev_fee
      const pct = (delta / c.prev_fee) * 100
      if (Math.abs(pct) >= 5) {
        if (!(await alreadyChanged(supabase, 'fee_change', c.sf_ref_no))) {
          pending.push({
            competitor_id: c.competitor_id,
            provider_name: c.provider_name,
            sf_ref_no: c.sf_ref_no,
            course_title: c.title,
            category: cluster,
            change_type: 'fee_change',
            old_value: c.prev_fee,
            new_value: c.course_fee,
            change_amount: round1(delta),
            change_percentage: round1(pct),
            metadata: {},
          })
        }
      }
    }

    // rating_change — >=0.3 abs
    if (c.prev_rating !== null && c.prev_rating !== undefined && c.quality_rating !== null) {
      const delta = c.quality_rating - c.prev_rating
      if (Math.abs(delta) >= 0.3) {
        if (!(await alreadyChanged(supabase, 'rating_change', c.sf_ref_no))) {
          pending.push({
            competitor_id: c.competitor_id,
            provider_name: c.provider_name,
            sf_ref_no: c.sf_ref_no,
            course_title: c.title,
            category: cluster,
            change_type: 'rating_change',
            old_value: c.prev_rating,
            new_value: c.quality_rating,
            change_amount: round1(delta),
            change_percentage: c.prev_rating > 0 ? round1((delta / c.prev_rating) * 100) : null,
            metadata: {},
          })
        }
      }
    }

    // respondent_count_change — >=20% and >=10 abs
    if (
      c.prev_respondent_count !== null &&
      c.prev_respondent_count !== undefined &&
      c.respondent_count !== null &&
      c.prev_respondent_count > 0
    ) {
      const delta = c.respondent_count - c.prev_respondent_count
      const pct = (delta / c.prev_respondent_count) * 100
      if (Math.abs(delta) >= 10 && Math.abs(pct) >= 20) {
        if (!(await alreadyChanged(supabase, 'respondent_count_change', c.sf_ref_no))) {
          pending.push({
            competitor_id: c.competitor_id,
            provider_name: c.provider_name,
            sf_ref_no: c.sf_ref_no,
            course_title: c.title,
            category: cluster,
            change_type: 'respondent_count_change',
            old_value: c.prev_respondent_count,
            new_value: c.respondent_count,
            change_amount: delta,
            change_percentage: round1(pct),
            metadata: {},
          })
        }
      }
    }
  }

  return insertChanges(supabase, pending)
}

// ─── Daily snapshots ────────────────────────────────────────────────────────

interface TopCourseEntry {
  sf_ref_no: string
  title: string
  runs: number
  respondents: number | null
}

async function writeDailySnapshots(supabase: SupabaseClient): Promise<number> {
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const byProvider = new Map<string, { competitorId: string | null; providerName: string; courses: SfCourseRow[] }>()
  for (const c of courses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    const key = provider.providerName
    const entry = byProvider.get(key) ?? { competitorId: provider.competitorId ?? c.competitor_id, providerName: key, courses: [] }
    entry.courses.push(c)
    byProvider.set(key, entry)
  }

  const today = todayDateString()
  const rows: Array<Record<string, unknown>> = []

  for (const { competitorId, providerName, courses: providerCourses } of byProvider.values()) {
    const totalRuns = providerCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const categoryBreakdown: Record<string, { courses: number; runs: number }> = {}
    for (const c of providerCourses) {
      const cluster = clusterOf(c)
      const entry = categoryBreakdown[cluster] ?? { courses: 0, runs: 0 }
      entry.courses += 1
      entry.runs += c.upcoming_run_count ?? 0
      categoryBreakdown[cluster] = entry
    }

    const topCourses: TopCourseEntry[] = [...providerCourses]
      .sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
      .slice(0, 5)
      .map((c) => ({
        sf_ref_no: c.sf_ref_no,
        title: c.title,
        runs: c.upcoming_run_count ?? 0,
        respondents: c.respondent_count ?? null,
      }))

    const fees = providerCourses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
    const ratings = providerCourses.map((c) => c.quality_rating).filter((r): r is number => r !== null && r !== undefined)
    const totalRespondents = providerCourses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)

    rows.push({
      snapshot_date: today,
      competitor_id: competitorId,
      provider_name: providerName,
      total_courses: providerCourses.length,
      total_runs: totalRuns,
      category_breakdown: categoryBreakdown,
      top_courses: topCourses,
      median_fee: median(fees),
      average_rating: mean(ratings) !== null ? round1(mean(ratings) as number) : null,
      total_respondents: totalRespondents,
    })
  }

  if (rows.length === 0) return 0

  const { data, error } = await supabase
    .from('course_intelligence_snapshots')
    .upsert(rows, { onConflict: 'snapshot_date,provider_name' })
    .select('id')

  if (error) {
    console.error('writeDailySnapshots: upsert failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

// ─── Provider growth changes ────────────────────────────────────────────────

async function detectProviderGrowthChanges(supabase: SupabaseClient): Promise<number> {
  const today = todayDateString()

  const { data: snapshotRows } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, provider_name, competitor_id, total_runs')
    .order('snapshot_date', { ascending: false })
    .limit(2000)

  type SnapRow = { snapshot_date: string; provider_name: string; competitor_id: string | null; total_runs: number }
  const rows = ((snapshotRows ?? []) as SnapRow[])

  const byProvider = new Map<string, SnapRow[]>()
  for (const row of rows) {
    const list = byProvider.get(row.provider_name) ?? []
    list.push(row)
    byProvider.set(row.provider_name, list)
  }

  const pending: ChangeRow[] = []

  for (const [providerName, snaps] of byProvider) {
    const todaySnap = snaps.find((s) => s.snapshot_date === today)
    if (!todaySnap) continue

    const priorSnaps = snaps.filter((s) => s.snapshot_date !== today).sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1))
    const priorSnap = priorSnaps[0] ?? null

    if (!priorSnap) {
      // new_provider: no prior snapshot exists and provider has >=1 run
      if (todaySnap.total_runs >= 1) {
        if (!(await alreadyProviderChanged(supabase, 'new_provider', providerName))) {
          pending.push({
            competitor_id: todaySnap.competitor_id,
            provider_name: providerName,
            sf_ref_no: null,
            course_title: null,
            category: null,
            change_type: 'new_provider',
            old_value: null,
            new_value: todaySnap.total_runs,
            change_amount: null,
            change_percentage: null,
            metadata: { new_total_runs: todaySnap.total_runs },
          })
        }
      }
      continue
    }

    const delta = todaySnap.total_runs - priorSnap.total_runs
    const pct = priorSnap.total_runs > 0 ? (delta / priorSnap.total_runs) * 100 : (delta > 0 ? 100 : 0)

    if (delta >= 5 && pct >= 20) {
      if (!(await alreadyProviderChanged(supabase, 'provider_growth', providerName))) {
        pending.push({
          competitor_id: todaySnap.competitor_id,
          provider_name: providerName,
          sf_ref_no: null,
          course_title: null,
          category: null,
          change_type: 'provider_growth',
          old_value: priorSnap.total_runs,
          new_value: todaySnap.total_runs,
          change_amount: delta,
          change_percentage: round1(pct),
          metadata: { old_total_runs: priorSnap.total_runs, new_total_runs: todaySnap.total_runs, prior_snapshot_date: priorSnap.snapshot_date },
        })
      }
    }
  }

  return insertChanges(supabase, pending)
}

async function alreadyProviderChanged(supabase: SupabaseClient, changeType: string, providerName: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('course_changes')
    .select('id')
    .eq('change_type', changeType)
    .eq('provider_name', providerName)
    .gte('detected_at', daysAgoIso(2))
    .limit(1)
  if (error) return false
  return (data?.length ?? 0) > 0
}

// ─── Provider threat scores ─────────────────────────────────────────────────

async function computeProviderThreatScores(supabase: SupabaseClient): Promise<number> {
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const { data: categoryRows } = await supabase.from('course_categories').select('name, priority')
  const priorityByCategory = new Map(
    ((categoryRows ?? []) as Array<{ name: string; priority: number }>).map((r) => [r.name, r.priority])
  )
  const highPriorityCategories = new Set(
    Array.from(priorityByCategory.entries()).filter(([, p]) => p >= 75).map(([name]) => name)
  )

  // Group by provider entity (provider_name) — Hustle's two entities are
  // kept separate here and BOTH excluded from threat scoring below (threat
  // scores are only computed for non-Hustle providers).
  const byGroup = new Map<string, { competitorId: string | null; providerName: string; isHustle: boolean; courses: SfCourseRow[] }>()
  for (const c of courses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    const key = provider.providerName
    const entry = byGroup.get(key) ?? { competitorId: provider.competitorId, providerName: key, isHustle: provider.isHustle, courses: [] }
    entry.courses.push(c)
    byGroup.set(key, entry)
  }

  // Market-wide maxima for normalization
  const groups = Array.from(byGroup.values()).filter((g) => !g.isHustle)
  if (groups.length === 0) {
    await supabase.from('provider_threat_scores').update({ is_current: false }).eq('is_current', true)
    return 0
  }

  const runVolumeByGroup = groups.map((g) => g.courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0))
  const maxRunVolume = Math.max(1, ...runVolumeByGroup)
  const activeCoursesByGroup = groups.map((g) => g.courses.length)
  const maxActiveCourses = Math.max(1, ...activeCoursesByGroup)
  const highDemandByGroup = groups.map((g) => g.courses.filter((c) => (c.demand_score ?? 0) >= 75).length)
  const maxHighDemand = Math.max(1, ...highDemandByGroup)

  const allFees = courses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
  const marketMedianFee = median(allFees)

  const maxRespondents = Math.max(1, ...groups.map((g) => g.courses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)))

  // Previous snapshot totals for run growth (per provider name)
  const today = todayDateString()
  const { data: snapshotRows } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, provider_name, total_runs')
    .order('snapshot_date', { ascending: false })
    .limit(2000)
  type SnapRow = { snapshot_date: string; provider_name: string; total_runs: number }
  const snapsByProvider = new Map<string, SnapRow[]>()
  for (const row of (snapshotRows ?? []) as SnapRow[]) {
    const list = snapsByProvider.get(row.provider_name) ?? []
    list.push(row)
    snapsByProvider.set(row.provider_name, list)
  }

  const rows: Array<Record<string, unknown>> = []

  for (const group of groups) {
    const runVolume = group.courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const activeCourses = group.courses.length
    const clusters = new Set(group.courses.map((c) => clusterOf(c)))
    const categoryBreadth = clusters.size
    const highDemandCourses = group.courses.filter((c) => (c.demand_score ?? 0) >= 75).length

    // Run growth vs previous snapshot
    const snaps = snapsByProvider.get(group.providerName) ?? []
    const priorSnap = snaps.filter((s) => s.snapshot_date !== today).sort((a, b) => (a.snapshot_date < b.snapshot_date ? 1 : -1))[0] ?? null
    let runGrowthNorm = 50
    let runGrowthInput: string | number = 'no prior snapshot'
    if (priorSnap && priorSnap.total_runs > 0) {
      const pct = ((runVolume - priorSnap.total_runs) / priorSnap.total_runs) * 100
      runGrowthInput = round1(pct)
      runGrowthNorm = pct > 0 ? clamp(50 + scaleTo100(pct, 50) * 0.5) : clamp(50 + pct * 0.5, 0, 50)
    }

    // Hustle core overlap: share of provider's runs in priority>=75 categories
    const coreRuns = group.courses
      .filter((c) => highPriorityCategories.has(clusterOf(c)))
      .reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const hustleCoreOverlapPct = runVolume > 0 ? (coreRuns / runVolume) * 100 : 0

    // Fee competitiveness: median fee below market median -> higher score
    const groupFees = group.courses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
    const groupMedianFee = median(groupFees)
    let feeCompetitivenessNorm = 50
    let feeInput: string | number = 'no fee data'
    if (groupMedianFee !== null && marketMedianFee !== null && marketMedianFee > 0) {
      const ratio = groupMedianFee / marketMedianFee
      feeInput = round1(groupMedianFee)
      // below market median -> more competitive -> higher score
      feeCompetitivenessNorm = clamp(100 - (ratio - 1) * 100, 0, 100)
    }

    // Popularity: respondents + ratings normalized
    const groupRespondents = group.courses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const groupRatings = group.courses.map((c) => c.quality_rating).filter((r): r is number => r !== null && r !== undefined)
    const avgRating = mean(groupRatings)
    const respondentsNorm = scaleTo100(groupRespondents, maxRespondents)
    const ratingNorm = avgRating !== null ? clamp((avgRating / 5) * 100) : 50
    const popularityNorm = respondentsNorm * 0.6 + ratingNorm * 0.4

    const runVolumeNorm = scaleTo100(runVolume, maxRunVolume)
    const activeCoursesNorm = scaleTo100(activeCourses, maxActiveCourses)
    const categoryBreadthNorm = clamp((categoryBreadth / 15) * 100)
    const highDemandNorm = scaleTo100(highDemandCourses, maxHighDemand)
    const hustleCoreOverlapNorm = clamp(hustleCoreOverlapPct)

    const totalScore =
      runVolumeNorm * 0.25 +
      activeCoursesNorm * 0.15 +
      categoryBreadthNorm * 0.1 +
      runGrowthNorm * 0.15 +
      highDemandNorm * 0.15 +
      hustleCoreOverlapNorm * 0.1 +
      feeCompetitivenessNorm * 0.05 +
      popularityNorm * 0.05

    const label =
      totalScore >= 75 ? 'Critical Threat' :
      totalScore >= 55 ? 'High Threat' :
      totalScore >= 35 ? 'Medium Threat' :
      totalScore >= 20 ? 'Low Threat' : 'Monitor'

    const breakdown = {
      run_volume: { input: runVolume, score: round1(runVolumeNorm), weight: 0.25 },
      active_courses: { input: activeCourses, score: round1(activeCoursesNorm), weight: 0.15 },
      category_breadth: { input: categoryBreadth, score: round1(categoryBreadthNorm), weight: 0.1 },
      run_growth: { input: runGrowthInput, score: round1(runGrowthNorm), weight: 0.15 },
      high_demand_courses: { input: highDemandCourses, score: round1(highDemandNorm), weight: 0.15 },
      hustle_core_overlap: { input: `${round1(hustleCoreOverlapPct)}% of runs in priority>=75 categories`, score: round1(hustleCoreOverlapNorm), weight: 0.1 },
      fee_competitiveness: { input: feeInput, score: round1(feeCompetitivenessNorm), weight: 0.05 },
      popularity: { input: `${groupRespondents} respondents, ${avgRating !== null ? round1(avgRating) : 'N/A'}★ avg`, score: round1(popularityNorm), weight: 0.05 },
    }

    const evidence: string[] = [
      `${group.providerName} has ${runVolume} upcoming runs across ${activeCourses} active courses in ${categoryBreadth} categories.`,
    ]
    if (highDemandCourses > 0) evidence.push(`${highDemandCourses} of their courses have a demand score of 75+.`)
    if (coreRuns > 0) evidence.push(`${round1(hustleCoreOverlapPct)}% of their runs (${coreRuns}) are in Hustle's core (priority ≥75) categories.`)
    if (priorSnap) evidence.push(`Run count moved from ${priorSnap.total_runs} to ${runVolume} since the last snapshot (${priorSnap.snapshot_date}).`)

    rows.push({
      competitor_id: group.competitorId,
      provider_name: group.providerName,
      total_score: round1(totalScore),
      threat_label: label,
      breakdown,
      evidence,
      is_current: true,
    })
  }

  await supabase.from('provider_threat_scores').update({ is_current: false }).eq('is_current', true)

  if (rows.length === 0) return 0

  const { data, error } = await supabase.from('provider_threat_scores').insert(rows).select('id')
  if (error) {
    console.error('computeProviderThreatScores: insert failed:', error.message)
    return 0
  }
  return data?.length ?? 0
}

// ══════════════════════════════════════════════════════════════════════════
// b. getCourseMarketSnapshot
// ══════════════════════════════════════════════════════════════════════════

export interface CourseMarketSnapshot {
  totalProviders: number
  totalCourses: number
  totalRuns: number
  totalCategories: number
  newCourses7d: number
  removedCourses14d: number
  topGrowthProvider: { name: string; deltaRuns: number; deltaPct: number } | null
  topGrowthCategory: { name: string; deltaRuns: number } | null
  /** @deprecated Use hustleRanks instead — this holds the BEST-ranked Hustle entity's rank by runs, kept for backwards compatibility. */
  hustleRankByRuns: number | null
  /** @deprecated Use hustleRanks instead — this holds the BEST-ranked Hustle entity's rank by courses, kept for backwards compatibility. */
  hustleRankByCourses: number | null
  /** One entry per Hustle provider entity that has any active courses (e.g. Hustle Academy, Hustle Institute). */
  hustleRanks: Array<{ name: string; rankByRuns: number | null; rankByCourses: number | null }>
  lastRefreshed: string | null
}

export async function getCourseMarketSnapshot(): Promise<CourseMarketSnapshot> {
  const supabase = await createServiceClient()
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const byGroup = new Map<string, { name: string; isHustle: boolean; runs: number; courseCount: number }>()
  for (const c of courses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    const key = provider.providerName
    const entry = byGroup.get(key) ?? { name: provider.displayName, isHustle: provider.isHustle, runs: 0, courseCount: 0 }
    entry.runs += c.upcoming_run_count ?? 0
    entry.courseCount += 1
    byGroup.set(key, entry)
  }

  const totalCourses = courses.length
  const totalRuns = courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
  const totalCategories = new Set(courses.map((c) => clusterOf(c))).size

  const newCourses7d = courses.filter((c) => c.first_seen_at && c.first_seen_at >= daysAgoIso(7)).length

  const { count: removedCount } = await supabase
    .from('sf_courses')
    .select('id', { count: 'exact', head: true })
    .eq('is_active', false)
    .gte('last_seen_at', daysAgoIso(14))

  // Top growth provider from provider_growth changes (last 14 days, biggest %)
  const { data: growthChanges } = await supabase
    .from('course_changes')
    .select('provider_name, change_amount, change_percentage, detected_at')
    .eq('change_type', 'provider_growth')
    .gte('detected_at', daysAgoIso(14))
    .order('change_percentage', { ascending: false })
    .limit(1)

  const topGrowthProvider =
    growthChanges && growthChanges.length > 0
      ? {
          name: growthChanges[0].provider_name as string,
          deltaRuns: (growthChanges[0].change_amount as number) ?? 0,
          deltaPct: (growthChanges[0].change_percentage as number) ?? 0,
        }
      : null

  // Top growth category: compare today's category totals vs most recent prior snapshot day
  const { data: snapshotRows } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, category_breakdown')
    .order('snapshot_date', { ascending: false })
    .limit(500)

  const dates = Array.from(new Set(((snapshotRows ?? []) as Array<{ snapshot_date: string }>).map((r) => r.snapshot_date))).sort().reverse()
  let topGrowthCategory: { name: string; deltaRuns: number } | null = null
  if (dates.length >= 2) {
    const [latestDate, priorDate] = dates
    const latestTotals = new Map<string, number>()
    const priorTotals = new Map<string, number>()
    for (const row of (snapshotRows ?? []) as Array<{ snapshot_date: string; category_breakdown: unknown }>) {
      const breakdown = (row.category_breakdown ?? {}) as Record<string, { runs: number }>
      const target = row.snapshot_date === latestDate ? latestTotals : row.snapshot_date === priorDate ? priorTotals : null
      if (!target) continue
      for (const [cat, v] of Object.entries(breakdown)) {
        target.set(cat, (target.get(cat) ?? 0) + (v.runs ?? 0))
      }
    }
    let bestDelta = 0
    let bestCat: string | null = null
    for (const [cat, latestRuns] of latestTotals) {
      const delta = latestRuns - (priorTotals.get(cat) ?? 0)
      if (delta > bestDelta) {
        bestDelta = delta
        bestCat = cat
      }
    }
    if (bestCat) topGrowthCategory = { name: bestCat, deltaRuns: bestDelta }
  }

  const sortedByRuns = Array.from(byGroup.values()).sort((a, b) => b.runs - a.runs)
  const sortedByCourses = Array.from(byGroup.values()).sort((a, b) => b.courseCount - a.courseCount)

  const hustleEntities = Array.from(byGroup.values()).filter((g) => g.isHustle)
  const hustleRanks = hustleEntities.map((g) => {
    const rankByRunsIdx = sortedByRuns.findIndex((s) => s === g)
    const rankByCoursesIdx = sortedByCourses.findIndex((s) => s === g)
    return {
      name: g.name,
      rankByRuns: rankByRunsIdx >= 0 ? rankByRunsIdx + 1 : null,
      rankByCourses: rankByCoursesIdx >= 0 ? rankByCoursesIdx + 1 : null,
    }
  })

  // Deprecated fields: best (lowest numeric rank) among Hustle entities, for backwards safety.
  const bestRankByRuns = hustleRanks.reduce<number | null>((best, r) => {
    if (r.rankByRuns == null) return best
    return best == null ? r.rankByRuns : Math.min(best, r.rankByRuns)
  }, null)
  const bestRankByCourses = hustleRanks.reduce<number | null>((best, r) => {
    if (r.rankByCourses == null) return best
    return best == null ? r.rankByCourses : Math.min(best, r.rankByCourses)
  }, null)

  const { data: lastLog } = await supabase
    .from('data_refresh_logs')
    .select('started_at')
    .eq('module', 'runcounts')
    .in('status', ['success', 'partial'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return {
    totalProviders: byGroup.size,
    totalCourses,
    totalRuns,
    totalCategories,
    newCourses7d,
    removedCourses14d: removedCount ?? 0,
    topGrowthProvider,
    topGrowthCategory,
    hustleRankByRuns: bestRankByRuns,
    hustleRankByCourses: bestRankByCourses,
    hustleRanks,
    lastRefreshed: (lastLog as { started_at: string } | null)?.started_at ?? null,
  }
}

// ══════════════════════════════════════════════════════════════════════════
// c/d. Leaderboards
// ══════════════════════════════════════════════════════════════════════════

export interface CourseRowDto {
  sfRefNo: string
  title: string
  provider: string
  competitorName: string | null
  color: string | null
  isHustle: boolean
  category: string
  runs: number
  fee: number | null
  rating: number | null
  respondents: number | null
  demandScore: number | null
  demandLevel: 'Very High' | 'High' | 'Medium' | 'Low' | null
  demandBreakdown: unknown
  isNew: boolean
  runDelta: number | null
  url: string
  scrapedAt: string | null
}

function demandLevelOf(score: number | null): CourseRowDto['demandLevel'] {
  if (score === null || score === undefined) return null
  if (score >= 75) return 'Very High'
  if (score >= 50) return 'High'
  if (score >= 25) return 'Medium'
  return 'Low'
}

function toCourseRowDto(c: SfCourseRow, provider: ProviderDisplay): CourseRowDto {
  const runDelta = c.prev_run_count !== null && c.prev_run_count !== undefined && c.upcoming_run_count !== null
    ? c.upcoming_run_count - c.prev_run_count
    : null
  return {
    sfRefNo: c.sf_ref_no,
    title: c.title,
    provider: provider.displayName,
    // NOTE: field name kept as `competitorName` for contract stability, but it
    // now carries the PROVIDER ENTITY display name (e.g. 'Hustle Academy' /
    // 'Hustle Institute'), not the competitor row name — this is intentional
    // so Hustle courses show which entity they belong to.
    competitorName: provider.displayName,
    color: provider.color,
    isHustle: provider.isHustle,
    category: clusterOf(c),
    runs: c.upcoming_run_count ?? 0,
    fee: c.course_fee ?? null,
    rating: c.quality_rating ?? null,
    respondents: c.respondent_count ?? null,
    demandScore: c.demand_score ?? null,
    demandLevel: demandLevelOf(c.demand_score ?? null),
    demandBreakdown: c.demand_breakdown ?? null,
    isNew: Boolean(c.first_seen_at && c.first_seen_at >= daysAgoIso(7)),
    runDelta,
    url: buildCourseUrl(c.sf_ref_no),
    scrapedAt: c.scraped_at ?? null,
  }
}

export async function getCourseLeaderboard(limit = 500): Promise<CourseRowDto[]> {
  const supabase = await createServiceClient()
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  return courses
    .map((c) => toCourseRowDto(c, resolveProvider(c.provider_name, providerMap)))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, limit)
}

export interface ProviderLeaderboardEntry {
  competitorId: string | null
  name: string
  color: string | null
  isHustle: boolean
  totalRuns: number
  activeCourses: number
  categoriesServed: number
  topCourse: { title: string; runs: number } | null
  medianFee: number | null
  avgRating: number | null
  totalRespondents: number
  newCourses7d: number
  runGrowth: { abs: number; pct: number } | null
  marketSharePct: number
  threat: { score: number; label: string; breakdown: unknown; evidence: unknown } | null
  priciest: { title: string; fee: number } | null
  cheapest: { title: string; fee: number } | null
  categoryBreakdown: Record<string, { courses: number; runs: number }>
  courses: CourseRowDto[]
}

export async function getProviderCourseLeaderboard(): Promise<ProviderLeaderboardEntry[]> {
  const supabase = await createServiceClient()
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const byGroup = new Map<string, { provider: ProviderDisplay; courses: SfCourseRow[] }>()
  for (const c of courses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    const key = provider.providerName
    const entry = byGroup.get(key) ?? { provider, courses: [] }
    entry.courses.push(c)
    byGroup.set(key, entry)
  }

  const totalMarketRuns = courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)

  const { data: threatRows } = await supabase
    .from('provider_threat_scores')
    .select('provider_name, total_score, threat_label, breakdown, evidence')
    .eq('is_current', true)
  type ThreatRow = { provider_name: string; total_score: number; threat_label: string; breakdown: unknown; evidence: unknown }
  const threatByProvider = new Map(((threatRows ?? []) as ThreatRow[]).map((r) => [r.provider_name, r]))

  const { data: growthRows } = await supabase
    .from('course_changes')
    .select('provider_name, change_amount, change_percentage, detected_at')
    .eq('change_type', 'provider_growth')
    .order('detected_at', { ascending: false })
    .limit(500)
  type GrowthRow = { provider_name: string; change_amount: number | null; change_percentage: number | null }
  const growthByProvider = new Map<string, GrowthRow>()
  for (const row of (growthRows ?? []) as GrowthRow[]) {
    if (!growthByProvider.has(row.provider_name)) growthByProvider.set(row.provider_name, row)
  }

  const results: ProviderLeaderboardEntry[] = []

  for (const { provider, courses: providerCourses } of byGroup.values()) {
    const totalRuns = providerCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const categoryBreakdown: Record<string, { courses: number; runs: number }> = {}
    for (const c of providerCourses) {
      const cluster = clusterOf(c)
      const entry = categoryBreakdown[cluster] ?? { courses: 0, runs: 0 }
      entry.courses += 1
      entry.runs += c.upcoming_run_count ?? 0
      categoryBreakdown[cluster] = entry
    }

    const sortedByRuns = [...providerCourses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    const topCourse = sortedByRuns[0] ? { title: sortedByRuns[0].title, runs: sortedByRuns[0].upcoming_run_count ?? 0 } : null

    const fees = providerCourses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
    const ratings = providerCourses.map((c) => c.quality_rating).filter((r): r is number => r !== null && r !== undefined)
    const totalRespondents = providerCourses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const newCourses7d = providerCourses.filter((c) => c.first_seen_at && c.first_seen_at >= daysAgoIso(7)).length

    // Threat scores and provider_growth changes are keyed by the raw
    // provider_name identifier (see computeProviderThreatScores /
    // detectProviderGrowthChanges), not the display name.
    const growth = growthByProvider.get(provider.providerName)
    const runGrowth = growth && growth.change_amount !== null && growth.change_percentage !== null
      ? { abs: growth.change_amount, pct: growth.change_percentage }
      : null

    // Threat scores are only computed for non-Hustle providers — both Hustle
    // entities intentionally get threat: null here (see computeProviderThreatScores).
    const threat = threatByProvider.get(provider.providerName)
    const threatDto = threat ? { score: threat.total_score, label: threat.threat_label, breakdown: threat.breakdown, evidence: threat.evidence } : null

    const withFees = providerCourses.filter((c) => c.course_fee !== null && c.course_fee !== undefined)
    const priciestC = withFees.length > 0 ? [...withFees].sort((a, b) => (b.course_fee ?? 0) - (a.course_fee ?? 0))[0] : null
    const cheapestC = withFees.length > 0 ? [...withFees].sort((a, b) => (a.course_fee ?? 0) - (b.course_fee ?? 0))[0] : null

    results.push({
      competitorId: provider.competitorId,
      name: provider.displayName,
      color: provider.color,
      isHustle: provider.isHustle,
      totalRuns,
      activeCourses: providerCourses.length,
      categoriesServed: Object.keys(categoryBreakdown).length,
      topCourse,
      medianFee: median(fees),
      avgRating: mean(ratings) !== null ? round1(mean(ratings) as number) : null,
      totalRespondents,
      newCourses7d,
      runGrowth,
      marketSharePct: totalMarketRuns > 0 ? round1((totalRuns / totalMarketRuns) * 100) : 0,
      threat: threatDto,
      priciest: priciestC ? { title: priciestC.title, fee: priciestC.course_fee as number } : null,
      cheapest: cheapestC ? { title: cheapestC.title, fee: cheapestC.course_fee as number } : null,
      categoryBreakdown,
      courses: providerCourses.map((c) => toCourseRowDto(c, provider)).sort((a, b) => b.runs - a.runs),
    })
  }

  return results.sort((a, b) => b.totalRuns - a.totalRuns)
}

// ══════════════════════════════════════════════════════════════════════════
// e. getCategoryIntelligence
// ══════════════════════════════════════════════════════════════════════════

export interface CategoryIntelligenceEntry {
  category: string
  priority: number
  providersCount: number
  courses: number
  runs: number
  topProviders: Array<{ name: string; runs: number }>
  topCourses: Array<{ title: string; provider: string; runs: number }>
  avgFee: number | null
  medianFee: number | null
  avgRating: number | null
  respondents: number
  growth: { abs: number; pct: number } | null
  /** Combined Hustle presence (both provider entities) plus a per-entity breakdown. */
  hustle: { courses: number; runs: number; sharePct: number; byEntity: Array<{ name: string; courses: number; runs: number }> }
  opportunity: { score: number; label: string; breakdown: unknown; evidence: unknown } | null
  competitionLevel: 'low' | 'medium' | 'high'
  demandLevel: 'low' | 'medium' | 'high'
}

export async function getCategoryIntelligence(): Promise<CategoryIntelligenceEntry[]> {
  const supabase = await createServiceClient()
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const { data: categoryRows } = await supabase.from('course_categories').select('name, priority')
  const priorityByCategory = new Map(((categoryRows ?? []) as Array<{ name: string; priority: number }>).map((r) => [r.name, r.priority]))

  const { data: opportunityRows } = await supabase
    .from('opportunity_scores')
    .select('category, total_score, breakdown, evidence')
    .eq('is_current', true)
  type OppRow = { category: string; total_score: number; breakdown: unknown; evidence: unknown }
  const opportunityByCategory = new Map(((opportunityRows ?? []) as OppRow[]).map((r) => [r.category, r]))

  // Growth: today's per-category runs vs most recent prior snapshot day
  const { data: snapshotRows } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, category_breakdown')
    .order('snapshot_date', { ascending: false })
    .limit(500)
  const dates = Array.from(new Set(((snapshotRows ?? []) as Array<{ snapshot_date: string }>).map((r) => r.snapshot_date))).sort().reverse()
  const priorTotals = new Map<string, number>()
  if (dates.length >= 2) {
    const priorDate = dates[1]
    for (const row of (snapshotRows ?? []) as Array<{ snapshot_date: string; category_breakdown: unknown }>) {
      if (row.snapshot_date !== priorDate) continue
      const breakdown = (row.category_breakdown ?? {}) as Record<string, { runs: number }>
      for (const [cat, v] of Object.entries(breakdown)) {
        priorTotals.set(cat, (priorTotals.get(cat) ?? 0) + (v.runs ?? 0))
      }
    }
  }

  const byCategory = new Map<CategoryCluster, SfCourseRow[]>()
  for (const cluster of CATEGORY_CLUSTERS) byCategory.set(cluster, [])
  for (const c of courses) {
    const cluster = clusterOf(c)
    byCategory.get(cluster)!.push(c)
  }

  function opportunityLabel(score: number): string {
    if (score >= 70) return 'High Opportunity'
    if (score >= 45) return 'Medium Opportunity'
    return 'Low Opportunity'
  }

  const runsByCategory = new Map<string, number>()
  for (const [cat, list] of byCategory) runsByCategory.set(cat, list.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0))
  const runTercileSorted = Array.from(runsByCategory.values()).filter((r) => r > 0).sort((a, b) => a - b)
  function demandLevelForRuns(runs: number): 'low' | 'medium' | 'high' {
    if (runTercileSorted.length === 0 || runs === 0) return 'low'
    const idx = runTercileSorted.length
    const t1 = runTercileSorted[Math.floor(idx / 3)] ?? 0
    const t2 = runTercileSorted[Math.floor((2 * idx) / 3)] ?? 0
    if (runs >= t2) return 'high'
    if (runs >= t1) return 'medium'
    return 'low'
  }

  const orderedClusters = [...CATEGORY_CLUSTERS.filter((c) => c !== 'Other'), 'Other' as CategoryCluster]

  const entries: CategoryIntelligenceEntry[] = []

  for (const cluster of orderedClusters) {
    const list = byCategory.get(cluster) ?? []
    if (list.length === 0) continue

    const providerRuns = new Map<string, number>()
    for (const c of list) {
      const provider = resolveProvider(c.provider_name, providerMap)
      const name = provider.displayName
      providerRuns.set(name, (providerRuns.get(name) ?? 0) + (c.upcoming_run_count ?? 0))
    }

    const topProviders = Array.from(providerRuns.entries())
      .map(([name, runs]) => ({ name, runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 3)

    const topCourses = [...list]
      .sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
      .slice(0, 3)
      .map((c) => {
        const provider = resolveProvider(c.provider_name, providerMap)
        return { title: c.title, provider: provider.displayName, runs: c.upcoming_run_count ?? 0 }
      })

    const fees = list.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
    const ratings = list.map((c) => c.quality_rating).filter((r): r is number => r !== null && r !== undefined)
    const respondents = list.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const totalRuns = runsByCategory.get(cluster) ?? 0

    const priorRuns = priorTotals.get(cluster)
    const growth = priorRuns !== undefined
      ? { abs: totalRuns - priorRuns, pct: priorRuns > 0 ? round1(((totalRuns - priorRuns) / priorRuns) * 100) : (totalRuns > 0 ? 100 : 0) }
      : null

    // Combined Hustle presence across BOTH provider entities, plus a
    // per-entity breakdown (byEntity) for entities that have courses here.
    const hustleCoursesByEntity = new Map<string, SfCourseRow[]>()
    for (const c of list) {
      const provider = resolveProvider(c.provider_name, providerMap)
      if (!provider.isHustle) continue
      const arr = hustleCoursesByEntity.get(provider.displayName) ?? []
      arr.push(c)
      hustleCoursesByEntity.set(provider.displayName, arr)
    }
    const hustleCourses = Array.from(hustleCoursesByEntity.values()).flat()
    const hustleRuns = hustleCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const hustleByEntity = Array.from(hustleCoursesByEntity.entries()).map(([name, entityCourses]) => ({
      name,
      courses: entityCourses.length,
      runs: entityCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0),
    }))

    const opp = opportunityByCategory.get(cluster)

    entries.push({
      category: cluster,
      priority: priorityByCategory.get(cluster) ?? 50,
      providersCount: providerRuns.size,
      courses: list.length,
      runs: totalRuns,
      topProviders,
      topCourses,
      avgFee: mean(fees) !== null ? round1(mean(fees) as number) : null,
      medianFee: median(fees),
      avgRating: mean(ratings) !== null ? round1(mean(ratings) as number) : null,
      respondents,
      growth,
      hustle: {
        courses: hustleCourses.length,
        runs: hustleRuns,
        sharePct: totalRuns > 0 ? round1((hustleRuns / totalRuns) * 100) : 0,
        byEntity: hustleByEntity,
      },
      opportunity: opp ? { score: opp.total_score, label: opportunityLabel(opp.total_score), breakdown: opp.breakdown, evidence: opp.evidence } : null,
      competitionLevel: providerRuns.size >= 4 ? 'high' : providerRuns.size >= 2 ? 'medium' : 'low',
      demandLevel: demandLevelForRuns(totalRuns),
    })
  }

  return entries
}

// ══════════════════════════════════════════════════════════════════════════
// f. getHustleGapAnalysis
// ══════════════════════════════════════════════════════════════════════════

export interface HustleGapAnalysis {
  /** Combined Hustle presence across BOTH provider entities (Hustle Academy + Hustle Institute). */
  hustle: {
    totalRuns: number
    activeCourses: number
    marketSharePct: number
    /** Rank the COMBINED Hustle runs would hold among providers (i.e. among the OTHER providers plus one synthetic combined-Hustle entry). Noted as combined, not either entity's individual rank. */
    rank: number | null
    topCategories: Array<{ category: string; runs: number }>
    topCourse: { title: string; runs: number } | null
  }
  /** Per-entity breakdown — one entry per Hustle provider entity that has any active courses. */
  entities: Array<{
    name: string
    totalRuns: number
    activeCourses: number
    topCategories: Array<{ category: string; runs: number }>
    topCourse: { title: string; runs: number } | null
    rankByRuns: number | null
  }>
  strongCategories: string[]
  weakCategories: Array<{ category: string; hustleRuns: number; leaderName: string; leaderRuns: number }>
  absentCategories: Array<{ category: string; marketRuns: number; topCompetitor: string | null }>
  competitorsAhead: Array<{ name: string; runs: number }>
  whatThisMeans: {
    attackOpportunities: string[]
    defensivePriorities: string[]
    seoOpportunities: string[]
    pricingInsights: string[]
    schedulingInsights: string[]
    watchlist: string[]
  }
}

export async function getHustleGapAnalysis(): Promise<HustleGapAnalysis> {
  const supabase = await createServiceClient()
  const courses = await loadActiveCourses(supabase)
  const competitors = await loadActiveCompetitors(supabase)
  const providerMap = await buildProviderDisplayMap(supabase, competitors)

  const categoryIntel = await getCategoryIntelligence()

  // Group by provider entity (both Hustle entities kept separate here), then
  // build a COMBINED "Hustle SG (combined)" synthetic entry for ranking
  // purposes so competitorsAhead / rank reflect Hustle's combined presence.
  const byGroupRuns = new Map<string, number>()
  for (const c of courses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    if (provider.isHustle) continue // combined below
    const name = provider.displayName
    byGroupRuns.set(name, (byGroupRuns.get(name) ?? 0) + (c.upcoming_run_count ?? 0))
  }

  const hustleCourses = courses.filter((c) => resolveProvider(c.provider_name, providerMap).isHustle)
  const hustleTotalRuns = hustleCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
  const HUSTLE_COMBINED_KEY = 'Hustle SG (combined)'

  const totalMarketRuns = Array.from(byGroupRuns.values()).reduce((s, v) => s + v, 0) + hustleTotalRuns

  // Combined ranking: Hustle's combined runs vs every OTHER provider's runs.
  const combinedGroups = new Map(byGroupRuns)
  combinedGroups.set(HUSTLE_COMBINED_KEY, hustleTotalRuns)
  const sortedCombinedGroups = Array.from(combinedGroups.entries()).sort((a, b) => b[1] - a[1])
  const hustleRankIdx = sortedCombinedGroups.findIndex(([name]) => name === HUSTLE_COMBINED_KEY)

  const hustleCategoryRuns = new Map<string, number>()
  for (const c of hustleCourses) {
    const cluster = clusterOf(c)
    hustleCategoryRuns.set(cluster, (hustleCategoryRuns.get(cluster) ?? 0) + (c.upcoming_run_count ?? 0))
  }
  const topCategories = Array.from(hustleCategoryRuns.entries())
    .map(([category, runs]) => ({ category, runs }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 5)

  const topHustleCourse = [...hustleCourses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))[0]

  // Per-entity breakdown (one entry per Hustle provider entity with >=1 course).
  const hustleCoursesByEntity = new Map<string, SfCourseRow[]>()
  for (const c of hustleCourses) {
    const provider = resolveProvider(c.provider_name, providerMap)
    const arr = hustleCoursesByEntity.get(provider.displayName) ?? []
    arr.push(c)
    hustleCoursesByEntity.set(provider.displayName, arr)
  }
  // Rank each entity individually among ALL providers (other providers + this one entity, i.e. excluding the other Hustle entity).
  const entities: HustleGapAnalysis['entities'] = Array.from(hustleCoursesByEntity.entries()).map(([name, entityCourses]) => {
    const entityRuns = entityCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const entityGroups = new Map(byGroupRuns)
    entityGroups.set(name, entityRuns)
    const sortedEntityGroups = Array.from(entityGroups.entries()).sort((a, b) => b[1] - a[1])
    const rankIdx = sortedEntityGroups.findIndex(([n]) => n === name)

    const entityCategoryRuns = new Map<string, number>()
    for (const c of entityCourses) {
      const cluster = clusterOf(c)
      entityCategoryRuns.set(cluster, (entityCategoryRuns.get(cluster) ?? 0) + (c.upcoming_run_count ?? 0))
    }
    const entityTopCategories = Array.from(entityCategoryRuns.entries())
      .map(([category, runs]) => ({ category, runs }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 5)
    const entityTopCourse = [...entityCourses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))[0]

    return {
      name,
      totalRuns: entityRuns,
      activeCourses: entityCourses.length,
      topCategories: entityTopCategories,
      topCourse: entityTopCourse ? { title: entityTopCourse.title, runs: entityTopCourse.upcoming_run_count ?? 0 } : null,
      rankByRuns: rankIdx >= 0 ? rankIdx + 1 : null,
    }
  })

  const hustleEntityNames = new Set(entities.map((e) => e.name))

  const strongCategories: string[] = []
  const weakCategories: HustleGapAnalysis['weakCategories'] = []
  const absentCategories: HustleGapAnalysis['absentCategories'] = []

  for (const cat of categoryIntel) {
    if (cat.category === 'Other') continue
    // weakCategories/absentCategories compare against COMBINED Hustle runs (cat.hustle.*).
    const hustleShare = cat.hustle.sharePct
    const leader = cat.topProviders.find((p) => !hustleEntityNames.has(p.name)) ?? cat.topProviders[0] ?? null

    if (cat.hustle.courses === 0 && cat.runs > 0) {
      absentCategories.push({ category: cat.category, marketRuns: cat.runs, topCompetitor: leader?.name ?? null })
    } else if (hustleShare >= 40) {
      strongCategories.push(cat.category)
    } else if (leader && !hustleEntityNames.has(leader.name) && leader.runs > cat.hustle.runs) {
      weakCategories.push({ category: cat.category, hustleRuns: cat.hustle.runs, leaderName: leader.name, leaderRuns: leader.runs })
    }
  }

  const competitorsAhead = sortedCombinedGroups
    .filter(([name]) => name !== HUSTLE_COMBINED_KEY)
    .slice(0, hustleRankIdx >= 0 ? hustleRankIdx : sortedCombinedGroups.length)
    .map(([name, runs]) => ({ name, runs }))

  // ---------- whatThisMeans (rule-generated, cites real numbers) ----------
  const attackOpportunities: string[] = []
  const defensivePriorities: string[] = []
  const seoOpportunities: string[] = []
  const pricingInsights: string[] = []
  const schedulingInsights: string[] = []
  const watchlist: string[] = []

  const attackCategorySet = new Set<string>()
  const defensiveCategorySet = new Set<string>()

  for (const cat of categoryIntel) {
    if (cat.category === 'Other') continue

    // Entity split text, when useful (e.g. "Hustle Academy has no AI courses
    // while Hustle Institute runs 8") — only meaningful when Hustle has >1
    // entity active in this category or one entity is present and one absent.
    const entitySplitText = (() => {
      if (entities.length < 2) return ''
      const parts = entities.map((e) => {
        const entityRuns = cat.hustle.byEntity.find((b) => b.name === e.name)?.runs ?? 0
        return `${e.name} ${entityRuns === 0 ? 'has none' : `runs ${entityRuns}`}`
      })
      return ` (${parts.join(', ')})`
    })()

    // attack: high-opportunity-score categories where COMBINED Hustle share <10%
    if (cat.opportunity && cat.opportunity.score >= 60 && cat.hustle.sharePct < 10) {
      const leader = cat.topProviders[0]
      const leaderText = leader ? ` ${leader.name} runs ${leader.runs} upcoming ${cat.category} sessions while Hustle has ${cat.hustle.runs === 0 ? 'none' : `only ${cat.hustle.runs}`}${entitySplitText}.` : ''
      attackOpportunities.push(
        `${cat.category} has an opportunity score of ${cat.opportunity.score} with Hustle holding only ${cat.hustle.sharePct}% combined share.${leaderText}${leader && leader.runs > 0 && cat.hustle.runs === 0 ? ' — high demand category where Hustle is absent.' : ''}`
      )
      attackCategorySet.add(cat.category)
    }

    // defensive: priority>=75 categories where a competitor's runs > 1.5x COMBINED Hustle's
    if (cat.priority >= 75) {
      const leader = cat.topProviders.find((p) => !hustleEntityNames.has(p.name))
      if (leader && (cat.hustle.runs === 0 ? leader.runs > 0 : leader.runs > cat.hustle.runs * 1.5)) {
        defensivePriorities.push(
          `${leader.name} runs ${leader.runs} upcoming ${cat.category} sessions vs Hustle's combined ${cat.hustle.runs}${entitySplitText} — a strategic category (priority ${cat.priority}) where Hustle is losing ground.`
        )
        defensiveCategorySet.add(cat.category)
      }
    }

    // pricing: combined Hustle median fee deviates >20% from market median
    if (hustleCourses.length > 0 && cat.hustle.courses > 0 && cat.medianFee !== null && cat.medianFee > 0) {
      const hustleCatCourses = hustleCourses.filter((c) => clusterOf(c) === cat.category)
      const hustleFees = hustleCatCourses.map((c) => c.course_fee).filter((f): f is number => f !== null && f !== undefined)
      const hustleMedianFee = median(hustleFees)
      if (hustleMedianFee !== null) {
        const pctDev = ((hustleMedianFee - cat.medianFee) / cat.medianFee) * 100
        if (Math.abs(pctDev) > 20) {
          pricingInsights.push(
            `Hustle's combined median ${cat.category} fee ($${hustleMedianFee}) is ${pctDev > 0 ? 'above' : 'below'} the market median ($${cat.medianFee}) by ${round1(Math.abs(pctDev))}%.`
          )
        }
      }
    }

    // scheduling: Hustle courses (either entity) with demand_score>=50 but runs < category leader's top course
    const leaderTopCourse = cat.topCourses[0] ?? null
    if (leaderTopCourse) {
      for (const c of hustleCourses.filter((c) => clusterOf(c) === cat.category)) {
        if ((c.demand_score ?? 0) >= 50 && (c.upcoming_run_count ?? 0) < leaderTopCourse.runs && !hustleEntityNames.has(leaderTopCourse.provider)) {
          const entityName = resolveProvider(c.provider_name, providerMap).displayName
          schedulingInsights.push(
            `${entityName}'s "${c.title}" has a demand score of ${c.demand_score} but only ${c.upcoming_run_count ?? 0} runs, while ${leaderTopCourse.provider}'s "${leaderTopCourse.title}" runs ${leaderTopCourse.runs} sessions — consider adding more cohorts.`
          )
        }
      }
    }
  }

  // seo: attack + defensive categories
  for (const category of new Set([...attackCategorySet, ...defensiveCategorySet])) {
    seoOpportunities.push(`Consider a dedicated landing page targeting "${category}" — identified as ${attackCategorySet.has(category) ? 'an attack opportunity' : ''}${attackCategorySet.has(category) && defensiveCategorySet.has(category) ? ' and ' : ''}${defensiveCategorySet.has(category) ? 'a defensive priority' : ''}.`)
  }

  // watchlist: providers with threat>=55 or provider_growth changes in last 14 days
  const { data: threatRows } = await supabase
    .from('provider_threat_scores')
    .select('provider_name, total_score, threat_label')
    .eq('is_current', true)
    .gte('total_score', 55)
  for (const row of (threatRows ?? []) as Array<{ provider_name: string; total_score: number; threat_label: string }>) {
    watchlist.push(`${row.provider_name} is a ${row.threat_label} (score ${row.total_score}/100).`)
  }

  const { data: recentGrowth } = await supabase
    .from('course_changes')
    .select('provider_name, change_amount, change_percentage, detected_at')
    .eq('change_type', 'provider_growth')
    .gte('detected_at', daysAgoIso(14))
  for (const row of (recentGrowth ?? []) as Array<{ provider_name: string; change_amount: number | null; change_percentage: number | null }>) {
    watchlist.push(`${row.provider_name} grew upcoming runs by ${row.change_amount} (+${row.change_percentage}%) in the last 14 days.`)
  }

  return {
    hustle: {
      totalRuns: hustleTotalRuns,
      activeCourses: hustleCourses.length,
      marketSharePct: totalMarketRuns > 0 ? round1((hustleTotalRuns / totalMarketRuns) * 100) : 0,
      rank: hustleRankIdx >= 0 ? hustleRankIdx + 1 : null,
      topCategories,
      topCourse: topHustleCourse ? { title: topHustleCourse.title, runs: topHustleCourse.upcoming_run_count ?? 0 } : null,
    },
    entities,
    strongCategories,
    weakCategories,
    absentCategories,
    competitorsAhead,
    whatThisMeans: {
      attackOpportunities,
      defensivePriorities,
      seoOpportunities,
      pricingInsights,
      schedulingInsights,
      watchlist,
    },
  }
}

// ══════════════════════════════════════════════════════════════════════════
// g. getRecentCourseChanges
// ══════════════════════════════════════════════════════════════════════════

export interface CourseChangeRow {
  id: string
  competitor_id: string | null
  provider_name: string | null
  sf_ref_no: string | null
  course_title: string | null
  category: string | null
  change_type: string
  old_value: number | null
  new_value: number | null
  change_amount: number | null
  change_percentage: number | null
  detected_at: string
  source: string | null
  metadata: unknown
}

export async function getRecentCourseChanges(days = 14): Promise<CourseChangeRow[]> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('course_changes')
    .select('*')
    .gte('detected_at', daysAgoIso(days))
    .order('detected_at', { ascending: false })
    .limit(100)

  if (error) {
    console.error('getRecentCourseChanges failed:', error.message)
    return []
  }
  return (data ?? []) as CourseChangeRow[]
}
