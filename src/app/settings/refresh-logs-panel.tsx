'use client'

/**
 * Data Refresh Logs — settings panel below the Manual Intelligence Refresh
 * section. Reads GET /api/refresh/logs with filters + pagination.
 */
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ListFilter, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ──────────────────────────────────────────────────────────────────

type LogStatus = 'success' | 'partial' | 'failed' | 'running'

interface LogRow {
  id: string
  module: string
  source: string
  started_at: string
  completed_at: string | null
  status: LogStatus
  duration_seconds: number | null
  records_fetched: number | null
  records_inserted: number | null
  records_updated: number | null
  records_failed: number | null
  error_message: string | null
  triggered_by: string
  competitor_id: string | null
  metadata: Record<string, unknown> | null
}

interface LogsResponse {
  data: LogRow[]
  count: number
}

const PAGE_SIZE = 50

const MODULE_OPTIONS = [
  { value: '', label: 'All modules' },
  { value: 'sf_courses', label: 'Course Catalog' },
  { value: 'runcounts', label: 'Course Run Counts' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'hiring', label: 'Hiring' },
  { value: 'social', label: 'Social' },
  { value: 'course_catalog', label: 'Website Catalogs' },
  { value: 'alerts', label: 'Alerts' },
  { value: 'ai_insights', label: 'AI Insights' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'success', label: 'Success' },
  { value: 'partial', label: 'Partial' },
  { value: 'failed', label: 'Failed' },
  { value: 'running', label: 'Running' },
]

const TRIGGER_OPTIONS = [
  { value: '', label: 'All triggers' },
  { value: 'cron', label: 'Cron' },
  { value: 'manual', label: 'Manual' },
  { value: 'admin', label: 'Admin' },
]

const SGT = 'Asia/Singapore'

function fmtSgt(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-SG', {
    timeZone: SGT, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true,
  })
}

function StatusChip({ status }: { status: LogStatus }) {
  const CONFIGS: Record<LogStatus, { cls: string; label: string; dot: string }> = {
    success: { cls: 'text-emerald-400 border-emerald-800/50 bg-emerald-950/30', label: 'Success', dot: 'bg-emerald-400' },
    partial: { cls: 'text-amber-400 border-amber-800/50 bg-amber-950/30', label: 'Partial', dot: 'bg-amber-400' },
    failed: { cls: 'text-red-400 border-red-800/50 bg-red-950/30', label: 'Failed', dot: 'bg-red-400' },
    running: { cls: 'text-blue-400 border-blue-800/50 bg-blue-950/30', label: 'Running', dot: 'bg-blue-400 animate-pulse' },
  }
  const cfg = CONFIGS[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded border text-[10px] font-medium', cfg.cls)}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cfg.dot)} />
      {cfg.label}
    </span>
  )
}

function countsCompact(row: LogRow): string {
  const parts: string[] = []
  if (row.records_fetched !== null) parts.push(`F:${row.records_fetched}`)
  if (row.records_inserted !== null) parts.push(`I:${row.records_inserted}`)
  if (row.records_updated !== null) parts.push(`U:${row.records_updated}`)
  if (row.records_failed !== null && row.records_failed > 0) parts.push(`X:${row.records_failed}`)
  return parts.length ? parts.join(' ') : '—'
}

function moduleLabel(key: string): string {
  return MODULE_OPTIONS.find((m) => m.value === key)?.label ?? key
}

// ─── Filters bar ────────────────────────────────────────────────────────────

