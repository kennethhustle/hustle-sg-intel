'use client'

/**
 * LiveDataIndicator — replaces the old always-green "Live Data Feed" dot in
 * the sidebar with a real status computed from data_refresh_logs via
 * /api/refresh-health (server-side getRefreshHealth()).
 */
import { useEffect, useState } from 'react'

type OverallHealth = 'green' | 'yellow' | 'red' | 'grey'

interface ModuleHealth {
  module: string
  status: 'success' | 'partial' | 'failed' | 'running' | 'stale' | 'none'
  last_success_at: string | null
  last_run_at: string | null
  last_error: string | null
}

interface HealthResponse {
  overall: OverallHealth
  modules: ModuleHealth[]
}

type LoadState = 'loading' | 'error' | 'no-session' | 'ready'

const CONFIG: Record<OverallHealth, { dot: string; ping: string; label: string; text: string }> = {
  green:  { dot: 'bg-emerald-500', ping: 'bg-emerald-400', label: 'Data healthy',      text: 'text-emerald-600' },
  yellow: { dot: 'bg-yellow-500',  ping: 'bg-yellow-400',  label: 'Some data stale',   text: 'text-yellow-600' },
  red:    { dot: 'bg-red-500',     ping: 'bg-red-400',     label: 'Refresh failure',   text: 'text-red-500'   },
  grey:   { dot: 'bg-slate-600',   ping: 'bg-slate-500',   label: 'No refresh data',   text: 'text-slate-500' },
}

function buildTooltip(modules: ModuleHealth[]): string {
  return modules
    .map(m => {
      const lastSuccess = m.last_success_at
        ? new Date(m.last_success_at).toLocaleString('en-SG', { timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
        : 'never'
      return `${m.module}: ${m.status} (last success: ${lastSuccess} SGT)`
    })
    .join('\n')
}

export function LiveDataIndicator() {
  const [state, setState] = useState<LoadState>('loading')
  const [health, setHealth] = useState<HealthResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/refresh-health')
        if (cancelled) return
        if (res.status === 401) {
          setState('no-session')
          return
        }
        if (!res.ok) {
          setState('error')
          return
        }
        const json = (await res.json()) as HealthResponse
        setHealth(json)
        setState('ready')
      } catch {
        if (!cancelled) setState('error')
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  const overall: OverallHealth = state === 'ready' && health ? health.overall : 'grey'
  const cfg = CONFIG[overall]
  const label =
    state === 'loading' ? 'Checking data health…' :
    state === 'error' ? 'Unable to check data health' :
    state === 'no-session' ? 'No refresh data' :
    cfg.label

  const tooltip = state === 'ready' && health ? buildTooltip(health.modules) : label
  const showPulse = state === 'ready' && overall === 'green'

  return (
    <div className="mt-3 flex items-center gap-2" title={tooltip}>
      <span className="relative flex h-2 w-2">
        {showPulse && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${cfg.ping} opacity-50`} />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${state === 'ready' ? cfg.dot : 'bg-slate-600'}`} />
      </span>
      <span className={`text-[10px] font-mono tracking-wider uppercase ${state === 'ready' ? cfg.text : 'text-slate-600'}`}>
        {label}
      </span>
    </div>
  )
}
