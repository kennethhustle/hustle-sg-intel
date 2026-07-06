/**
 * Data source status service — the single place refresh jobs report source
 * outcomes to, and the UI reads operational status from.
 */
import { createServiceClient } from '@/lib/supabase/server'

export type SourceStatus =
  | 'connected' | 'working' | 'partial' | 'failed'
  | 'unavailable' | 'manual_only' | 'static_only' | 'not_configured'

export interface SourceStatusPatch {
  status?: SourceStatus
  last_success_at?: string
  last_failed_at?: string
  last_checked_at?: string
  last_response_time_ms?: number
  records_fetched_last_run?: number
  records_updated_last_run?: number
  error_message?: string | null
}

/** Report a refresh/test outcome for a source. Never throws. */
export async function updateSourceStatus(sourceKey: string, patch: SourceStatusPatch): Promise<void> {
  try {
    const supabase = await createServiceClient()
    await supabase
      .from('data_sources')
      .update({ ...patch, last_checked_at: patch.last_checked_at ?? new Date().toISOString() })
      .eq('source_key', sourceKey)
  } catch (err) {
    console.error(`updateSourceStatus(${sourceKey}) failed:`, err)
  }
}

/** Convenience wrappers */
export async function reportSourceSuccess(
  sourceKey: string,
  counts?: { fetched?: number; updated?: number },
  responseTimeMs?: number
) {
  const now = new Date().toISOString()
  await updateSourceStatus(sourceKey, {
    status: 'working',
    last_success_at: now,
    last_checked_at: now,
    last_response_time_ms: responseTimeMs,
    records_fetched_last_run: counts?.fetched,
    records_updated_last_run: counts?.updated,
    error_message: null,
  })
}

export async function reportSourceFailure(sourceKey: string, error: string, partial = false) {
  const now = new Date().toISOString()
  await updateSourceStatus(sourceKey, {
    status: partial ? 'partial' : 'failed',
    last_failed_at: now,
    last_checked_at: now,
    error_message: error.slice(0, 500),
  })
}

