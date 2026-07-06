/**
 * Module registry + orchestration for on-demand ("Refresh Now") data refreshes.
 *
 * This mirrors the exact service calls the cron routes make (see
 * src/app/api/cron/*), but is invoked from authenticated API routes instead
 * of Vercel Cron, with triggered_by set to 'manual' or 'admin'.
 *
 * IMPORTANT: keep the per-module logging/counts mapping in sync with the
 * corresponding cron route if that route's mapping ever changes.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { startRefreshLog, type RefreshStatus, type TriggerType } from '@/lib/services/refresh-log'
import { ingestAllSFCourses } from '@/lib/services/ingestion/sf_courses'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'
import { runMarketingRefresh } from '@/lib/services/marketing/refresh'
import { ingestAllJobs } from '@/lib/services/ingestion/jobs'
import { ingestAllSocial } from '@/lib/services/ingestion/social'
import { ingestAllCourses } from '@/lib/services/ingestion/courses'
import { generateDataAlerts } from '@/lib/services/alerts/generate'
import { buildIntelligencePayload } from '@/lib/services/ai/payload'
import { computeOpportunityScores } from '@/lib/services/scoring/opportunity'
import { generateStrategicInsights } from '@/lib/services/ai/claude'

type SupabaseClient = Awaited<ReturnType<typeof createServiceClient>>

// ─── Registry ───────────────────────────────────────────────────────────────

export interface RefreshModuleDescriptor {
  key: string
  label: string
  source: string
}

/**
 * Ordered list of modules that support on-demand refresh via
 * POST /api/refresh/module. SEO is intentionally absent — it's a manual
 * snapshot process with no automated refresh path.
 */
export const REFRESH_MODULES: RefreshModuleDescriptor[] = [
  { key: 'sf_courses', label: 'Course Intelligence (MySkillsFuture catalog)', source: 'myskillsfuture' },
  { key: 'runcounts', label: 'Course Run Counts', source: 'myskillsfuture_scrape' },
  { key: 'marketing', label: 'Marketing / Ads Intelligence', source: 'marketing' },
  { key: 'hiring', label: 'Hiring Intelligence', source: 'job_boards' },
  { key: 'social', label: 'Social Intelligence', source: 'social_platforms' },
  { key: 'course_catalog', label: 'Website Course Catalogs', source: 'company_websites' },
  { key: 'alerts', label: 'Alert Generation', source: 'internal' },
  { key: 'ai_insights', label: 'AI Strategic Insights', source: 'claude' },
]

export const REFRESH_MODULE_KEYS = REFRESH_MODULES.map((m) => m.key)

function moduleDescriptor(moduleKey: string): RefreshModuleDescriptor {
  const found = REFRESH_MODULES.find((m) => m.key === moduleKey)
  if (!found) throw new Error(`Unknown refresh module: ${moduleKey}`)
  return found
}

// ─── Result shape ───────────────────────────────────────────────────────────

export interface ModuleRunCounts {
  fetched?: number
  inserted?: number
  updated?: number
  failed?: number
}

export interface ModuleRunResult {
  module: string
  status: RefreshStatus
  started_at: string
  completed_at: string
  duration_seconds: number
  counts: ModuleRunCounts
  error?: string
}

function nowIso(): string {
  return new Date().toISOString()
}

function buildResult(
  module: string,
  status: RefreshStatus,
  started_at: string,
  counts: ModuleRunCounts,
  error?: string | null
): ModuleRunResult {
  const completed_at = nowIso()
  const duration_seconds = (new Date(completed_at).getTime() - new Date(started_at).getTime()) / 1000
  return {
    module,
    status,
    started_at,
    completed_at,
    duration_seconds,
    counts,
    ...(error ? { error } : {}),
  }
}

// ─── AI insights flow (shared with the ai-insights cron route) ─────────────

const TOP_OPPORTUNITY_COUNT = 8

export interface AiInsightsFlowResult {
  status: RefreshStatus
  counts: ModuleRunCounts
  error?: string
  metadata: { scores: number; insights: number }
}

