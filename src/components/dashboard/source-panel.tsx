/**
 * SourcePanel — compact per-module data source transparency panel.
 * Server component: reads getSourceStatuses(module) and renders one line per
 * enabled source with a status dot, last success time (SGT), and staleness
 * warning. Optional `extraLines` renders cached-record notes below.
 */
import { getSourceStatuses, type SourceStatus, type SourceWithRuntime } from '@/lib/services/data-sources'
import { AlertTriangle, Database } from 'lucide-react'
import { cn } from '@/lib/utils'

const SGT = 'Asia/Singapore'

const STATUS_DOT: Record<SourceStatus, string> = {
  working: 'bg-emerald-500',
  connected: 'bg-teal-500',
  partial: 'bg-amber-500',
  failed: 'bg-red-500',
  unavailable: 'bg-red-800',
  manual_only: 'bg-amber-500',
  static_only: 'bg-amber-500',
  not_configured: 'bg-slate-600',
}

const STATUS_WORD: Record<SourceStatus, string> = {
  working: 'Working',
  connected: 'Configured',
  partial: 'Partial',
  failed: 'Failed',
  unavailable: 'Unavailable',
  manual_only: 'Manual snapshot',
  static_only: 'Static snapshot',
  not_configured: 'Not configured',
}

const STATUS_TEXT: Record<SourceStatus, string> = {
  working: 'text-emerald-400',
  connected: 'text-teal-400',
  partial: 'text-amber-400',
  failed: 'text-red-400',
  unavailable: 'text-red-500',
  manual_only: 'text-amber-400',
  static_only: 'text-amber-400',
  not_configured: 'text-slate-500',
}

function fmtSgt(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dISO = dayFmt.format(d)
  const nowISO = dayFmt.format(now)
  const yesterdayISO = dayFmt.format(new Date(now.getTime() - 86_400_000))
  const timeStr = d.toLocaleTimeString('en-SG', { timeZone: SGT, hour: 'numeric', minute: '2-digit', hour12: true })

  if (dISO === nowISO) return `today ${timeStr} SGT`
  if (dISO === yesterdayISO) return `yesterday ${timeStr} SGT`
  const dateStr = d.toLocaleDateString('en-SG', { timeZone: SGT, day: 'numeric', month: 'short' })
  return `${dateStr} ${timeStr} SGT`
}

function sourceLine(s: SourceWithRuntime): string {
  if (s.status === 'not_configured' && s.api_key_env_name) {
    return `Add ${s.api_key_env_name} to enable`
  }
  if (s.status === 'working' || s.status === 'connected' || s.status === 'partial') {
    return `${STATUS_WORD[s.status]} — refreshed ${fmtSgt(s.last_success_at)}`
  }
  if (s.status === 'manual_only' || s.status === 'static_only') {
    return `${STATUS_WORD[s.status]} — verified ${fmtSgt(s.last_success_at)}`
  }
  if (s.status === 'failed' && s.error_message) {
    return `Failed — ${s.error_message.slice(0, 80)}`
  }
  return STATUS_WORD[s.status]
}

export async function SourcePanel({
  module,
  extraLines,
  className,
}: {
  /** data_sources.module value, e.g. 'course_intelligence' */
  module: string
  /** cached record counts / notes shown below the source list */
  extraLines?: string[]
  className?: string
}) {
  const sources = (await getSourceStatuses(module)).filter((s) => s.is_enabled)

  if (sources.length === 0 && (!extraLines || extraLines.length === 0)) return null

  return (
    <div className={cn('rounded-xl border border-slate-800/60 bg-slate-900/40 p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Database className="h-3.5 w-3.5 text-slate-500" />
        <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500">Data Sources</p>
      </div>

      {sources.length === 0 ? (
        <p className="text-xs text-slate-600">No sources registered for this module.</p>
      ) : (
        <div className="space-y-1.5">
          {sources.map((s) => (
            <div key={s.source_key} className="flex items-start gap-2 text-xs">
              <span className={cn('mt-1 h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT[s.status])} />
              <span className="text-slate-300 shrink-0">{s.source_name}</span>
              <span className={cn('flex-1 min-w-0', STATUS_TEXT[s.status])}>{sourceLine(s)}</span>
              {s.is_stale && (
                <span title={`Data stale — older than ${s.stale_after_hours ?? '?'} hours`} className="shrink-0">
                  <AlertTriangle className="h-3 w-3 text-amber-500" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {extraLines && extraLines.length > 0 && (
        <div className="mt-3 pt-3 border-t border-slate-800/60 space-y-1">
          {extraLines.map((line, i) => (
            <p key={i} className="text-[11px] text-slate-500">{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}
