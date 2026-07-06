/**
 * ModuleStatus — compact per-page freshness line shown under the page header
 * of each intelligence module. Server component: queries data_refresh_logs
 * directly (createServiceClient) for the latest row + latest success for the
 * given module key.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { DataSourceBadge, type DataSourceKind } from '@/components/dashboard/data-source-badge'
import { cn } from '@/lib/utils'

const SGT = 'Asia/Singapore'

type HealthLabel = 'Healthy' | 'Partial success' | 'Failed' | 'Stale >24h' | 'No data'

const STALE_MS = 24 * 60 * 60 * 1000

function formatSgt(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dISO = dayFmt.format(d)
  const nowISO = dayFmt.format(now)
  const yesterdayISO = dayFmt.format(new Date(now.getTime() - 86_400_000))

  const timeStr = d.toLocaleTimeString('en-SG', { timeZone: SGT, hour: 'numeric', minute: '2-digit', hour12: true })

  if (dISO === nowISO) return `Today, ${timeStr} SGT`
  if (dISO === yesterdayISO) return `Yesterday, ${timeStr} SGT`

  const dateStr = d.toLocaleDateString('en-SG', { timeZone: SGT, day: 'numeric', month: 'short', year: 'numeric' })
  return `${dateStr}, ${timeStr} SGT`
}

interface LatestRow {
  status: string
  started_at: string
  completed_at: string | null
  error_message: string | null
}

async function getModuleStatus(moduleKey: string): Promise<{
  latest: LatestRow | null
  lastSuccessAt: string | null
}> {
  const supabase = await createServiceClient()

  const { data: logs } = await supabase
    .from('data_refresh_logs')
    .select('status, started_at, completed_at, error_message')
    .eq('module', moduleKey)
    .order('started_at', { ascending: false })
    .limit(20)

  if (!logs || logs.length === 0) {
    return { latest: null, lastSuccessAt: null }
  }

  const latest = logs[0]
  const lastSuccess = logs.find((l) => l.status === 'success' || l.status === 'partial')

  return { latest, lastSuccessAt: lastSuccess?.started_at ?? null }
}

function resolveHealth(latest: LatestRow | null, lastSuccessAt: string | null): { label: HealthLabel; color: string } {
  if (!latest) return { label: 'No data', color: 'text-slate-500' }
  if (latest.status === 'failed') return { label: 'Failed', color: 'text-red-400' }
  if (latest.status === 'partial') return { label: 'Partial success', color: 'text-amber-400' }

  const referenceTime = lastSuccessAt ?? latest.started_at
  const age = Date.now() - new Date(referenceTime).getTime()
  if (age > STALE_MS) return { label: 'Stale >24h', color: 'text-amber-500' }

  return { label: 'Healthy', color: 'text-emerald-400' }
}

export async function ModuleStatus({
  module,
  sourceLabel,
  extra,
  badgeKind = 'cached',
}: {
  /** data_refresh_logs.module key, e.g. 'sf_courses' */
  module: string
  /** e.g. "MySkillsFuture cached data" */
  sourceLabel: string
  /** optional trailing note */
  extra?: string
  badgeKind?: DataSourceKind
}) {
  const { latest, lastSuccessAt } = await getModuleStatus(module)
  const health = resolveHealth(latest, lastSuccessAt)

  const referenceTime = lastSuccessAt ?? latest?.started_at ?? null
  const refreshedText = referenceTime ? formatSgt(referenceTime) : 'never'

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500 mb-4">
      <span>
        Last refreshed: <span className="text-slate-300">{refreshedText}</span>
      </span>
      <span className="text-slate-700">·</span>
      <span>
        Source: <span className="text-slate-300">{sourceLabel}</span>
      </span>
      <span className="text-slate-700">·</span>
      <span>
        Status: <span className={cn('font-medium', health.color)}>{health.label}</span>
      </span>
      {extra && (
        <>
          <span className="text-slate-700">·</span>
          <span>{extra}</span>
        </>
      )}
      <DataSourceBadge kind={badgeKind} asOf={referenceTime} />
    </div>
  )
}