interface Filters {
  status: string
  module: string
  trigger: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { status: '', module: '', trigger: '', from: '', to: '' }

// ─── Row detail (expanded) ──────────────────────────────────────────────────

function RowDetail({ row }: { row: LogRow }) {
  return (
    <tr className="bg-slate-900/60 border-b border-slate-800/40">
      <td colSpan={9} className="px-4 py-3">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="space-y-1">
            <p><span className="text-slate-500">Log ID:</span> <span className="text-slate-300 font-mono">{row.id}</span></p>
            <p><span className="text-slate-500">Started:</span> <span className="text-slate-300">{fmtSgt(row.started_at)} SGT</span></p>
            <p><span className="text-slate-500">Completed:</span> <span className="text-slate-300">{fmtSgt(row.completed_at)} SGT</span></p>
            <p><span className="text-slate-500">Duration:</span> <span className="text-slate-300">{row.duration_seconds !== null ? `${row.duration_seconds.toFixed(1)}s` : '—'}</span></p>
            <p><span className="text-slate-500">Competitor ID:</span> <span className="text-slate-300 font-mono">{row.competitor_id ?? '—'}</span></p>
          </div>
          <div className="space-y-1">
            <p><span className="text-slate-500">Fetched:</span> <span className="text-slate-300">{row.records_fetched ?? '—'}</span></p>
            <p><span className="text-slate-500">Inserted:</span> <span className="text-slate-300">{row.records_inserted ?? '—'}</span></p>
            <p><span className="text-slate-500">Updated:</span> <span className="text-slate-300">{row.records_updated ?? '—'}</span></p>
            <p><span className="text-slate-500">Failed:</span> <span className="text-slate-300">{row.records_failed ?? '—'}</span></p>
          </div>
        </div>
        {row.error_message && (
          <div className="mt-3 p-2.5 rounded-lg bg-red-950/30 border border-red-900/40 text-red-300 text-xs break-words">
            {row.error_message}
          </div>
        )}
        {row.metadata && (
          <div className="mt-3">
            <p className="text-xs text-slate-500 mb-1">Metadata</p>
            <pre className="text-[10px] text-slate-400 bg-slate-950/60 border border-slate-800 rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(row.metadata, null, 2)}
            </pre>
          </div>
        )}
      </td>
    </tr>
  )
}

// ─── Main panel ─────────────────────────────────────────────────────────────

export function RefreshLogsPanel() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [appliedFilters, setAppliedFilters] = useState<Filters>(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<LogRow[]>([])
  const [count, setCount] = useState(0)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  const load = useCallback(async (f: Filters, off: number) => {
    setState('loading')
    const params = new URLSearchParams()
    if (f.status) params.set('status', f.status)
    if (f.module) params.set('module', f.module)
    if (f.trigger) params.set('trigger', f.trigger)
    if (f.from) params.set('from', f.from)
    if (f.to) params.set('to', f.to)
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(off))

    try {
      const res = await fetch(`/api/refresh/logs?${params.toString()}`)
      if (!res.ok) { setState('error'); return }
      const json = (await res.json()) as LogsResponse
      setRows(json.data ?? [])
      setCount(json.count ?? 0)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [])

  useEffect(() => { load(appliedFilters, offset) }, [load, appliedFilters, offset])

  const applyFilters = () => { setOffset(0); setAppliedFilters(filters) }
  const resetFilters = () => { setFilters(EMPTY_FILTERS); setAppliedFilters(EMPTY_FILTERS); setOffset(0) }

  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1

  return (
    <section id="refresh-logs-panel" className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 scroll-mt-20">
      <div className="flex items-center gap-2 mb-1">
        <ListFilter className="h-4 w-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-white">Data Refresh Logs</h2>
      </div>
      <p className="text-xs text-slate-500 mb-4">
        Every refresh — scheduled or manual — is recorded here for audit and troubleshooting.
      </p>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-[10px] text-slate-500 mb-1">Status</label>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1">Module</label>
          <select
            value={filters.module}
            onChange={(e) => setFilters((f) => ({ ...f, module: e.target.value }))}
            className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {MODULE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1">Trigger</label>
          <select
            value={filters.trigger}
            onChange={(e) => setFilters((f) => ({ ...f, trigger: e.target.value }))}
            className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          >
            {TRIGGER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1">From</label>
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
            className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 mb-1">To</label>
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
            className="bg-slate-800/60 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-indigo-500"
          />
        </div>
        <button
          onClick={applyFilters}
          className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg transition-colors"
        >
          Apply
        </button>
        <button
          onClick={resetFilters}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg border border-slate-700 transition-colors"
        >
          <RotateCcw className="h-3 w-3" /> Reset
        </button>
      </div>

      {/* Table */}
      <div className="rounded-lg border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/60">
                {['', 'Module', 'Trigger', 'Status', 'Started (SGT)', 'Duration', 'F/I/U/X', 'Source', 'Error'].map((h) => (
                  <th key={h} className="text-left px-3 py-2 text-[10px] font-medium text-slate-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state === 'loading' && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-600">Loading…</td></tr>
              )}
              {state === 'error' && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-red-400">Unable to load refresh logs.</td></tr>
              )}
              {state === 'ready' && rows.length === 0 && (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-slate-600">No refresh logs yet.</td></tr>
              )}
              {state === 'ready' && rows.map((row) => {
                const expanded = expandedId === row.id
                return (
                  <Fragment key={row.id}>
                    <tr
                      onClick={() => setExpandedId(expanded ? null : row.id)}
                      className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/20 cursor-pointer transition-colors"
                    >
                      <td className="px-3 py-2 w-4 text-slate-600">
                        {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </td>
                      <td className="px-3 py-2 text-slate-200 whitespace-nowrap">{moduleLabel(row.module)}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap capitalize">{row.triggered_by}</td>
                      <td className="px-3 py-2"><StatusChip status={row.status} /></td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{fmtSgt(row.started_at)}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">
                        {row.duration_seconds !== null ? `${row.duration_seconds.toFixed(1)}s` : '—'}
                      </td>
                      <td className="px-3 py-2 text-slate-400 font-mono whitespace-nowrap">{countsCompact(row)}</td>
                      <td className="px-3 py-2 text-slate-400 whitespace-nowrap">{row.source}</td>
                      <td className="px-3 py-2 text-red-400 max-w-[220px] truncate" title={row.error_message ?? undefined}>
                        {row.error_message ?? '—'}
                      </td>
                    </tr>
                    {expanded && <RowDetail row={row} />}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {count > 0 && (
        <div className="flex items-center justify-between mt-3 text-xs text-slate-500">
          <p>Showing {offset + 1}–{Math.min(offset + PAGE_SIZE, count)} of {count}</p>
          <div className="flex items-center gap-2">
            <button
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
              className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono">{currentPage} / {totalPages}</span>
            <button
              disabled={offset + PAGE_SIZE >= count}
              onClick={() => setOffset((o) => o + PAGE_SIZE)}
              className="p-1.5 rounded-lg bg-slate-900/60 border border-slate-800 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
