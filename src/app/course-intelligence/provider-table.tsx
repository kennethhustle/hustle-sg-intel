'use client'

import React, { useMemo, useState } from 'react'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { cn } from '@/lib/utils'
import { breakdownEntries, evidenceList, type ProviderLeaderboardEntry, type CourseRowDto } from './types'

const FALLBACK_COLOR = '#64748b'

type SortKey =
  | 'runs' | 'courses' | 'growth' | 'newCourses' | 'medianFee' | 'breadth' | 'respondents' | 'threat'

const SORT_LABELS: Record<SortKey, string> = {
  runs: 'Runs',
  courses: 'Courses',
  growth: 'Growth',
  newCourses: 'New',
  medianFee: 'Median Fee',
  breadth: 'Categories',
  respondents: 'Respondents',
  threat: 'Threat',
}

const THREAT_STYLES: Record<string, string> = {
  'Critical Threat': 'bg-red-500/15 text-red-400 border-red-500/30',
  'High Threat': 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  'Medium Threat': 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  'Low Threat': 'bg-slate-500/15 text-slate-400 border-slate-500/30',
  'Monitor': 'bg-slate-700/30 text-slate-500 border-slate-700/40',
}

function fmtFee(n: number | null) {
  return n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}
function fmtNum(n: number | null | undefined) {
  return n == null ? '—' : n.toLocaleString()
}

