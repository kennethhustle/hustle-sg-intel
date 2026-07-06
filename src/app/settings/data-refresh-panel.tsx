'use client'

/**
 * Manual Intelligence Refresh — settings panel.
 *
 * Orchestrates the 8 refresh modules SEQUENTIALLY on the client (one POST per
 * module) rather than a single server-side "refresh everything" call, to stay
 * under Vercel's per-request timeout. Continues to the next module even if one
 * fails or partially fails (partial-success philosophy) — the UI ends up
 * telling the whole story either way.
 */
import { useState, useCallback } from 'react'
import {
  RefreshCw, CheckCircle2, XCircle, AlertTriangle, Loader2, Circle, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { UserRole } from '@/lib/types'

// ─── Module contract (mirrors backend) ─────────────────────────────────────

type ModuleKey =
  | 'sf_courses' | 'runcounts' | 'marketing' | 'hiring'
  | 'social' | 'course_catalog' | 'alerts' | 'ai_insights'

interface ModuleDef {
  key: ModuleKey
  label: string
}

const FULL_REFRESH_ORDER: ModuleDef[] = [
  { key: 'sf_courses', label: 'Course Catalog' },
  { key: 'runcounts', label: 'Course Run Counts' },
  { key: 'marketing', label: 'Marketing' },
  { key: 'hiring', label: 'Hiring' },
  { key: 'social', label: 'Social' },
  { key: 'course_catalog', label: 'Website Catalogs' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'ai_insights', label: 'AI Insights' },
]

interface ModuleCounts {
  fetched?: number
  inserted?: number
  updated?: number
  failed?: number
}

interface ModuleApiResult {
  module: string
  status: 'success' | 'partial' | 'failed'
  started_at: string
  completed_at: string
  duration_seconds: number
  counts: ModuleCounts
  error?: string
}

type StepState = 'pending' | 'running' | 'success' | 'partial' | 'failed'

interface StepResult {
  key: ModuleKey
  label: string
  state: StepState
  duration_seconds?: number
  counts?: ModuleCounts
  error?: string
}

type RunPhase = 'idle' | 'running' | 'done' | 'blocked'

// ─── Helpers ────────────────────────────────────────────────────────────────

const SGT = 'Asia/Singapore'

function fmtSgt(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: SGT, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  }) + ' SGT'
}

function countsSummary(counts?: ModuleCounts): string {
  if (!counts) return ''
  const parts: string[] = []
  if (counts.fetched !== undefined) parts.push(`${counts.fetched} fetched`)
  if (counts.inserted !== undefined) parts.push(`${counts.inserted} inserted`)
  if (counts.updated !== undefined) parts.push(`${counts.updated} updated`)
  if (counts.failed !== undefined && counts.failed > 0) parts.push(`${counts.failed} failed`)
  return parts.join(' · ')
}

async function postModule(module: ModuleKey): Promise<
  | { ok: true; data: ModuleApiResult }
  | { ok: false; alreadyRunning: true; message: string }
  | { ok: false; alreadyRunning: false; message: string }
> {
  try {
    const res = await fetch('/api/refresh/module', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module }),
    })
    if (res.status === 409) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, alreadyRunning: true, message: body.message ?? 'A refresh is already running.' }
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, alreadyRunning: false, message: 'You do not have permission to trigger refreshes.' }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, alreadyRunning: false, message: body.error ?? `Request failed (HTTP ${res.status})` }
    }
    const data = (await res.json()) as ModuleApiResult
    return { ok: true, data }
  } catch (e) {
    return { ok: false, alreadyRunning: false, message: e instanceof Error ? e.message : 'Network error' }
  }
}

// ─── Step row ───────────────────────────────────────────────────────────────

function StepIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'pending': return <Circle className="h-4 w-4 text-slate-700" />
    case 'running': return <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
    case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-400" />
    case 'partial': return <AlertTriangle className="h-4 w-4 text-amber-400" />
    case 'failed': return <XCircle className="h-4 w-4 text-red-400" />
  }
}

