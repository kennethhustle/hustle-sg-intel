'use client'

/**
 * Data Sources table — client component for /settings/data-sources.
 * Reads the initial SourceWithRuntime[] from the server page, then supports
 * filtering, row expansion, and admin actions (test / refresh / enable-disable
 * / mark verified) that call the backend contract routes.
 */
import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ChevronDown, ChevronUp, Loader2, PlayCircle, RefreshCw, Power, ShieldCheck, ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { DataSourceRow, SourceStatus, SourceWithRuntime } from '@/lib/services/data-sources'

// ─── Static option lists ──────────────────────────────────────────────────

const MODULE_LABELS: Record<string, string> = {
  course_intelligence: 'Course Intelligence',
  marketing_intelligence: 'Marketing Intelligence',
  hiring_intelligence: 'Hiring Intelligence',
  social_intelligence: 'Social Intelligence',
  seo_intelligence: 'SEO Intelligence',
  opportunity_engine: 'Opportunity Engine',
  alerts: 'Alerts',
  platform: 'Platform',
}

const SOURCE_TYPE_LABELS: Record<DataSourceRow['source_type'], string> = {
  api: 'API',
  scraper: 'Scraper',
  manual: 'Manual',
  static_snapshot: 'Static Snapshot',
  ai_generated: 'AI Generated',
  database: 'Database',
}

const STATUS_CONFIG: Record<SourceStatus, { label: string; cls: string; dot: string }> = {
  working:        { label: 'Working',        cls: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50', dot: 'bg-emerald-400' },
  connected:      { label: 'Configured',     cls: 'bg-teal-950/50 text-teal-400 border-teal-800/50',          dot: 'bg-teal-400' },
  partial:        { label: 'Partial',        cls: 'bg-amber-950/50 text-amber-400 border-amber-800/50',       dot: 'bg-amber-400' },
  manual_only:    { label: 'Manual only',    cls: 'bg-amber-950/50 text-amber-400 border-amber-800/50',       dot: 'bg-amber-400' },
  static_only:    { label: 'Static only',    cls: 'bg-amber-950/50 text-amber-400 border-amber-800/50',       dot: 'bg-amber-400' },
  failed:         { label: 'Failed',         cls: 'bg-red-950/50 text-red-400 border-red-800/50',             dot: 'bg-red-400' },
  unavailable:    { label: 'Unavailable',    cls: 'bg-red-950/30 text-red-500/80 border-red-900/40',          dot: 'bg-red-600' },
  not_configured: { label: 'Not configured', cls: 'bg-slate-800 text-slate-500 border-slate-700',             dot: 'bg-slate-500' },
}

const RELIABILITY_CONFIG: Record<DataSourceRow['reliability_level'], { label: string; cls: string }> = {
  high:   { label: 'H', cls: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/50' },
  medium: { label: 'M', cls: 'bg-amber-950/50 text-amber-400 border-amber-800/50' },
  low:    { label: 'L', cls: 'bg-red-950/50 text-red-400 border-red-800/50' },
}

// Maps a source_key to the refresh module used by POST /api/refresh/module.
// Sources without an entry here have no automated refresh (manual/static/db).
const REFRESH_MODULE_MAP: Record<string, string> = {
  myskillsfuture_api: 'sf_courses',
  mysf_run_scraper: 'runcounts',
  meta_ad_library: 'marketing',
  google_places: 'marketing',
  google_ads_transparency: 'marketing',
  mycareersfuture_api: 'hiring',
  jobstreet_scraper: 'hiring',
  indeed_scraper: 'hiring',
  career_page_scraper: 'hiring',
  youtube_data_api: 'social',
  instagram_scraper: 'social',
  facebook_scraper: 'social',
  linkedin_scraper: 'social',
  tiktok_scraper: 'social',
  company_courses_scraper: 'course_catalog',
  claude_api: 'ai_insights',
}

function refreshModuleFor(source: SourceWithRuntime): string | null {
  if (REFRESH_MODULE_MAP[source.source_key]) return REFRESH_MODULE_MAP[source.source_key]
  if (source.source_type === 'manual' || source.source_type === 'static_snapshot' || source.source_type === 'database') return null
  // Fallback heuristics by module for sources not explicitly mapped
  switch (source.module) {
    case 'course_intelligence': return 'sf_courses'
    case 'marketing_intelligence': return 'marketing'
    case 'hiring_intelligence': return 'hiring'
    case 'social_intelligence': return 'social'
    case 'opportunity_engine': return 'ai_insights'
    default: return null
  }
}

const SGT = 'Asia/Singapore'

function fmtSgt(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: SGT, day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
  }) + ' SGT'
}

