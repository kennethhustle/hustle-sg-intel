'use client'

/**
 * LiveDataIndicator — single source-of-truth health indicator, rendered in
 * two places: full (with label) in the sidebar, compact (dot only) in the
 * sticky header next to <LastUpdated />. Both read from GET /api/refresh/status.
 *
 * Click/hover reveals a popover with a per-module breakdown, plus fixed notes
 * for SEO (manual snapshot) and Social (YouTube-only coverage).
 */
import { useEffect, useRef, useState } from 'react'
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

function fmtTime(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' SGT'
}

interface LiveDataIndicatorProps {
  /** 'full' (sidebar, dot + label) or 'compact' (header, dot only, click to open popover) */
  variant?: 'full' | 'compact'
}

export function LiveDataIndicator({ variant = 'full' }: LiveDataIndicatorProps) {
  const { state, data } = useRefreshStatus()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const overall: OverallHealth = state === 'ready' && data ? data.overall : 'grey'
  const cfg = CONFIG[overall]
  const label =
    state === 'loading' ? 'Checking data health…' :
    state === 'error' ? 'Unable to check data health' :
    state === 'no-session' ? 'No refresh data' :
    cfg.label

  const showPulse = state === 'ready' && overall === 'green'
  const modules = state === 'ready' && data ? data.modules : []

  const Dot = (
    <span className="relative flex h-2 w-2">
      {showPulse && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.ping} opacity-50`} />
      )}
      <span className={`relative inline-flex rounded-full h-2 w-2 ${state === 'ready' ? cfg.dot : 'bg-slate-600'}`} />
    </span>
  )

  const Popover = open && (
    <div className="absolute z-50 top-full mt-2 left-0 w-72 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 space-y-2">
      <p className="text-[10px] font-mono tracking-widest uppercase text-slate-500 mb-1">Data freshness</p>
      {modules.length === 0 ? (
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
        </div>
      )}
      <div className="pt-2 mt-1 border-t border-slate-800 space-y-1">
        <p className="text-xs text-slate-500">SEO Intel: Manual snapshot</p>
        <p className="text-xs text-slate-500">Social: YouTube only — other platforms unavailable</p>
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
      {Popover}
    </div>
  )
}