function StepRow({ step }: { step: StepResult }) {
  return (
    <div className="flex items-start gap-3 py-2 px-3 rounded-lg bg-slate-800/40 border border-slate-800">
      <div className="mt-0.5 shrink-0"><StepIcon state={step.state} /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-white font-medium">{step.label}</span>
          {step.state === 'running' && <span className="text-xs text-blue-400">Refreshing…</span>}
          {step.duration_seconds !== undefined && (
            <span className="text-xs text-slate-500">{step.duration_seconds.toFixed(1)}s</span>
          )}
        </div>
        {step.counts && countsSummary(step.counts) && (
          <p className="text-xs text-slate-500 mt-0.5">{countsSummary(step.counts)}</p>
        )}
        {step.error && (
          <p className="text-xs text-red-400 mt-0.5 break-words">{step.error}</p>
        )}
      </div>
    </div>
  )
}

// ─── Run summary card ───────────────────────────────────────────────────────

interface RunSummary {
  outcome: 'success' | 'partial' | 'failed'
  startedAt: string
  completedAt: string
  totalDuration: number
  steps: StepResult[]
}

function SummaryCard({ summary, onViewLogs }: { summary: RunSummary; onViewLogs: () => void }) {
  const cfg = {
    success: { label: 'Success', cls: 'text-emerald-400 border-emerald-800/50 bg-emerald-950/20', Icon: CheckCircle2 },
    partial: { label: 'Partial success — some sources failed', cls: 'text-amber-400 border-amber-800/50 bg-amber-950/20', Icon: AlertTriangle },
    failed: { label: 'Failed', cls: 'text-red-400 border-red-800/50 bg-red-950/20', Icon: XCircle },
  }[summary.outcome]

  const failedModules = summary.steps.filter((s) => s.state === 'failed')

  return (
    <div className={cn('rounded-xl border p-4 space-y-3', cfg.cls)}>
      <div className="flex items-center gap-2">
        <cfg.Icon className="h-4 w-4" />
        <p className="text-sm font-semibold">{cfg.label}</p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-xs">
        <div>
          <p className="text-slate-500">Started</p>
          <p className="text-slate-200">{fmtSgt(summary.startedAt)}</p>
        </div>
        <div>
          <p className="text-slate-500">Completed</p>
          <p className="text-slate-200">{fmtSgt(summary.completedAt)}</p>
        </div>
        <div>
          <p className="text-slate-500">Total duration</p>
          <p className="text-slate-200">{summary.totalDuration.toFixed(1)}s</p>
        </div>
      </div>
      {failedModules.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Failed modules</p>
          <div className="flex flex-wrap gap-1.5">
            {failedModules.map((m) => (
              <span key={m.key} className="text-[10px] px-1.5 py-0.5 rounded border border-red-800/50 bg-red-950/30 text-red-400">
                {m.label}
              </span>
            ))}
          </div>
        </div>
      )}
      <button
        onClick={onViewLogs}
        className="inline-flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        View refresh logs <ExternalLink className="h-3 w-3" />
      </button>
    </div>
  )
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export function DataRefreshPanel({ role }: { role: UserRole }) {
  const isAdmin = role === 'admin'
  const isViewer = role === 'viewer'
  const canTriggerAny = isAdmin || role === 'analyst'

  const [phase, setPhase] = useState<RunPhase>('idle')
  const [steps, setSteps] = useState<StepResult[]>([])
  const [summary, setSummary] = useState<RunSummary | null>(null)
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null)
  const [busyGroup, setBusyGroup] = useState<string | null>(null)

  const scrollToLogs = useCallback(() => {
    document.getElementById('refresh-logs-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [])

  const runModules = useCallback(async (modules: ModuleDef[], groupId: string) => {
    setBlockedMessage(null)
    setBusyGroup(groupId)
    setSummary(null)
    setSteps(modules.map((m) => ({ key: m.key, label: m.label, state: 'pending' })))
    setPhase('running')

    const startedAt = new Date().toISOString()
    const results: StepResult[] = []

    for (const mod of modules) {
      setSteps((prev) => prev.map((s) => (s.key === mod.key ? { ...s, state: 'running' } : s)))

      const res = await postModule(mod.key)

      if (!res.ok && res.alreadyRunning) {
        setBlockedMessage('A full intelligence refresh is already running. Please wait for it to complete before starting another one.')
        setSteps((prev) => prev.map((s) => (s.key === mod.key ? { ...s, state: 'failed', error: res.message } : s)))
        setPhase('blocked')
        setBusyGroup(null)
        return
      }

      if (!res.ok) {
        const failedStep: StepResult = { key: mod.key, label: mod.label, state: 'failed', error: res.message }
        results.push(failedStep)
        setSteps((prev) => prev.map((s) => (s.key === mod.key ? failedStep : s)))
        continue // partial-success philosophy: keep going
      }

      const stepResult: StepResult = {
        key: mod.key,
        label: mod.label,
        state: res.data.status,
        duration_seconds: res.data.duration_seconds,
        counts: res.data.counts,
        error: res.data.error,
      }
      results.push(stepResult)
      setSteps((prev) => prev.map((s) => (s.key === mod.key ? stepResult : s)))
    }

    const completedAt = new Date().toISOString()
    const totalDuration = (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000
    const hasFailed = results.some((r) => r.state === 'failed')
    const hasPartial = results.some((r) => r.state === 'partial')
    const outcome: RunSummary['outcome'] = hasFailed && results.every((r) => r.state === 'failed')
      ? 'failed'
      : (hasFailed || hasPartial) ? 'partial' : 'success'

    setSummary({ outcome, startedAt, completedAt, totalDuration, steps: results })
    setPhase('done')
    setBusyGroup(null)
  }, [])

  const isRunning = phase === 'running'

  const secondaryGroups: { id: string; label: string; modules: ModuleDef[] }[] = [
    { id: 'course', label: 'Refresh Course Intelligence Only', modules: FULL_REFRESH_ORDER.filter((m) => m.key === 'sf_courses' || m.key === 'runcounts') },
    { id: 'marketing', label: 'Refresh Marketing / Ads Intelligence Only', modules: FULL_REFRESH_ORDER.filter((m) => m.key === 'marketing') },
    { id: 'hiring', label: 'Refresh Hiring Intelligence Only', modules: FULL_REFRESH_ORDER.filter((m) => m.key === 'hiring') },
    { id: 'social', label: 'Refresh Social Intelligence Only', modules: FULL_REFRESH_ORDER.filter((m) => m.key === 'social') },
    { id: 'ai', label: 'Regenerate AI Insights Only', modules: FULL_REFRESH_ORDER.filter((m) => m.key === 'ai_insights') },
  ]

  return (
    <section className="bg-slate-900/60 border border-indigo-800/30 rounded-xl p-5">
      <div className="flex items-center gap-2 mb-1">
        <RefreshCw className="h-4 w-4 text-indigo-400" />
        <h2 className="text-sm font-semibold text-white">Manual Intelligence Refresh</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4 max-w-2xl">
        Trigger a full refresh of competitor intelligence data across all enabled sources. This may take a few minutes
        depending on the data sources.
      </p>

      {isViewer && (
        <p className="text-xs text-amber-400 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2 mb-4">
          Only admins and analysts can trigger refreshes.
        </p>
      )}

      {/* Primary button — admin only */}
      <div className="mb-5">
        <button
          disabled={!isAdmin || isRunning}
          onClick={() => runModules(FULL_REFRESH_ORDER, 'full')}
          title={!isAdmin ? 'Only admins can run a full refresh.' : undefined}
          className={cn(
            'inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors',
            isAdmin
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
          )}
        >
          {isRunning && busyGroup === 'full' ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Running full refresh…</>
          ) : (
            <><RefreshCw className="h-4 w-4" /> Run Full Refresh Now</>
          )}
        </button>
        {!isAdmin && (
          <p className="text-xs text-slate-600 mt-1.5">
            Only admins can trigger a full refresh across all sources.
          </p>
        )}
      </div>

      {blockedMessage && (
        <div className="flex items-start gap-2 text-xs text-amber-400 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{blockedMessage}</span>
        </div>
      )}

      {/* Step list — shown while running or after completion for the active run */}
      {steps.length > 0 && (
        <div className="space-y-1.5 mb-4">
          {steps.map((s) => <StepRow key={s.key} step={s} />)}
        </div>
      )}

      {/* Summary card */}
      {summary && phase === 'done' && (
        <div className="mb-5">
          <SummaryCard summary={summary} onViewLogs={scrollToLogs} />
        </div>
      )}

      {/* Secondary per-module buttons */}
      <div className="border-t border-slate-800 pt-4">
        <p className="text-xs font-medium text-slate-400 mb-2.5">Refresh a single source</p>
        <div className="flex flex-wrap gap-2">
          {secondaryGroups.map((g) => (
            <button
              key={g.id}
              disabled={!canTriggerAny || isRunning}
              onClick={() => runModules(g.modules, g.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
            >
              {isRunning && busyGroup === g.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              {g.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-600 mt-3">
          SEO Intelligence uses a manual snapshot — no automated refresh available.
        </p>
      </div>
    </section>
  )
}
