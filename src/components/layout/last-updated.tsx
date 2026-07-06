'use client'

/**
 * LastUpdated — single source of truth for "when did intelligence data last
 * refresh" shown in the sticky header on every page. Polls
 * GET /api/refresh/status on mount and every 60s.
 */
import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'

type OverallHealth = 'green' | 'yellow' | 'red' | 'grey'

interface RunningJob {
  module: string
  started_at: string
  triggered_by: string
}

interface ModuleStatusRow {
  module: string
  status: string
  last_success_at: string | null
  last_run_at: string | null
  last_error: string | null
}

export interface RefreshStatusResponse {
  overall: OverallHealth
  modules: ModuleStatusRow[]
  running: RunningJob[]
  last_updated: string | null
}

type LoadState = 'loading' | 'error' | 'no-session' | 'ready'

const SGT = 'Asia/Singapore'

/** "Today, 12:08 AM SGT" / "Yesterday, 12:08 PM SGT" / "6 Jul 2026, 12:08 AM SGT" */
export function formatSgtLastUpdated(iso: string): string {
  const d = new Date(iso)
  const now = new Date()

  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dISO = dayFmt.format(d)
  const nowISO = dayFmt.format(now)
  const yesterday = new Date(now.getTime() - 86_400_000)
  const yesterdayISO = dayFmt.format(yesterday)

  const timeStr = d.toLocaleTimeString('en-SG', {
    timeZone: SGT, hour: 'numeric', minute: '2-digit', hour12: true,
  })

  if (dISO === nowISO) return `Today, ${timeStr} SGT`
  if (dISO === yesterdayISO) return `Yesterday, ${timeStr} SGT`

  const dateStr = d.toLocaleDateString('en-SG', {
    timeZone: SGT, day: 'numeric', month: 'short', year: 'numeric',
  })
  return `${dateStr}, ${timeStr} SGT`
}

export function freshnessColor(lastUpdated: string | null, overall: OverallHealth): {
  dot: string
  ping: string
} {
  if (overall === 'red') return { dot: 'bg-red-500', ping: 'bg-red-400' }
  if (!lastUpdated) return { dot: 'bg-slate-600', ping: 'bg-slate-500' }
  const ageMs = Date.now() - new Date(lastUpdated).getTime()
  const hrs = ageMs / (60 * 60 * 1000)
  if (hrs < 24) return { dot: 'bg-emerald-500', ping: 'bg-emerald-400' }
  if (hrs < 48) return { dot: 'bg-yellow-500', ping: 'bg-yellow-400' }
  return { dot: 'bg-red-500', ping: 'bg-red-400' }
}

/** Shared fetch hook so header LastUpdated and LiveDataIndicator read one source. */
export function useRefreshStatus(pollMs = 60_000) {
  const [state, setState] = useState<LoadState>('loading')
  const [data, setData] = useState<RefreshStatusResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/refresh/status')
        if (cancelled) return
        if (res.status === 401 || res.status === 403) {
          setState('no-session')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        const json = (await res.json()) as RefreshStatusResponse
        setData(json)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }

    load()
    const interval = setInterval(load, pollMs)
    return () => { cancelled = true; clearInterval(interval) }
  }, [pollMs])

  return { state, data }
}

export function LastUpdated() {
  const { state, data } = useRefreshStatus()

  const running = state === 'ready' ? (data?.running ?? []) : []
  const isRunning = running.length > 0

  if (state === 'loading') {
    return (
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500">
        <RefreshCw className="h-3 w-3 animate-spin" />
        Checking freshness…
      </span>
    )
  }

  if (state === 'error' || state === 'no-session') {
    return (
      <span className="hidden sm:flex items-center gap-1.5 text-xs text-slate-600">
        <RefreshCw className="h-3 w-3" />
        No refresh data yet
      </span>
    )
  }

  const lastUpdated = data?.last_updated ?? null
  const overall = data?.overall ?? 'grey'
  const { dot } = freshnessColor(lastUpdated, overall)
  const label = lastUpdated ? `Last updated: ${formatSgtLastUpdated(lastUpdated)}` : 'No refresh data yet'

  return (
    <div className="hidden sm:flex items-center gap-2">
      {isRunning ? (
        <span className="flex items-center gap-1.5 text-xs text-blue-400 bg-blue-500/10 border border-blue-500/30 rounded-full px-2 py-0.5">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-400" />
          </span>
          Refreshing…
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-xs text-slate-500">
          <span className={`inline-flex h-1.5 w-1.5 rounded-full ${dot}`} />
          {label}
        </span>
      )}
    </div>
  )
}