/**
 * Score -> payload -> generate -> insert flow, extracted from
 * src/app/api/cron/ai-insights/route.ts so the cron route and the on-demand
 * module runner share one implementation. Does NOT write to
 * data_refresh_logs itself — callers wrap this with their own log
 * start/finalize (see the cron route and runAiInsightsModule below) so both
 * call sites keep full control over their own auth/log semantics.
 */
export async function runAiInsightsFlow(supabase: SupabaseClient): Promise<AiInsightsFlowResult> {
  let scoresResult: Awaited<ReturnType<typeof computeOpportunityScores>>
  try {
    scoresResult = await computeOpportunityScores(supabase)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'failed',
      counts: {},
      error: message,
      metadata: { scores: 0, insights: 0 },
    }
  }

  const topOpportunityScores = [...scoresResult.scores]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, TOP_OPPORTUNITY_COUNT)

  try {
    const payload = await buildIntelligencePayload(supabase)
    const insights = await generateStrategicInsights(payload, topOpportunityScores)

    const { data: inserted, error: insertError } = await supabase
      .from('strategic_insights')
      .insert(insights)
      .select()

    if (insertError) {
      throw new Error(`Failed to insert insights: ${insertError.message}`)
    }

    return {
      status: 'success',
      counts: { inserted: (inserted?.length ?? 0) + scoresResult.persisted },
      metadata: { scores: scoresResult.persisted, insights: inserted?.length ?? 0 },
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return {
      status: 'partial',
      counts: { inserted: scoresResult.persisted },
      error: message,
      metadata: { scores: scoresResult.persisted, insights: 0 },
    }
  }
}

// ─── Per-module runners ─────────────────────────────────────────────────────

async function runSfCourses(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('sf_courses')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await ingestAllSFCourses()
    const hasErrors = result.results.some((r) => r.error !== null)
    const errorMessage = hasErrors
      ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}: ${r.error}`).join(' | ')
      : null
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { fetched: result.total_found, inserted: result.total_upserted }
    await log.finalize(status, counts, errorMessage, { deactivated: result.deactivated, results: result.results })
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runRunCounts(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('runcounts')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await scrapeAndUpdateRunCounts()
    const hasErrors = result.errors > 0
    const errorMessage = hasErrors
      ? result.results.filter((r) => r.error).map((r) => `${r.sf_ref_no}: ${r.error}`).join(' | ')
      : null
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { fetched: result.scraped, updated: result.updated, failed: result.errors }
    await log.finalize(status, counts, errorMessage)
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

/**
 * Marketing is the one exception: runMarketingRefresh manages its own
 * data_refresh_logs row internally (module 'marketing'), so we must NOT
 * call startRefreshLog here too — that would create a duplicate log entry
 * for a single logical run. We synthesize the ModuleRunResult purely from
 * its return value.
 *
 * Deviation: runMarketingRefresh's triggeredBy parameter is typed
 * 'cron' | 'manual' (no 'admin'), so admin-triggered runs are logged as
 * 'manual' for this module specifically.
 */
async function runMarketing(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('marketing')
  const started_at = nowIso()
  const marketingTrigger: 'cron' | 'manual' = triggeredBy === 'cron' ? 'cron' : 'manual'
  try {
    const result = await runMarketingRefresh(marketingTrigger)
    const hasErrors = result.errors.length > 0
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { updated: result.records_updated, failed: result.errors.length }
    const errorMessage = hasErrors
      ? result.errors.map((e) => `${e.competitor}/${e.field}: ${e.error}`).join(' | ')
      : undefined
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runHiring(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('hiring')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await ingestAllJobs()
    const totalFound = result.results.reduce((sum, r) => sum + r.jobs_found, 0)
    const hasErrors = result.results.some((r) => r.error !== null)
    const errorMessage = hasErrors
      ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}/${r.source}: ${r.error}`).join(' | ')
      : null
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { fetched: totalFound, inserted: result.total_jobs_inserted }
    await log.finalize(status, counts, errorMessage)
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runSocial(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('social')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await ingestAllSocial()
    const hasErrors = result.failed > 0
    const errorMessage = hasErrors
      ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}/${r.platform}: ${r.error}`).join(' | ')
      : null
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { fetched: result.total, updated: result.successful, failed: result.failed }
    await log.finalize(status, counts, errorMessage)
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runCourseCatalog(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('course_catalog')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await ingestAllCourses()
    const totalFound = result.results.reduce((sum, r) => sum + r.courses_found, 0)
    const hasErrors = result.results.some((r) => r.error !== null)
    const errorMessage = hasErrors
      ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}/${r.source}: ${r.error}`).join(' | ')
      : null
    const status: RefreshStatus = hasErrors ? 'partial' : 'success'
    const counts: ModuleRunCounts = { fetched: totalFound, inserted: result.total_courses_inserted }
    await log.finalize(status, counts, errorMessage)
    return buildResult(descriptor.key, status, started_at, counts, errorMessage)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runAlerts(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('alerts')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  try {
    const result = await generateDataAlerts()
    const counts: ModuleRunCounts = { inserted: result.created }
    await log.finalize('success', counts)
    return buildResult(descriptor.key, 'success', started_at, counts)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return buildResult(descriptor.key, 'failed', started_at, {}, message)
  }
}

