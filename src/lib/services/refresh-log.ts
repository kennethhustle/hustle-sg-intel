/**
 * Shared refresh logging for ALL cron/refresh jobs.
 * Every job writes a row to data_refresh_logs so the dashboard can show
 * real refresh health instead of an always-green indicator.
 */
import { createServiceClient } from '@/lib/supabase/server'

export type RefreshStatus = 'success' | 'partial' | 'failed'
export type TriggerType = 'cron' | 'manual' | 'admin'

export interface RefreshCounts {
  fetched?: number
  inserted?: number
  updated?: number
  failed?: number
}

export interface RefreshLogHandle {
  logId: string | null
  finalize: (
    status: RefreshStatus,
    counts?: RefreshCounts,
    errorMessage?: string | null,
    metadata?: Record<string, unknown>
  ) => Promise<void>
}

/**
 * Start a refresh log entry. Always returns a handle whose `finalize` is safe
 * to call even if the initial insert failed (it becomes a no-op).
 */
export async function startRefreshLog(
  module: string,
  source: string,
  triggeredBy: TriggerType = 'cron',
  competitorId?: string | null
): Promise<RefreshLogHandle> {
  const supabase = await createServiceClient()
  const startedAt = new Date().toISOString()

  const { data, error } = await supabase
    .from('data_refresh_logs')
    .insert({
      module,
      source,
      started_at: startedAt,
      status: 'running',
      triggered_by: triggeredBy,
      competitor_id: competitorId ?? null,
    })
    .select('id')
    .single()

  const logId: string | null = error ? null : (data?.id ?? null)

  return {
    logId,
    finalize: async (status, counts, errorMessage, metadata) => {
      if (!logId) return
      const completedAt = new Date().toISOString()
      const durationSec =
        (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
      await supabase
        .from('data_refresh_logs')
        .update({
          completed_at: completedAt,
          status,
          duration_seconds: durationSec,
          records_fetched: counts?.fetched ?? null,
          records_inserted: counts?.inserted ?? null,
          records_updated: counts?.updated ?? null,
          records_failed: counts?.failed ?? null,
          error_message: errorMessage ?? null,
          metadata: metadata ?? null,
        })
        .eq('id', logId)
    },
  }
}

/** Modules considered critical when computing overall refresh health. */
export const KEY_MODULES = ['sf_courses', 'runcounts', 'marketing', 'hiring', 'social', 'ai_insights'] as const

export type OverallHealth = 'green' | 'yellow' | 'red' | 'grey'

export interface ModuleHealth {
  module: string
  status: RefreshStatus | 'running' | 'stale' | 'none'
  last_success_at: string | null
  last_run_at: string | null
  last_error: string | null
}

/**
 * Compute refresh health from data_refresh_logs.
 * green  = all key modules succeeded (or partial) within the last 24h+grace
 * yellow = some modules failed/partial/stale
 * red    = a critical module's most recent run failed
 * grey   = no refresh data at all
 */
export async function getRefreshHealth(): Promise<{
  overall: OverallHealth
  modules: ModuleHealth[]
}> {
  const supabase = await createServiceClient()
  const { data: logs } = await supabase
    .from('data_refresh_logs')
    .select('module, status, started_at, completed_at, error_message')
    .order('started_at', { ascending: false })
    .limit(200)

  if (!logs || logs.length === 0) {
    return {
      overall: 'grey',
      modules: KEY_MODULES.map((m) => ({
        module: m, status: 'none', last_success_at: null, last_run_at: null, last_error: null,
      })),
    }
  }

  const STALE_MS = 30 * 60 * 60 * 1000 // 24h + 6h grace
  const now = Date.now()
  const modules: ModuleHealth[] = KEY_MODULES.map((m) => {
    const moduleLogs = logs.filter((l) => l.module === m)
    const latest = moduleLogs[0]
    const lastSuccess = moduleLogs.find((l) => l.status === 'success' || l.status === 'partial')
    if (!latest) {
      return { module: m, status: 'none', last_success_at: null, last_run_at: null, last_error: null }
    }
    const stale = !lastSuccess || now - new Date(lastSuccess.started_at).getTime() > STALE_MS
    return {
      module: m,
      status: latest.status === 'failed' ? 'failed' : stale ? 'stale' : (latest.status as ModuleHealth['status']),
      last_success_at: lastSuccess?.started_at ?? null,
      last_run_at: latest.started_at,
      last_error: latest.status === 'failed' ? latest.error_message : null,
    }
  })

  const anyData = modules.some((m) => m.status !== 'none')
  if (!anyData) return { overall: 'grey', modules }

  const failed = modules.filter((m) => m.status === 'failed')
  const degraded = modules.filter((m) => m.status === 'stale' || m.status === 'partial' || m.status === 'none')

  const overall: OverallHealth =
    failed.length > 0 ? 'red' : degraded.length > 0 ? 'yellow' : 'green'

  return { overall, modules }
}
