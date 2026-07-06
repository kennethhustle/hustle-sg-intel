'use client'

import React, { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { breakdownEntries, evidenceList, type CategoryIntelligenceEntry, type ProviderLeaderboardEntry } from './types'

function fmtFee(n: number | null) {
  return n == null ? '—' : `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function opportunityStyle(score: number): string {
  if (score >= 80) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  if (score >= 60) return 'bg-teal-500/15 text-teal-400 border-teal-500/30'
  if (score >= 40) return 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  return 'bg-slate-700/30 text-slate-500 border-slate-700/40'
}

function opportunityText(score: number): string {
  if (score >= 80) return 'High-priority opportunity'
  if (score >= 60) return 'Worth exploring'
  if (score >= 40) return 'Monitor'
  return 'Low priority / crowded'
}

const COMPETITION_STYLES: Record<string, string> = {
  low: 'text-emerald-400',
  medium: 'text-amber-400',
  high: 'text-red-400',
}

export function CategoryMatrix({
  categories,
  providers,
}: {
  categories: CategoryIntelligenceEntry[]
  providers: ProviderLeaderboardEntry[]
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  function toggle(cat: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  if (categories.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
        No data yet — populates after the next nightly refresh.
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* ── Category cards/table ── */}
      <div className="rounded-xl border border-slate-800/60 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800/60 bg-slate-900/40 text-[10px] font-mono text-slate-600 tracking-widest uppercase">
                <th className="text-left px-3 py-2 font-normal">Category</th>
                <th className="text-right px-3 py-2 font-normal">Providers</th>
                <th className="text-right px-3 py-2 font-normal">Courses</th>
                <th className="text-right px-3 py-2 font-normal">Runs</th>
                <th className="text-right px-3 py-2 font-normal">Growth</th>
                <th className="text-right px-3 py-2 font-normal">Median Fee</th>
                <th className="text-right px-3 py-2 font-normal">Avg Rating</th>
                <th className="text-right px-3 py-2 font-normal">Hustle</th>
                <th className="text-right px-3 py-2 font-normal">Opportunity</th>
                <th className="text-right px-3 py-2 font-normal">Competition</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((cat) => {
                const isOpen = expanded.has(cat.category)
                return (
                  <React.Fragment key={cat.category}>
                    <tr
                      onClick={() => toggle(cat.category)}
                      className="border-b border-slate-800/40 last:border-0 cursor-pointer hover:bg-slate-800/20 transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-1.5 h-1.5 rounded-full shrink-0"
                            style={{ backgroundColor: cat.priority >= 70 ? '#f59e0b' : cat.priority >= 40 ? '#64748b' : '#334155' }}
                            title={`Priority: ${cat.priority}`}
                          />
                          <span className="text-slate-200 font-medium">{cat.category}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">{cat.providersCount}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">{cat.courses}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-100 font-bold">{cat.runs}</td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {cat.growth ? (
                          <span className={cat.growth.pct >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                            {cat.growth.pct >= 0 ? '▲' : '▼'} {Math.abs(cat.growth.pct).toFixed(0)}%
                          </span>
                        ) : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">{fmtFee(cat.medianFee)}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-slate-300">
                        {cat.avgRating != null ? cat.avgRating.toFixed(1) : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono">
                        {cat.hustle.runs === 0 ? (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/30">
                            ABSENT
                          </span>
                        ) : (
                          <span className="text-indigo-300">{cat.hustle.runs} · {cat.hustle.sharePct.toFixed(0)}%</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {cat.opportunity ? (
                          <span
                            className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border whitespace-nowrap', opportunityStyle(cat.opportunity.score))}
                            title={`Score: ${cat.opportunity.score}`}
                          >
                            {opportunityText(cat.opportunity.score)}
                          </span>
                        ) : <span className="text-slate-700 text-[10px]">—</span>}
                      </td>
                      <td className={cn('px-3 py-2.5 text-right font-mono text-[10px] uppercase font-bold', COMPETITION_STYLES[cat.competitionLevel])}>
                        {cat.competitionLevel}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-slate-900/40 border-b border-slate-800/40">
                        <td colSpan={10} className="px-6 py-4">
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div>
                              <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Top Providers</p>
                              {cat.topProviders.length === 0 ? (
                                <p className="text-xs text-slate-600">No provider data.</p>
                              ) : (
                                <ul className="space-y-1">
                                  {cat.topProviders.map((p) => (
                                    <li key={p.name} className="flex justify-between text-xs">
                                      <span className="text-slate-300">{p.name}</span>
                                      <span className="font-mono text-slate-500">{p.runs} runs</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2 mt-4">Top Courses</p>
                              {cat.topCourses.length === 0 ? (
                                <p className="text-xs text-slate-600">No course data.</p>
                              ) : (
                                <ul className="space-y-1">
                                  {cat.topCourses.map((c, i) => (
                                    <li key={i} className="flex justify-between gap-2 text-xs">
                                      <span className="text-slate-300 line-clamp-1">{c.title} <span className="text-slate-600">({c.provider})</span></span>
                                      <span className="font-mono text-slate-500 shrink-0">{c.runs}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                            <div>
                              <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Opportunity Breakdown</p>
                              {cat.opportunity ? (
                                <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-3">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className={cn('inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border', opportunityStyle(cat.opportunity.score))}>
                                      {opportunityText(cat.opportunity.score)}
                                    </span>
                                    <span className="font-mono text-xs text-slate-400">Score: {cat.opportunity.score}</span>
                                  </div>
                                  {breakdownEntries(cat.opportunity.breakdown).length > 0 && (
                                    <div className="space-y-1 mb-3">
                                      {breakdownEntries(cat.opportunity.breakdown).map((f, i) => (
                                        <div key={i} className="flex justify-between text-xs gap-3">
                                          <span className="text-slate-500">{f.factor}</span>
                                          <span className="font-mono text-slate-300 text-right">{f.value}</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                  {evidenceList(cat.opportunity.evidence).length > 0 && (
                                    <ul className="space-y-1 border-t border-slate-800/60 pt-2">
                                      {evidenceList(cat.opportunity.evidence).map((e, i) => (
                                        <li key={i} className="text-xs text-slate-400 flex gap-1.5">
                                          <span className="text-slate-600 shrink-0">•</span> {e}
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              ) : (
                                <p className="text-xs text-slate-600">No opportunity score computed yet.</p>
                              )}
                            </div>
                          </div>
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

      {/* ── Heatmap ── */}
      <Heatmap categories={categories} providers={providers} />

      {/* ── Demand vs Competition matrix ── */}
      <DemandCompetitionMatrix categories={categories} />
    </div>
  )
}

function Heatmap({
  categories,
  providers,
}: {
  categories: CategoryIntelligenceEntry[]
  providers: ProviderLeaderboardEntry[]
}) {
  const topProviders = useMemo(
    () => [...providers].sort((a, b) => b.totalRuns - a.totalRuns).slice(0, 8),
    [providers]
  )

  const maxCell = useMemo(() => {
    let max = 1
    for (const cat of categories) {
      for (const p of topProviders) {
        const runs = p.categoryBreakdown[cat.category]?.runs ?? 0
        if (runs > max) max = runs
      }
    }
    return max
  }, [categories, topProviders])

  function cellStyle(runs: number, isHustle: boolean) {
    if (runs === 0) return { backgroundColor: 'rgba(30,41,59,0.4)' }
    const intensity = Math.min(1, runs / maxCell)
    const base = isHustle ? [99, 102, 241] : [100, 116, 139] // indigo vs slate
    const alpha = 0.15 + intensity * 0.75
    return { backgroundColor: `rgba(${base[0]},${base[1]},${base[2]},${alpha})` }
  }

  if (topProviders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
        No provider data yet for the heatmap.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800/60 overflow-hidden">
      <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-800/60">
        <span className="text-[10px] font-mono text-slate-400 tracking-widest uppercase">Category × Provider Run Heatmap</span>
        <span className="text-[10px] font-mono text-slate-600 ml-2">Top 8 providers by total runs · Hustle column highlighted</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-800/60">
              <th className="text-left px-3 py-2 font-normal text-[10px] font-mono text-slate-600 tracking-widest uppercase">Category</th>
              {topProviders.map((p) => (
                <th
                  key={p.competitorId ?? p.name}
                  className={cn(
                    'text-center px-2 py-2 font-normal text-[9px] font-mono tracking-wide uppercase whitespace-nowrap',
                    p.isHustle ? 'text-indigo-300' : 'text-slate-500'
                  )}
                  title={p.name}
                >
                  {p.name.length > 12 ? `${p.name.slice(0, 11)}…` : p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.category} className="border-b border-slate-800/30 last:border-0">
                <td className="px-3 py-1.5 text-slate-300 whitespace-nowrap">{cat.category}</td>
                {topProviders.map((p) => {
                  const runs = p.categoryBreakdown[cat.category]?.runs ?? 0
                  return (
                    <td
                      key={p.competitorId ?? p.name}
                      className={cn('text-center px-2 py-1.5 font-mono', p.isHustle && 'ring-1 ring-inset ring-indigo-500/30')}
                      style={cellStyle(runs, p.isHustle)}
                    >
                      <span className={runs > 0 ? 'text-slate-100' : 'text-slate-700'}>{runs || '·'}</span>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const QUADRANTS = [
  { key: 'opportunity', title: 'Opportunity', subtitle: 'High demand · Low competition', cls: 'bg-emerald-500/[0.06] border-emerald-500/25' },
  { key: 'competitive', title: 'Competitive but important', subtitle: 'High demand · High competition', cls: 'bg-amber-500/[0.06] border-amber-500/25' },
  { key: 'monitor', title: 'Monitor', subtitle: 'Low demand · Low competition', cls: 'bg-slate-700/[0.15] border-slate-600/30' },
  { key: 'avoid', title: 'Crowded / avoid', subtitle: 'Low demand · High competition', cls: 'bg-red-500/[0.05] border-red-500/20' },
] as const

function DemandCompetitionMatrix({ categories }: { categories: CategoryIntelligenceEntry[] }) {
  const medianRuns = useMemo(() => {
    const sorted = [...categories.map((c) => c.runs)].sort((a, b) => a - b)
    if (sorted.length === 0) return 0
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
  }, [categories])

  function resolveDemand(cat: CategoryIntelligenceEntry): 'high' | 'low' {
    if (cat.demandLevel === 'high') return 'high'
    if (cat.demandLevel === 'low') return 'low'
    // medium -> nearer quadrant based on runs vs median
    return cat.runs >= medianRuns ? 'high' : 'low'
  }
  function resolveCompetition(cat: CategoryIntelligenceEntry): 'high' | 'low' {
    if (cat.competitionLevel === 'high') return 'high'
    if (cat.competitionLevel === 'low') return 'low'
    return cat.providersCount >= 3 ? 'high' : 'low'
  }

  const buckets: Record<string, CategoryIntelligenceEntry[]> = {
    opportunity: [], competitive: [], monitor: [], avoid: [],
  }
  for (const cat of categories) {
    const d = resolveDemand(cat)
    const c = resolveCompetition(cat)
    if (d === 'high' && c === 'low') buckets.opportunity.push(cat)
    else if (d === 'high' && c === 'high') buckets.competitive.push(cat)
    else if (d === 'low' && c === 'low') buckets.monitor.push(cat)
    else buckets.avoid.push(cat)
  }

  const maxRuns = Math.max(1, ...categories.map((c) => c.runs))

  return (
    <div className="rounded-xl border border-slate-800/60 overflow-hidden">
      <div className="px-4 py-3 bg-slate-900/60 border-b border-slate-800/60">
        <span className="text-[10px] font-mono text-slate-400 tracking-widest uppercase">Demand vs Competition Matrix</span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
        {QUADRANTS.map((q) => (
          <div key={q.key} className={cn('rounded-lg border p-4 min-h-[9rem]', q.cls)}>
            <p className="text-xs font-semibold text-slate-200">{q.title}</p>
            <p className="text-[10px] text-slate-500 mb-3">{q.subtitle}</p>
            {buckets[q.key].length === 0 ? (
              <p className="text-[11px] text-slate-600">No categories here.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {buckets[q.key].map((cat) => {
                  const scale = 0.75 + (cat.runs / maxRuns) * 0.5
                  return (
                    <span
                      key={cat.category}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-slate-800/70 border border-slate-700/60 text-slate-200"
                      style={{ fontSize: `${Math.min(12, 10 * scale)}px` }}
                      title={`${cat.runs} runs · ${cat.providersCount} providers`}
                    >
                      {cat.hustle.runs > 0 && <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />}
                      {cat.category}
                      <span className="text-slate-500 font-mono text-[9px]">{cat.runs}</span>
                    </span>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 text-[10px] text-slate-600">
        Simplification: categories with &quot;medium&quot; demand or competition are placed in the nearer quadrant
        (demand by runs vs. median across categories; competition by provider count ≥3). Chip size and the trailing
        number reflect total runs. Dot marker = Hustle has runs in this category.
        Calculated from cached MySkillsFuture data.
      </p>
    </div>
  )
}