async function runAiInsightsModule(triggeredBy: TriggerType): Promise<ModuleRunResult> {
  const descriptor = moduleDescriptor('ai_insights')
  const log = await startRefreshLog(descriptor.key, descriptor.source, triggeredBy)
  const started_at = nowIso()
  const supabase = await createServiceClient()

  const flowResult = await runAiInsightsFlow(supabase)
  await log.finalize(flowResult.status, flowResult.counts, flowResult.error ?? null, flowResult.metadata)
  return buildResult(descriptor.key, flowResult.status, started_at, flowResult.counts, flowResult.error)
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

export async function runRefreshModule(
  moduleKey: string,
  triggeredBy: TriggerType
): Promise<ModuleRunResult> {
  switch (moduleKey) {
    case 'sf_courses':
      return runSfCourses(triggeredBy)
    case 'runcounts':
      return runRunCounts(triggeredBy)
    case 'marketing':
      return runMarketing(triggeredBy)
    case 'hiring':
      return runHiring(triggeredBy)
    case 'social':
      return runSocial(triggeredBy)
    case 'course_catalog':
      return runCourseCatalog(triggeredBy)
    case 'alerts':
      return runAlerts(triggeredBy)
    case 'ai_insights':
      return runAiInsightsModule(triggeredBy)
    default:
      throw new Error(`Unknown refresh module: ${moduleKey}`)
  }
}

// ─── Duplicate-run prevention ───────────────────────────────────────────────

const RUNNING_STALE_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export interface RunningRefreshInfo {
  module: string
  started_at: string
  triggered_by: string
}

/**
 * Returns info about a currently-running refresh for `moduleKey`, or null.
 * "Running" means status='running' AND started_at within the last 15
 * minutes — older 'running' rows are treated as dead (crashed job) so they
 * can never permanently lock out future refreshes of that module.
 */
export async function isModuleRunning(moduleKey: string): Promise<RunningRefreshInfo | null> {
  const supabase = await createServiceClient()
  const cutoff = new Date(Date.now() - RUNNING_STALE_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('data_refresh_logs')
    .select('module, started_at, triggered_by')
    .eq('module', moduleKey)
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) return null
  return {
    module: data.module as string,
    started_at: data.started_at as string,
    triggered_by: data.triggered_by as string,
  }
}

/**
 * Returns info about ANY currently-running refresh (any module), or null.
 * Same 15-minute staleness rule as isModuleRunning.
 */
export async function isAnyRefreshRunning(): Promise<RunningRefreshInfo[]> {
  const supabase = await createServiceClient()
  const cutoff = new Date(Date.now() - RUNNING_STALE_WINDOW_MS).toISOString()

  const { data, error } = await supabase
    .from('data_refresh_logs')
    .select('module, started_at, triggered_by')
    .eq('status', 'running')
    .gte('started_at', cutoff)
    .order('started_at', { ascending: false })

  if (error || !data) return []
  return data.map((row) => ({
    module: row.module as string,
    started_at: row.started_at as string,
    triggered_by: row.triggered_by as string,
  }))
}