function relativeAge(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

// ─── Filters ────────────────────────────────────────────────────────────────

interface Filters {
  module: string
  status: string
  source_type: string
  provider: string
  reliability: string
  enabled: string
}

const EMPTY_FILTERS: Filters = { module: '', status: '', source_type: '', provider: '', reliability: '', enabled: '' }

// ─── Test connection result ─────────────────────────────────────────────────

interface TestResult {
  ok: boolean
  status: SourceStatus
  response_time_ms: number | null
  message: string
  key_configured: boolean | null
}

// ─── Admin action helpers ───────────────────────────────────────────────────

async function testSource(sourceKey: string): Promise<{ ok: true; data: TestResult } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/data-sources/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_key: sourceKey }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { ok: false, message: body.error ?? `Request failed (HTTP ${res.status})` }
    }
    const data = (await res.json()) as TestResult
    return { ok: true, data }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' }
  }
}

async function patchSource(body: Record<string, unknown>): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/data-sources', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, message: err.error ?? `Request failed (HTTP ${res.status})` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' }
  }
}

async function refreshModule(module: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await fetch('/api/refresh/module', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ module }),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      return { ok: false, message: err.error ?? `Request failed (HTTP ${res.status})` }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Network error' }
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function DataSourcesTable({ initialSources, isAdmin }: { initialSources: SourceWithRuntime[]; isAdmin: boolean }) {
  const [sources, setSources] = useState<SourceWithRuntime[]>(initialSources)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [testResults, setTestResults] = useState<Record<string, TestResult>>({})
  const [actionMessage, setActionMessage] = useState<Record<string, string>>({})

  const moduleOptions = useMemo(() => Array.from(new Set(sources.map((s) => s.module))).sort(), [sources])
  const providerOptions = useMemo(
    () => Array.from(new Set(sources.map((s) => s.provider).filter((p): p is string => Boolean(p)))).sort(),
    [sources]
  )

  const filtered = sources.filter((s) => {
    if (filters.module && s.module !== filters.module) return false
    if (filters.status && s.status !== filters.status) return false
    if (filters.source_type && s.source_type !== filters.source_type) return false
    if (filters.provider && s.provider !== filters.provider) return false
    if (filters.reliability && s.reliability_level !== filters.reliability) return false
    if (filters.enabled === 'enabled' && !s.is_enabled) return false
    if (filters.enabled === 'disabled' && s.is_enabled) return false
    return true
  })

  const summary = useMemo(() => {
    const working = sources.filter((s) => s.status === 'working' || s.status === 'connected').length
    const partial = sources.filter((s) => s.status === 'partial').length
    const unavailable = sources.filter((s) => s.status === 'failed' || s.status === 'unavailable').length
    const manual = sources.filter((s) => s.status === 'manual_only' || s.status === 'static_only').length
    const notConfigured = sources.filter((s) => s.status === 'not_configured').length
    return { working, partial, unavailable, manual, notConfigured }
  }, [sources])

  function updateSourceLocal(sourceKey: string, patch: Partial<SourceWithRuntime>) {
    setSources((prev) => prev.map((s) => (s.source_key === sourceKey ? { ...s, ...patch } : s)))
  }

  async function handleTest(sourceKey: string) {
    setBusyKey(`test:${sourceKey}`)
    setActionMessage((m) => ({ ...m, [sourceKey]: '' }))
    const res = await testSource(sourceKey)
    setBusyKey(null)
    if (!res.ok) {
      setActionMessage((m) => ({ ...m, [sourceKey]: res.message }))
      return
    }
    setTestResults((r) => ({ ...r, [sourceKey]: res.data }))
    updateSourceLocal(sourceKey, {
      status: res.data.status,
      last_response_time_ms: res.data.response_time_ms,
      last_checked_at: new Date().toISOString(),
      key_configured: res.data.key_configured,
    })
  }

  async function handleToggleEnabled(source: SourceWithRuntime) {
    setBusyKey(`toggle:${source.source_key}`)
    const res = await patchSource({ source_key: source.source_key, is_enabled: !source.is_enabled })
    setBusyKey(null)
    if (!res.ok) {
      setActionMessage((m) => ({ ...m, [source.source_key]: res.message }))
      return
    }
    updateSourceLocal(source.source_key, { is_enabled: !source.is_enabled })
  }

  async function handleVerify(source: SourceWithRuntime) {
    setBusyKey(`verify:${source.source_key}`)
    const res = await patchSource({ source_key: source.source_key, verified: true })
    setBusyKey(null)
    if (!res.ok) {
      setActionMessage((m) => ({ ...m, [source.source_key]: res.message }))
      return
    }
    updateSourceLocal(source.source_key, { last_success_at: new Date().toISOString(), is_stale: false })
  }

  async function handleRefresh(source: SourceWithRuntime) {
    const mod = refreshModuleFor(source)
    if (!mod) return
    setBusyKey(`refresh:${source.source_key}`)
    const res = await refreshModule(mod)
    setBusyKey(null)
    if (!res.ok) {
      setActionMessage((m) => ({ ...m, [source.source_key]: res.message }))
      return
    }
    setActionMessage((m) => ({ ...m, [source.source_key]: 'Refresh triggered — statuses will update shortly.' }))
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400 bg-slate-900/60 border border-slate-800 rounded-lg px-3 py-2">
        <span className="text-emerald-400 font-medium">{summary.working} working</span>
        <span className="text-slate-700">·</span>
        <span className="text-amber-400 font-medium">{summary.partial} partial</span>
        <span className="text-slate-700">·</span>
        <span className="text-red-400 font-medium">{summary.unavailable} unavailable</span>
        <span className="text-slate-700">·</span>
        <span className="text-amber-400 font-medium">{summary.manual} manual</span>
        <span className="text-slate-700">·</span>
        <span className="text-slate-500 font-medium">{summary.notConfigured} not configured</span>
      </div>

      {!isAdmin && (
        <p className="text-xs text-amber-400 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2">
          You are viewing in read-only mode. Admin permissions are required to test, refresh, enable/disable, or verify sources.
        </p>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <FilterSelect
          label="Module"
          value={filters.module}
          onChange={(v) => setFilters((f) => ({ ...f, module: v }))}
          options={[{ value: '', label: 'All modules' }, ...moduleOptions.map((m) => ({ value: m, label: MODULE_LABELS[m] ?? m }))]}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(v) => setFilters((f) => ({ ...f, status: v }))}
          options={[{ value: '', label: 'All statuses' }, ...Object.entries(STATUS_CONFIG).map(([k, v]) => ({ value: k, label: v.label }))]}
        />
        <FilterSelect
          label="Source type"
          value={filters.source_type}
          onChange={(v) => setFilters((f) => ({ ...f, source_type: v }))}
          options={[{ value: '', label: 'All types' }, ...Object.entries(SOURCE_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))]}
        />
        <FilterSelect
          label="Provider"
          value={filters.provider}
          onChange={(v) => setFilters((f) => ({ ...f, provider: v }))}
          options={[{ value: '', label: 'All providers' }, ...providerOptions.map((p) => ({ value: p, label: p }))]}
        />
        <FilterSelect
          label="Reliability"
          value={filters.reliability}
          onChange={(v) => setFilters((f) => ({ ...f, reliability: v }))}
          options={[{ value: '', label: 'All levels' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' }]}
        />
        <FilterSelect
          label="Enabled"
          value={filters.enabled}
          onChange={(v) => setFilters((f) => ({ ...f, enabled: v }))}
          options={[{ value: '', label: 'All' }, { value: 'enabled', label: 'Enabled' }, { value: 'disabled', label: 'Disabled' }]}
        />
        {(filters.module || filters.status || filters.source_type || filters.provider || filters.reliability || filters.enabled) && (
          <button
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1.5"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                {['', 'Source', 'Module', 'Status', 'Reliability', 'Last success', 'Records', 'Response', 'API key', 'Error'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={10} className="px-4 py-8 text-center text-slate-600">No sources match the current filters.</td></tr>
              )}
              {filtered.map((s) => {
                const expanded = expandedKey === s.source_key
                const statusCfg = STATUS_CONFIG[s.status]
                const relCfg = RELIABILITY_CONFIG[s.reliability_level]
                const testResult = testResults[s.source_key]
                const message = actionMessage[s.source_key]
                const refreshMod = refreshModuleFor(s)
                const isManualType = s.source_type === 'manual' || s.source_type === 'static_snapshot'

                return (
                  <Fragment key={s.source_key}>
                    <tr
                      onClick={() => setExpandedKey(expanded ? null : s.source_key)}
                      className={cn(
                        'border-b border-slate-800/40 hover:bg-slate-800/20 cursor-pointer transition-colors',
                        !s.is_enabled && 'opacity-50'
                      )}
                    >
                      <td className="px-3 py-2.5 text-slate-600 w-4">
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </td>
                      <td className="px-3 py-2.5 min-w-[180px]">
                        <p className="text-slate-200 font-medium">{s.source_name}</p>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {s.provider && <span className="text-[10px] text-slate-500">{s.provider}</span>}
                          <span className="text-[9px] px-1 py-0.5 rounded border border-slate-700 bg-slate-800 text-slate-400">
                            {SOURCE_TYPE_LABELS[s.source_type]}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">{MODULE_LABELS[s.module] ?? s.module}</td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-medium whitespace-nowrap', statusCfg.cls)}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', statusCfg.dot)} />
                          {statusCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={cn('inline-flex items-center justify-center w-5 h-5 rounded border text-[10px] font-bold', relCfg.cls)}>
                          {relCfg.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                        {s.last_success_at ? (
                          <span title={fmtSgt(s.last_success_at)}>{relativeAge(s.last_success_at)}</span>
                        ) : (
                          <span className="text-slate-600">never</span>
                        )}
                        {s.is_stale && <span className="ml-1 text-amber-500" title="Stale">⚠</span>}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 font-mono whitespace-nowrap">
                        {s.records_fetched_last_run != null || s.records_updated_last_run != null
                          ? `${s.records_fetched_last_run ?? '—'} / ${s.records_updated_last_run ?? '—'}`
                          : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 whitespace-nowrap">
                        {s.last_response_time_ms != null ? `${s.last_response_time_ms}ms` : '—'}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {s.key_configured === null ? (
                          <span className="text-slate-600">—</span>
                        ) : s.key_configured ? (
                          <span className="text-emerald-400" title={s.api_key_env_name ?? undefined}>✓ {s.api_key_env_name}</span>
                        ) : (
                          <span className="text-red-400" title={s.api_key_env_name ?? undefined}>✗ {s.api_key_env_name}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 max-w-[200px] truncate text-red-400" title={s.error_message ?? undefined}>
                        {s.error_message ?? '—'}
                      </td>
                    </tr>

                    {expanded && (
                      <tr className="bg-slate-900/60 border-b border-slate-800/40">
                        <td colSpan={10} className="px-4 py-4">
                          <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                            <div className="space-y-1.5">
                              <p><span className="text-slate-500">Endpoint / URL:</span>{' '}
                                {s.endpoint_or_url ? (
                                  <a href={s.endpoint_or_url} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 inline-flex items-center gap-1">
                                    {s.endpoint_or_url} <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                ) : <span className="text-slate-600">—</span>}
                              </p>
                              <p><span className="text-slate-500">Last failed:</span> <span className="text-slate-300">{fmtSgt(s.last_failed_at)}</span></p>
                              <p><span className="text-slate-500">Last checked:</span> <span className="text-slate-300">{fmtSgt(s.last_checked_at)}</span></p>
                              {s.is_stale && (
                                <p className="text-amber-400">
                                  Data stale — older than {s.stale_after_hours ?? '?'} hours
                                </p>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              <p className="text-slate-500">Notes:</p>
                              <p className="text-slate-300 leading-relaxed">{s.notes ?? '—'}</p>
                            </div>
                          </div>

                          {s.error_message && (
                            <div className="mb-4 p-2.5 rounded-lg bg-red-950/30 border border-red-900/40 text-red-300 text-xs break-words">
                              {s.error_message}
                            </div>
                          )}

                          {testResult && (
                            <div className={cn(
                              'mb-4 p-2.5 rounded-lg border text-xs',
                              testResult.ok ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-300' : 'bg-red-950/30 border-red-900/40 text-red-300'
                            )}>
                              Test result: {testResult.status} {testResult.response_time_ms != null && `· ${testResult.response_time_ms}ms`} — {testResult.message}
                            </div>
                          )}

                          {message && (
                            <div className="mb-4 p-2.5 rounded-lg bg-slate-800/60 border border-slate-700 text-slate-300 text-xs">
                              {message}
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <ActionButton
                              icon={busyKey === `test:${s.source_key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                              label="Test connection"
                              disabled={!isAdmin || busyKey !== null}
                              tooltip={!isAdmin ? 'Admin only' : undefined}
                              onClick={() => handleTest(s.source_key)}
                            />
                            {refreshMod && (
                              <ActionButton
                                icon={busyKey === `refresh:${s.source_key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                label="Refresh source"
                                disabled={!isAdmin || busyKey !== null}
                                tooltip={!isAdmin ? 'Admin only' : undefined}
                                onClick={() => handleRefresh(s)}
                              />
                            )}
                            <ActionButton
                              icon={busyKey === `toggle:${s.source_key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Power className="h-3 w-3" />}
                              label={s.is_enabled ? 'Disable source' : 'Enable source'}
                              disabled={!isAdmin || busyKey !== null}
                              tooltip={!isAdmin ? 'Admin only' : undefined}
                              onClick={() => handleToggleEnabled(s)}
                            />
                            {isManualType && (
                              <ActionButton
                                icon={busyKey === `verify:${s.source_key}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
                                label="Mark manual data as verified"
                                disabled={!isAdmin || busyKey !== null}
                                tooltip={!isAdmin ? 'Admin only' : undefined}
                                onClick={() => handleVerify(s)}
                              />
                            )}
                            <Link
                              href="/settings#refresh-logs-panel"
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-medium rounded-lg border border-slate-700 transition-colors"
                            >
                              View logs
                            </Link>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ─── Small shared bits ──────────────────────────────────────────────────────

function FilterSelect({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

function ActionButton({
  icon, label, disabled, tooltip, onClick,
}: {
  icon: React.ReactNode
  label: string
  disabled: boolean
  tooltip?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={tooltip}
      className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium rounded-lg border transition-colors',
        disabled
          ? 'bg-slate-800/40 text-slate-600 border-slate-800 cursor-not-allowed'
          : 'bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-400 border-indigo-700/40'
      )}
    >
      {icon}
      {label}
    </button>
  )
}
