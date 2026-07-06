'use client'

import React, { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { breakdownEntries, type CourseRowDto } from './types'

type SortKey = 'runs' | 'respondents' | 'rating' | 'fee' | 'demand'

const PAGE_SIZE = 25

const DEMAND_STYLES: Record<string, string> = {
  'Very High': 'bg-red-500/15 text-red-400 border-red-500/30',
  'High': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'Medium': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Low': 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

function fmtFee(n: number | null) {
  return n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function fmtNum(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString()
}

function toCsv(rows: CourseRowDto[]): string {
  const headers = ['Title', 'Provider', 'Category', 'Runs', 'Fee', 'Rating', 'Respondents', 'Demand', 'New', 'RunDelta', 'URL']
  const lines = [headers.join(',')]
  for (const r of rows) {
    const cells = [
      r.title, r.provider, r.category ?? '', String(r.runs), r.fee != null ? String(r.fee) : '',
      r.rating != null ? String(r.rating) : '', r.respondents != null ? String(r.respondents) : '',
      r.demandLevel ?? '', r.isNew ? 'yes' : 'no', r.runDelta != null ? String(r.runDelta) : '', r.url ?? '',
    ]
    lines.push(cells.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
  }
  return lines.join('\n')
}

export function CourseTable({ rows }: { rows: CourseRowDto[] }) {
  const [search, setSearch] = useState('')
  const [provider, setProvider] = useState('')
  const [category, setCategory] = useState('')
  const [demand, setDemand] = useState('')
  const [feeMin, setFeeMin] = useState('')
  const [feeMax, setFeeMax] = useState('')
  const [minRating, setMinRating] = useState('')
  const [newOnly, setNewOnly] = useState(false)
  const [highRunOnly, setHighRunOnly] = useState(false)
  const [hustleAbsentOnly, setHustleAbsentOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('runs')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [page, setPage] = useState(1)
  const [expandedRef, setExpandedRef] = useState<string | null>(null)

  const providers = useMemo(() => Array.from(new Set(rows.map((r) => r.provider))).sort(), [rows])
  const categories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter((c): c is string => !!c))).sort(),
    [rows]
  )

  const hustleCategories = useMemo(
    () => new Set(rows.filter((r) => r.isHustle).map((r) => r.category).filter(Boolean)),
    [rows]
  )

  const filtered = useMemo(() => {
    let out = rows
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter((r) => r.title.toLowerCase().includes(q))
    }
    if (provider) out = out.filter((r) => r.provider === provider)
    if (category) out = out.filter((r) => r.category === category)
    if (demand) out = out.filter((r) => r.demandLevel === demand)
    if (feeMin) out = out.filter((r) => r.fee != null && r.fee >= Number(feeMin))
    if (feeMax) out = out.filter((r) => r.fee != null && r.fee <= Number(feeMax))
    if (minRating) out = out.filter((r) => r.rating != null && r.rating >= Number(minRating))
    if (newOnly) out = out.filter((r) => r.isNew)
    if (highRunOnly) out = out.filter((r) => r.runs >= 10)
    if (hustleAbsentOnly) out = out.filter((r) => r.category && !hustleCategories.has(r.category))

    const key = (r: CourseRowDto) => {
      switch (sortKey) {
        case 'runs': return r.runs
        case 'respondents': return r.respondents ?? -Infinity
        case 'rating': return r.rating ?? -Infinity
        case 'fee': return r.fee ?? -Infinity
        case 'demand': return r.demandScore ?? -Infinity
        default: return 0
      }
    }
    const copy = [...out]
    copy.sort((a, b) => (key(a) - key(b)) * (sortDir === 'desc' ? -1 : 1))
    return copy
  }, [rows, search, provider, category, demand, feeMin, feeMax, minRating, newOnly, highRunOnly, hustleAbsentOnly, hustleCategories, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
    setPage(1)
  }

  function exportCsv() {
    const csv = toCsv(filtered)
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `course-leaderboard-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
        No data yet — populates after the next nightly refresh.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800/60 overflow-hidden">
      {/* Filters */}
      <div className="p-4 bg-slate-900/60 border-b border-slate-800/60 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search title…"
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2.5 py-1.5 text-xs text-slate-200 placeholder:text-slate-600 min-w-[12rem]"
          />
          <select
            value={provider}
            onChange={(e) => { setProvider(e.target.value); setPage(1) }}
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300"
          >
            <option value="">All providers</option>
            {providers.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1) }}
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300"
          >
            <option value="">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select
            value={demand}
            onChange={(e) => { setDemand(e.target.value); setPage(1) }}
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300"
          >
            <option value="">Any demand</option>
            <option value="Very High">Very High</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <input
            value={feeMin}
            onChange={(e) => { setFeeMin(e.target.value); setPage(1) }}
            placeholder="Min fee"
            type="number"
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300 w-24"
          />
          <input
            value={feeMax}
            onChange={(e) => { setFeeMax(e.target.value); setPage(1) }}
            placeholder="Max fee"
            type="number"
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300 w-24"
          />
          <input
            value={minRating}
            onChange={(e) => { setMinRating(e.target.value); setPage(1) }}
            placeholder="Min rating"
            type="number"
            step="0.1"
            className="bg-slate-950/60 border border-slate-700/60 rounded px-2 py-1.5 text-xs text-slate-300 w-24"
          />
          <button
            onClick={exportCsv}
            className="ml-auto text-[10px] font-mono px-2.5 py-1.5 rounded border border-slate-700/60 bg-slate-800/60 text-slate-300 hover:text-white hover:bg-slate-700/60 transition-colors"
          >
            ⬇ Export CSV ({filtered.length})
          </button>
        </div>
        <div className="flex items-center gap-4 flex-wrap text-[11px] text-slate-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={newOnly} onChange={(e) => { setNewOnly(e.target.checked); setPage(1) }} />
            New courses only
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={highRunOnly} onChange={(e) => { setHighRunOnly(e.target.checked); setPage(1) }} />
            High-run only (≥10)
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input type="checkbox" checked={hustleAbsentOnly} onChange={(e) => { setHustleAbsentOnly(e.target.checked); setPage(1) }} />
            Hustle-absent categories only
          </label>
          <span className="ml-auto text-[10px] font-mono text-slate-500 tracking-widest uppercase mr-1">Sort:</span>
          {(['runs', 'respondents', 'rating', 'fee', 'demand'] as SortKey[]).map((k) => (
            <button
              key={k}
              onClick={() => toggleSort(k)}
              className={cn(
                'text-[10px] font-mono px-2 py-1 rounded border transition-colors capitalize',
                sortKey === k
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                  : 'bg-slate-800/40 text-slate-500 border-slate-700/50 hover:text-slate-300'
              )}
            >
              {k} {sortKey === k ? (sortDir === 'desc' ? '▾' : '▴') : ''}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="text-center text-sm text-slate-500 py-8">No courses match these filters.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-900/40 text-[10px] font-mono text-slate-600 tracking-widest uppercase">
                  <th className="text-left px-3 py-2 font-normal">Title</th>
                  <th className="text-left px-3 py-2 font-normal">Provider</th>
                  <th className="text-left px-3 py-2 font-normal">Category</th>
                  <th className="text-right px-3 py-2 font-normal">Runs</th>
                  <th className="text-right px-3 py-2 font-normal">Fee</th>
                  <th className="text-right px-3 py-2 font-normal">Rating</th>
                  <th className="text-right px-3 py-2 font-normal">Respondents</th>
                  <th className="text-right px-3 py-2 font-normal">Demand</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const isOpen = expandedRef === c.sfRefNo
                  return (
                    <React.Fragment key={c.sfRefNo}>
                      <tr
                        className="border-b border-slate-800/40 last:border-0 hover:bg-slate-800/20 transition-colors"
                      >
                        <td className="px-3 py-2.5 max-w-[18rem]">
                          <div className="flex items-center gap-1.5">
                            <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-slate-200 hover:text-indigo-400 transition-colors line-clamp-1">
                              {c.title} ↗
                            </a>
                            {c.isNew && (
                              <span className="shrink-0 text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                NEW
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-slate-400">{c.provider}</td>
                        <td className="px-3 py-2.5">
                          {c.category ? (
                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50 text-[10px] text-slate-300 whitespace-nowrap">
                              {c.category}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono">
                          <span className="text-slate-100 font-bold">{c.runs}</span>
                          {c.runDelta != null && c.runDelta !== 0 && (
                            <span className={cn('ml-1 text-[10px]', c.runDelta > 0 ? 'text-emerald-400' : 'text-red-400')}>
                              {c.runDelta > 0 ? '▲' : '▼'}{Math.abs(c.runDelta)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">{fmtFee(c.fee)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">{c.rating != null ? c.rating.toFixed(1) : '—'}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-slate-300">{fmtNum(c.respondents)}</td>
                        <td className="px-3 py-2.5 text-right">
                          {c.demandLevel ? (
                            <button
                              onClick={() => setExpandedRef(isOpen ? null : c.sfRefNo)}
                              className={cn('inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border', DEMAND_STYLES[c.demandLevel])}
                            >
                              {c.demandLevel} <span className={cn('transition-transform', isOpen && 'rotate-180')}>▾</span>
                            </button>
                          ) : (
                            <span className="text-slate-700 text-[10px]">—</span>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-slate-900/40 border-b border-slate-800/40">
                          <td colSpan={8} className="px-6 py-3">
                            <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-1.5">
                              Why {c.demandLevel} demand?
                            </p>
                            {breakdownEntries(c.demandBreakdown).length === 0 ? (
                              <p className="text-xs text-slate-600">No breakdown available.</p>
                            ) : (
                              <div className="flex flex-wrap gap-x-6 gap-y-1">
                                {breakdownEntries(c.demandBreakdown).map((f, i) => (
                                  <div key={i} className="flex items-center gap-1.5 text-xs">
                                    <span className="text-slate-500">{f.factor}:</span>
                                    <span className="font-mono text-slate-300">{f.value}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between px-4 py-3 bg-slate-900/40 border-t border-slate-800/60 text-xs text-slate-500">
            <span>
              Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2 py-1 rounded border border-slate-700/60 disabled:opacity-30 hover:bg-slate-800/60"
              >
                ← Prev
              </button>
              <span className="font-mono">{page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2 py-1 rounded border border-slate-700/60 disabled:opacity-30 hover:bg-slate-800/60"
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
