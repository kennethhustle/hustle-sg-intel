'use client'

/**
 * LiveDataIndicator — single source-of-truth health indicator, rendered in
 * two places: full (with label) in the sidebar, compact (dot + counts) in the
 * sticky header next to <LastUpdated />. Both read from GET /api/refresh/status.
 *
 * Click/hover reveals a popover. When opened, it lazily fetches
 * GET /api/data-sources and renders real per-source lines grouped by module;
 * if that fetch fails (or the route/field isn't available yet), it falls back
 * to the existing module-level lines from /api/refresh/status.
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRefreshStatus } from './last-updated'

type OverallHealth = 'green' | 'yellow' | 'red' | 'grey'

const CONFIG: Record<OverallHealth, { dot: string; ping: string; label: string; text: string }> = {
  green:  { dot: 'bg-emerald-500', ping: 'bg-emerald-400', label: 'Data healthy',      text: 'text-emerald-600' },
  yellow: { dot: 'bg-yellow-500',  ping: 'bg-yellow-400',  label: 'Some data stale',   text: 'text-yellow-600' },
  red:    { dot: 'bg-red-500',     ping: 'bg-red-400',     label: 'Refresh failure',   text: 'text-red-500'   },
  grey:   { dot: 'bg-slate-600',   ping: 'bg-slate-500',   label: 'No refresh data',   text: 'text-slate-500' },
}

const MODULE_LABELS: Record<string, string> = {
  sf_courses: 'Course Catalog',
  runcounts: 'Course Run Counts',
  marketing: 'Marketing',
  hiring: 'Hiring',
  social: 'Social',
  course_catalog: 'Website Catalogs',
  alerts: 'Alerts',
  ai_insights: 'AI Insights',
  // data_sources.module values (for the per-source breakdown)
  course_intelligence: 'Course Intelligence',
  marketing_intelligence: 'Marketing Intelligence',
  hiring_intelligence: 'Hiring Intelligence',
  social_intelligence: 'Social Intelligence',
  seo_intelligence: 'SEO Intelligence',
  opportunity_engine: 'Opportunity Engine',
  platform: 'Platform',
}

const STATUS_LABEL: Record<string, string> = {
  success: 'Success',
  partial: 'Partial success',
  failed: 'Failed',
  running: 'Running',
  stale: 'Stale',
  none: 'No data',
}

const STATUS_COLOR: Record<string, string> = {
  success: 'text-emerald-400',
  partial: 'text-amber-400',
  failed: 'text-red-400',
  running: 'text-blue-400',
  stale: 'text-amber-500',
  none: 'text-slate-500',
}

// data_sources status -> short human word + colour, for the per-source popover lines
const SOURCE_STATUS_LABEL: Record<string, string> = {
  working: 'Working',
  connected: 'Configured',
  partial: 'Partial',
  failed: 'Failed',
  unavailable: 'Unavailable',
  manual_only: 'Manual snapshot',
  static_only: 'Static snapshot',
  not_configured: 'Not configured',
}

const SOURCE_STATUS_COLOR: Record<string, string> = {
  working: 'text-emerald-400',
  connected: 'text-teal-400',
  partial: 'text-amber-400',
  failed: 'text-red-400',
  unavailable: 'text-red-500',
  manual_only: 'text-amber-400',
  static_only: 'text-amber-400',
  not_configured: 'text-slate-500',
}

function fmtTime(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' SGT'
}

// ─── Lazy per-source fetch ──────────────────────────────────────────────────

interface SourceRow {
  source_key: string
  source_name: string
  module: string
  status: keyof typeof SOURCE_STATUS_LABEL | string
  error_message: string | null
}

type SourcesFetchState = 'idle' | 'loading' | 'ready' | 'error'

function sourceDetailNote(s: SourceRow): string {
  if (s.status === 'unavailable' && s.error_message) return `Unavailable (${s.error_message.slice(0, 40)})`
  if (s.status === 'manual_only') return 'Manual snapshot'
  if (s.status === 'static_only') return 'Static snapshot'
  return SOURCE_STATUS_LABEL[s.status] ?? s.status
}

interface LiveDataIndicatorProps {
  /** 'full' (sidebar, dot + label) or 'compact' (header, dot only, click to open popover) */
  variant?: 'full' | 'compact'
}