export interface DataSourceRow {
  id: string
  source_key: string
  source_name: string
  source_type: 'api' | 'scraper' | 'manual' | 'static_snapshot' | 'ai_generated' | 'database'
  module: string
  provider: string | null
  endpoint_or_url: string | null
  status: SourceStatus
  last_success_at: string | null
  last_failed_at: string | null
  last_checked_at: string | null
  last_response_time_ms: number | null
  records_fetched_last_run: number | null
  records_updated_last_run: number | null
  error_message: string | null
  requires_api_key: boolean
  api_key_env_name: string | null
  is_enabled: boolean
  reliability_level: 'high' | 'medium' | 'low'
  stale_after_hours: number | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

/** A source row enriched with runtime-derived flags (never exposes key values). */
export interface SourceWithRuntime extends DataSourceRow {
  key_configured: boolean | null // null = no key required
  is_stale: boolean
}

export async function getSourceStatuses(module?: string): Promise<SourceWithRuntime[]> {
  const supabase = await createServiceClient()
  let query = supabase.from('data_sources').select('*').order('module').order('source_name')
  if (module) query = query.eq('module', module)
  const { data } = await query
  const now = Date.now()

  return ((data ?? []) as DataSourceRow[]).map((s) => {
    const keyConfigured = s.api_key_env_name ? Boolean(process.env[s.api_key_env_name]) : null
    const isStale =
      s.stale_after_hours !== null &&
      (s.last_success_at
        ? now - new Date(s.last_success_at).getTime() > s.stale_after_hours * 3600_000
        : true)
    // A source that requires a key but has none configured overrides its stored status
    const status: SourceStatus =
      s.requires_api_key && keyConfigured === false ? 'not_configured' : s.status
    return { ...s, status, key_configured: keyConfigured, is_stale: isStale }
  })
}

// ─── Data confidence score ────────────────────────────────────────────────────

export interface ConfidenceBreakdownRow {
  module: string
  label: string
  level: 'high' | 'medium' | 'low'
  score: number // 0-100 module sub-score
  reason: string
}

export interface DataConfidence {
  score: number // 0-100 overall
  breakdown: ConfidenceBreakdownRow[]
  counts: { working: number; partial: number; unavailable: number; manual: number; not_configured: number }
}

const MODULE_LABELS: Record<string, string> = {
  course_intelligence: 'Course data',
  marketing_intelligence: 'Marketing data',
  hiring_intelligence: 'Hiring data',
  social_intelligence: 'Social data',
  seo_intelligence: 'SEO data',
  opportunity_engine: 'AI insights',
  alerts: 'Alerts',
  platform: 'Platform',
}

// How much each module matters to overall confidence (sums to 1.0)
const MODULE_WEIGHTS: Record<string, number> = {
  course_intelligence: 0.3,
  marketing_intelligence: 0.25,
  hiring_intelligence: 0.15,
  social_intelligence: 0.1,
  seo_intelligence: 0.1,
  opportunity_engine: 0.1,
}

function sourceScore(s: SourceWithRuntime): number {
  // Score each enabled source 0-100 by status, staleness and reliability
  let base: number
  switch (s.status) {
    case 'working': base = 100; break
    case 'connected': base = 70; break // configured but no successful run yet
    case 'partial': base = 60; break
    case 'manual_only':
    case 'static_only': base = s.is_stale ? 25 : 50; break
    case 'failed': base = 15; break
    case 'unavailable': base = 0; break
    case 'not_configured': base = 0; break
  }
  if (s.status === 'working' && s.is_stale) base = 55 // succeeded once but data is old
  // Reliability dampener: low-reliability sources can't claim full confidence
  const cap = s.reliability_level === 'high' ? 100 : s.reliability_level === 'medium' ? 85 : 65
  return Math.min(base, cap)
}

export async function computeDataConfidence(): Promise<DataConfidence> {
  const sources = (await getSourceStatuses()).filter((s) => s.is_enabled)

  const counts = {
    working: sources.filter((s) => s.status === 'working').length,
    partial: sources.filter((s) => s.status === 'partial' || s.status === 'connected').length,
    unavailable: sources.filter((s) => s.status === 'unavailable' || s.status === 'failed').length,
    manual: sources.filter((s) => s.status === 'manual_only' || s.status === 'static_only').length,
    not_configured: sources.filter((s) => s.status === 'not_configured').length,
  }

  const breakdown: ConfidenceBreakdownRow[] = []
  let weighted = 0
  let weightUsed = 0

  for (const [module, weight] of Object.entries(MODULE_WEIGHTS)) {
    const moduleSources = sources.filter((s) => s.module === module)
    if (moduleSources.length === 0) continue
    const avg = moduleSources.reduce((sum, s) => sum + sourceScore(s), 0) / moduleSources.length
    const level: 'high' | 'medium' | 'low' = avg >= 70 ? 'high' : avg >= 40 ? 'medium' : 'low'

    const working = moduleSources.filter((s) => s.status === 'working').length
    const bad = moduleSources.filter((s) =>
      ['failed', 'unavailable', 'not_configured'].includes(s.status)).length
    const manual = moduleSources.filter((s) =>
      ['manual_only', 'static_only'].includes(s.status)).length
    const stale = moduleSources.filter((s) => s.is_stale).length

    const reasons: string[] = []
    if (working > 0) reasons.push(`${working}/${moduleSources.length} sources working`)
    if (manual > 0) reasons.push(`${manual} manual/static`)
    if (bad > 0) reasons.push(`${bad} unavailable or not configured`)
    if (stale > 0) reasons.push(`${stale} stale`)

    breakdown.push({
      module,
      label: MODULE_LABELS[module] ?? module,
      level,
      score: Math.round(avg),
      reason: reasons.join(' · ') || 'No data',
    })
    weighted += avg * weight
    weightUsed += weight
  }

  return {
    score: weightUsed > 0 ? Math.round(weighted / weightUsed) : 0,
    breakdown,
    counts,
  }
}