export function ProviderTable({ rows }: { rows: ProviderLeaderboardEntry[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('runs')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const maxRuns = useMemo(() => Math.max(1, ...rows.map((r) => r.totalRuns)), [rows])

  const sorted = useMemo(() => {
    const withKey = (r: ProviderLeaderboardEntry): number => {
      switch (sortKey) {
        case 'runs': return r.totalRuns
        case 'courses': return r.activeCourses
        case 'growth': return r.runGrowth?.pct ?? -Infinity
        case 'newCourses': return r.newCourses7d
        case 'medianFee': return r.medianFee ?? -Infinity
        case 'breadth': return r.categoriesServed
        case 'respondents': return r.totalRespondents
        case 'threat': return r.threat?.score ?? -Infinity
        default: return 0
      }
    }
    const copy = [...rows]
    copy.sort((a, b) => (withKey(a) - withKey(b)) * (sortDir === 'desc' ? -1 : 1))
    return copy
  }, [rows, sortKey, sortDir])

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  function toggleExpand(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
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
      <div className="flex items-center gap-2 flex-wrap px-4 py-2 bg-slate-900/60 border-b border-slate-800/60">
        <span className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mr-1">Sort:</span>
        {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
          <button
            key={key}
            onClick={() => toggleSort(key)}
            className={cn(
              'text-[10px] font-mono px-2 py-1 rounded border transition-colors',
              sortKey === key
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30'
                : 'bg-slate-800/40 text-slate-500 border-slate-700/50 hover:text-slate-300'
            )}
          >
            {SORT_LABELS[key]} {sortKey === key ? (sortDir === 'desc' ? '▾' : '▴') : ''}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800/60 bg-slate-900/40 text-[10px] font-mono text-slate-600 tracking-widest uppercase">
              <th className="text-left px-3 py-2 font-normal w-8">#</th>
              <th className="text-left px-3 py-2 font-normal">Provider</th>
              <th className="text-left px-3 py-2 font-normal w-40">Upcoming Runs</th>
              <th className="text-right px-3 py-2 font-normal">Courses</th>
              <th className="text-right px-3 py-2 font-normal">Categories</th>
              <th className="text-left px-3 py-2 font-normal">Top Course</th>
              <th className="text-right px-3 py-2 font-normal">Median Fee</th>
              <th className="text-right px-3 py-2 font-normal">Avg Rating</th>
              <th className="text-right px-3 py-2 font-normal">Respondents</th>
              <th className="text-right px-3 py-2 font-normal">New (7d)</th>
              <th className="text-right px-3 py-2 font-normal">Growth</th>
              <th className="text-right px-3 py-2 font-normal">Share</th>
              <th className="text-right px-3 py-2 font-normal">Threat</th>
              <th className="w-6" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((r, i) => {
              const key = r.competitorId ?? r.name
              const isOpen = expanded.has(key)
              const barPct = Math.max(1, Math.round((r.totalRuns / maxRuns) * 100))
              const growth = r.runGrowth
              const color = r.color ?? FALLBACK_COLOR
              return (
                <React.Fragment key={key}>
                  <tr
                    onClick={() => toggleExpand(key)}
                    className={cn(
                      'border-b border-slate-800/40 last:border-0 cursor-pointer hover:bg-slate-800/30 transition-colors',
                      r.isHustle && 'bg-indigo-500/[0.04]'
                    )}
                  >
                    <td className="px-3 py-2.5 text-slate-600 font-mono">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <CompetitorBadge name={r.name} color={color} is_hustle={r.isHustle} size="sm" />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-100 w-10 text-right shrink-0">
                          {r.totalRuns}
                        </span>
                        <div className="h-1.5 flex-1 bg-slate-800 rounded-full overflow-hidden min-w-[3rem]">
                          <div
                            className="h-full rounded-full"
                            style={{ width: `${barPct}%`, backgroundColor: r.isHustle ? '#818cf8' : color }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">{r.activeCourses}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">{r.categoriesServed}</td>
                    <td className="px-3 py-2.5 max-w-[16rem]">
                      {r.topCourse ? (
                        <span className="text-slate-400 line-clamp-1" title={r.topCourse.title}>
                          {r.topCourse.title} <span className="text-slate-600">({r.topCourse.runs})</span>
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">{fmtFee(r.medianFee)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                      {r.avgRating != null ? r.avgRating.toFixed(1) : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-300">{fmtNum(r.totalRespondents)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-emerald-400">
                      {r.newCourses7d > 0 ? `+${r.newCourses7d}` : '—'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono">
                      {growth ? (
                        <span className={growth.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                          {growth.pct >= 0 ? '▲' : '▼'} {Math.abs(growth.pct).toFixed(0)}%
                        </span>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-slate-400">
                      {r.marketSharePct.toFixed(1)}%
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {r.threat ? (
                        <span
                          className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border whitespace-nowrap', THREAT_STYLES[r.threat.label] ?? THREAT_STYLES.Monitor)}
                          title={`Threat score: ${r.threat.score}`}
                        >
                          {r.threat.label}
                        </span>
                      ) : (
                        <span className="text-slate-700 text-[10px]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-slate-600 text-center">
                      <span className={cn('inline-block transition-transform', isOpen && 'rotate-180')}>▾</span>
                    </td>
                  </tr>

                  {isOpen && (
                    <tr className="bg-slate-900/40 border-b border-slate-800/40">
                      <td colSpan={14} className="px-6 py-4">
                        <ProviderDrilldown row={r} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ProviderDrilldown({ row }: { row: ProviderLeaderboardEntry }) {
  const topByRuns = [...row.courses].sort((a: CourseRowDto, b: CourseRowDto) => b.runs - a.runs).slice(0, 5)
  const topByRespondents = [...row.courses]
    .filter((c) => c.respondents != null)
    .sort((a, b) => (b.respondents ?? 0) - (a.respondents ?? 0))
    .slice(0, 5)
  const newCourses = row.courses.filter((c) => c.isNew)
  const categoryEntries = Object.entries(row.categoryBreakdown).sort((a, b) => b[1].runs - a[1].runs)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div>
        <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Top 5 Courses by Runs</p>
        {topByRuns.length === 0 ? (
          <p className="text-xs text-slate-600">No course data.</p>
        ) : (
          <ul className="space-y-1.5">
            {topByRuns.map((c) => (
              <li key={c.sfRefNo} className="flex items-center justify-between gap-3 text-xs">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-indigo-400 transition-colors line-clamp-1 flex-1 min-w-0"
                >
                  {c.title} ↗
                </a>
                <span className="font-mono text-slate-400 shrink-0">{c.runs} runs</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2 mt-4">Top 5 by Respondents</p>
        {topByRespondents.length === 0 ? (
          <p className="text-xs text-slate-600">No respondent data.</p>
        ) : (
          <ul className="space-y-1.5">
            {topByRespondents.map((c) => (
              <li key={c.sfRefNo} className="flex items-center justify-between gap-3 text-xs">
                <a
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-300 hover:text-indigo-400 transition-colors line-clamp-1 flex-1 min-w-0"
                >
                  {c.title} ↗
                </a>
                <span className="font-mono text-slate-400 shrink-0">{fmtNum(c.respondents)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2 mt-4">Categories Served</p>
        {categoryEntries.length === 0 ? (
          <p className="text-xs text-slate-600">No category data.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {categoryEntries.map(([cat, agg]) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/60 border border-slate-700/50 text-[10px] text-slate-300"
              >
                {cat} <span className="text-slate-500 font-mono">{agg.runs} runs</span>
              </span>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div>
            <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-1">Priciest Course</p>
            {row.priciest ? (
              <p className="text-xs text-slate-300 line-clamp-1">{row.priciest.title} — <span className="font-mono">{fmtFee(row.priciest.fee)}</span></p>
            ) : (
              <p className="text-xs text-slate-600">—</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-1">Cheapest Course</p>
            {row.cheapest ? (
              <p className="text-xs text-slate-300 line-clamp-1">{row.cheapest.title} — <span className="font-mono">{fmtFee(row.cheapest.fee)}</span></p>
            ) : (
              <p className="text-xs text-slate-600">—</p>
            )}
          </div>
        </div>

        {newCourses.length > 0 && (
          <div className="mt-4">
            <p className="text-[10px] font-mono text-emerald-500 tracking-widest uppercase mb-1">
              New Courses Added ({newCourses.length})
            </p>
            <ul className="space-y-1">
              {newCourses.slice(0, 6).map((c) => (
                <li key={c.sfRefNo} className="text-xs text-slate-400 line-clamp-1">
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-emerald-400">
                    {c.title} ↗
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div>
        <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Why this threat level?</p>
        {row.threat ? (
          <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border', THREAT_STYLES[row.threat.label] ?? THREAT_STYLES.Monitor)}>
                {row.threat.label}
              </span>
              <span className="font-mono text-xs text-slate-400">Score: {row.threat.score}</span>
            </div>
            {breakdownEntries(row.threat.breakdown).length > 0 && (
              <div className="space-y-1 mb-3">
                {breakdownEntries(row.threat.breakdown).map((f, i) => (
                  <div key={i} className="flex items-center justify-between text-xs gap-3">
                    <span className="text-slate-500">{f.factor}</span>
                    <span className="font-mono text-slate-300 text-right">{f.value}</span>
                  </div>
                ))}
              </div>
            )}
            {evidenceList(row.threat.evidence).length > 0 && (
              <ul className="space-y-1 border-t border-slate-800/60 pt-2">
                {evidenceList(row.threat.evidence).map((e, i) => (
                  <li key={i} className="text-xs text-slate-400 flex gap-1.5">
                    <span className="text-slate-600 shrink-0">•</span> {e}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-600">No threat score computed yet.</p>
        )}
      </div>
    </div>
  )
}