export function LiveDataIndicator({ variant = 'full' }: LiveDataIndicatorProps) {
  const { state, data } = useRefreshStatus()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const [sourcesState, setSourcesState] = useState<SourcesFetchState>('idle')
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([])

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  // Lazily fetch per-source detail the first time the popover opens.
  useEffect(() => {
    if (!open || sourcesState !== 'idle') return
    let cancelled = false
    setSourcesState('loading')
    fetch('/api/data-sources')
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        if (cancelled) return
        const rows = Array.isArray(json?.data) ? (json.data as SourceRow[]) : []
        setSourceRows(rows)
        setSourcesState('ready')
      })
      .catch(() => {
        if (!cancelled) setSourcesState('error')
      })
    return () => { cancelled = true }
  }, [open, sourcesState])

  const overall: OverallHealth = state === 'ready' && data ? data.overall : 'grey'
  const cfg = CONFIG[overall]
  const label =
    state === 'loading' ? 'Checking data health…' :
    state === 'error' ? 'Unable to check data health' :
    state === 'no-session' ? 'No refresh data' :
    cfg.label

  const showPulse = state === 'ready' && overall === 'green'
  const modules = state === 'ready' && data ? data.modules : []
  const sourceCounts = state === 'ready' ? data?.sources : undefined

  // Compact counts label, e.g. "6✓ 2⚠ 3✕" / full "Sources: 6 working · 3 down"
  const countsLabel = sourceCounts
    ? `${sourceCounts.working}✓ ${sourceCounts.partial}⚠ ${sourceCounts.unavailable + sourceCounts.not_configured}✕`
    : null
  const countsLabelFull = sourceCounts
    ? `Sources: ${sourceCounts.working} working · ${sourceCounts.unavailable + sourceCounts.not_configured} down`
    : null

  const Dot = (
    <span className="relative flex h-2 w-2">
      {showPulse && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.ping} opacity-50`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${state === 'ready' ? cfg.dot : 'bg-slate-600'}`} />
    </span>
  )

  // Group per-source rows by module for the popover.
  const sourcesByModule = new Map<string, SourceRow[]>()
  for (const s of sourceRows) {
    const arr = sourcesByModule.get(s.module) ?? []
    arr.push(s)
    sourcesByModule.set(s.module, arr)
  }

  const Popover = open && (
    <div className="absolute z-50 top-full mt-2 left-0 w-80 max-h-96 overflow-y-auto bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 space-y-2">
      <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-1">Data freshness</p>

      {sourcesState === 'ready' && sourceRows.length > 0 ? (
        <div className="space-y-3">
          {Array.from(sourcesByModule.entries()).map(([mod, rows]) => (
            <div key={mod}>
              <p className="text-[10px] text-slate-600 uppercase tracking-wide mb-1">{MODULE_LABELS[mod] ?? mod}</p>
              <div className="space-y-1">
                {rows.map((s) => (
                  <div key={s.source_key} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-slate-300 truncate">{s.source_name}</span>
                    <span className={SOURCE_STATUS_COLOR[s.status] ?? 'text-slate-500'}>
                      {sourceDetailNote(s)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : sourcesState === 'loading' ? (
        <p className="text-xs text-slate-500">Loading sources…</p>
      ) : modules.length === 0 ? (
        <p className="text-xs text-slate-500">No refresh data available yet.</p>
      ) : (
        <div className="space-y-1.5">
          {modules.map((m) => (
            <div key={m.module} className="flex items-center justify-between text-xs gap-2">
              <span className="text-slate-300">{MODULE_LABELS[m.module] ?? m.module}</span>
              <span className={STATUS_COLOR[m.status] ?? 'text-slate-500'}>
                {STATUS_LABEL[m.status] ?? m.status}
                {m.last_success_at ? ` · ${fmtTime(m.last_success_at)}` : ''}
              </span>
            </div>
          ))}
          <div className="pt-2 mt-1 border-t border-slate-800 space-y-1">
            <p className="text-xs text-slate-500">SEO Intel: Manual snapshot</p>
            <p className="text-xs text-slate-500">Social: YouTube only — other platforms unavailable</p>
          </div>
        </div>
      )}

      <div className="pt-2 mt-1 border-t border-slate-800">
        <Link
          href="/settings/data-sources"
          className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          onClick={() => setOpen(false)}
        >
          View all sources →
        </Link>
      </div>
    </div>
  )

  if (variant === 'compact') {
    return (
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
          title={label}
          aria-label="Data freshness"
        >
          {Dot}
          {countsLabel && (
            <span className="hidden sm:inline text-[10px] font-mono text-slate-500">{countsLabel}</span>
          )}
        </button>
        {Popover}
      </div>
    )
  }

  return (
    <div ref={ref} className="relative mt-3">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-2" title={label}>
        {Dot}
        <span className={`text-[10px] font-mono tracking-wider uppercase ${state === 'ready' ? cfg.text : 'text-slate-600'}`}>
          {label}
        </span>
      </button>
      {countsLabelFull && (
        <p className="text-[10px] font-mono text-slate-600 mt-1 pl-4">{countsLabelFull}</p>
      )}
      {Popover}
    </div>
  )
}
