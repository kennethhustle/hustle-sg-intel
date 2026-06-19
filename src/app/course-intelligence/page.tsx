/**
 * MySkillsFuture Demand Intelligence
 *
 * Reads ONLY from Supabase. Never scrapes MySkillsFuture on page load.
 * Data refreshed daily at 7am SGT via /api/cron/myskillsfuture-refresh.
 *
 * Primary ranking metric: popularity_score (SF schedule demand signal)
 */

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ExternalLink, AlertTriangle, TrendingUp, Target, Clock, Database, Zap, Shield } from 'lucide-react'

export const revalidate = 300

// ─── Demand level config ────────────────────────────────────────────────────
function getDemandLevel(score: number): {
  label: string
  emoji: string
  color: string
  bg: string
} {
  if (score >= 100) return { label: 'EXTREME',   emoji: '🔥', color: 'text-red-400',    bg: 'bg-red-950/60 border-red-800' }
  if (score >= 50)  return { label: 'VERY HIGH', emoji: '🔥', color: 'text-orange-400', bg: 'bg-orange-950/60 border-orange-800' }
  if (score >= 20)  return { label: 'HIGH',      emoji: '⚡', color: 'text-yellow-400', bg: 'bg-yellow-950/60 border-yellow-800' }
  if (score >= 10)  return { label: 'MEDIUM',    emoji: '📈', color: 'text-blue-400',   bg: 'bg-blue-950/60 border-blue-800' }
  if (score >= 1)   return { label: 'LOW',       emoji: '📉', color: 'text-zinc-400',   bg: 'bg-zinc-900/60 border-zinc-700' }
  return               { label: 'INACTIVE',  emoji: '⚪', color: 'text-zinc-600',   bg: 'bg-zinc-950/60 border-zinc-800' }
}

function getProviderAbbrev(name: string): string {
  const map: Record<string, string> = {
    'BELLS Institute':    'BELLS',
    'Vertical Institute': 'VERTICAL',
    'OOm Pte Ltd':        'OOM',
    'Skills Dev Academy': 'SDA',
    'InfoTech Academy':   'INFOTECH',
    'ASK Training':       'ASK',
    'Heicoders Academy':  'HEICODERS',
    'Happy Together':     'HAPPY',
    'Equinet Academy':    'EQUINET',
    'Hustle SG':          'HUSTLE SG',
  }
  for (const [key, abbrev] of Object.entries(map)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return abbrev
  }
  return name.slice(0, 8).toUpperCase()
}

const PROVIDER_COLORS: Record<string, string> = {
  'HUSTLE SG':  '#a855f7',
  'INFOTECH':   '#ef4444',
  'SDA':        '#f97316',
  'OOM':        '#eab308',
  'HEICODERS':  '#22c55e',
  'ASK':        '#3b82f6',
  'EQUINET':    '#8b5cf6',
  'BELLS':      '#ec4899',
  'VERTICAL':   '#14b8a6',
  'HAPPY':      '#f59e0b',
}

function getProviderColor(abbrev: string): string {
  return PROVIDER_COLORS[abbrev] ?? '#6b7280'
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleDateString('en-SG', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
  }).toUpperCase()
}

// ─── Data fetching ───────────────────────────────────────────────────────────
async function getData() {
  const supabase = await createServiceClient()

  const [
    { data: courses },
    { data: providerSummaries },
    { data: alerts },
    { data: changes },
    { data: lastRefresh },
  ] = await Promise.all([
    supabase
      .from('sf_courses')
      .select('sf_ref_no, title, provider_name, category_text, popularity_score, has_active_runs, quality_rating, respondent_count, source_api_url, scraped_at, course_fee, course_mode')
      .order('popularity_score', { ascending: false })
      .limit(100),
    supabase
      .from('provider_summary')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .order('active_courses', { ascending: false }),
    supabase
      .from('market_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8),
    supabase
      .from('course_changes')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(15),
    supabase
      .from('data_refresh_logs')
      .select('*')
      .eq('source', 'myskillsfuture')
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return {
    courses: courses ?? [],
    providerSummaries: providerSummaries ?? [],
    alerts: alerts ?? [],
    changes: changes ?? [],
    lastRefresh,
  }
}

// ─── Page ────────────────────────────────────────────────────────────────────
export default async function DemandIntelligencePage() {
  const { courses, providerSummaries, alerts, changes, lastRefresh } = await getData()

  const hasData = courses.length > 0
  const now = new Date()
  const sgTime = now.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit',
    second: '2-digit', hour12: true,
  }).toUpperCase()

  const isStale = lastRefresh
    ? (now.getTime() - new Date(lastRefresh.completed_at).getTime()) > 30 * 60 * 60 * 1000
    : true

  // Deduplicate summaries — keep latest per provider
  const latestSummaryMap = new Map<string, typeof providerSummaries[0]>()
  for (const s of providerSummaries) {
    if (!latestSummaryMap.has(s.provider_name)) latestSummaryMap.set(s.provider_name, s)
  }
  const summaries = Array.from(latestSummaryMap.values())
    .sort((a, b) => (b.active_courses ?? 0) - (a.active_courses ?? 0))

  const top3 = courses.slice(0, 3)
  const maxScore = courses[0]?.popularity_score ?? 1

  // Category aggregation
  const catMap = new Map<string, { total: number; providers: Set<string>; topCourse: typeof courses[0] }>()
  for (const c of courses) {
    if (!c.category_text) continue
    const existing = catMap.get(c.category_text)
    if (!existing) {
      catMap.set(c.category_text, { total: c.popularity_score ?? 0, providers: new Set([c.provider_name]), topCourse: c })
    } else {
      existing.total += c.popularity_score ?? 0
      existing.providers.add(c.provider_name)
      if ((c.popularity_score ?? 0) > (existing.topCourse.popularity_score ?? 0)) existing.topCourse = c
    }
  }
  const categories = Array.from(catMap.entries())
    .map(([cat, data]) => ({ category: cat, ...data }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const totalSchedules = courses.reduce((s, c) => s + (c.popularity_score ?? 0), 0)
  const hustleRank = courses.findIndex((c) => c.provider_name.toLowerCase().includes('hustle')) + 1

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="border-b border-zinc-800 bg-[#0d0d0d] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-white font-bold text-lg tracking-widest">
            HUSTLE<span className="text-purple-400">/</span>INTEL
          </span>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
            DEMAND MONITORING · {courses.length} COURSES · {summaries.length} PROVIDERS
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          {lastRefresh && (
            <span>DATA: {formatDate(lastRefresh.completed_at).toUpperCase()}</span>
          )}
          {isStale && (
            <span className="text-yellow-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> STALE
            </span>
          )}
          <span className="text-zinc-400">{sgTime} SGT</span>
        </div>
      </div>

      {/* ── No data state ───────────────────────────────────────────────── */}
      {!hasData && (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Database className="w-12 h-12 text-zinc-700" />
          <div className="text-zinc-500 text-center">
            <div className="text-xl font-bold text-zinc-400 mb-2">DATA UNAVAILABLE</div>
            <div className="text-sm">No MySkillsFuture data collected yet.</div>
            <div className="text-sm mt-1">The daily cron runs at 7:00 AM SGT.</div>
            <div className="text-sm mt-3 text-zinc-600">
              Trigger manually:{' '}
              <code className="text-purple-400">GET /api/cron/myskillsfuture-refresh</code>
            </div>
          </div>
        </div>
      )}

      {hasData && (
        <div className="px-6 py-6 space-y-6">

          {/* ── Top 3 Podium ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => {
              const course = top3[i]
              if (!course) return (
                <div key={i} className="border border-zinc-800 rounded bg-zinc-900/30 p-4 flex items-center justify-center text-zinc-700 text-sm">
                  DATA_UNAVAILABLE
                </div>
              )
              const abbrev = getProviderAbbrev(course.provider_name)
              const color = getProviderColor(abbrev)
              const demand = getDemandLevel(course.popularity_score ?? 0)
              const medals = ['🥇', '🥈', '🥉']
              const borderColors = ['border-yellow-700', 'border-zinc-600', 'border-amber-800']
              const bgColors = ['bg-yellow-950/20', 'bg-zinc-900/30', 'bg-zinc-900/30']
              const isHustle = course.provider_name.toLowerCase().includes('hustle')
              return (
                <div key={i} className={`border rounded p-4 ${borderColors[i]} ${bgColors[i]} relative`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg">{medals[i]}</span>
                    <span className="text-xs text-zinc-600">#{i + 1} HIGHEST DEMAND</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="text-xs font-bold px-2 py-0.5 rounded"
                      style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}
                    >
                      {abbrev}
                    </span>
                    {isHustle && (
                      <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded font-bold">YOU</span>
                    )}
                  </div>
                  <div className="text-3xl font-bold text-white mb-0.5">{course.popularity_score ?? 0}</div>
                  <div className="text-xs text-zinc-500 mb-2">SCHEDULES</div>
                  <div className="text-sm text-zinc-300 leading-tight mb-2">
                    {course.source_api_url ? (
                      <Link href={course.source_api_url} target="_blank" className="hover:text-white flex items-start gap-1">
                        <span>{course.title}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      </Link>
                    ) : course.title}
                  </div>
                  {course.category_text && (
                    <div className="text-xs text-zinc-600">{course.category_text}</div>
                  )}
                  <div className={`mt-3 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${demand.bg} ${demand.color}`}>
                    {demand.emoji} {demand.label}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Main leaderboard ─────────────────────────────────────────── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold tracking-wider">SCHEDULE DEMAND LEADERBOARD</span>
              </div>
              <span className="text-xs text-zinc-600">
                {courses.length} COURSES · SORTED BY SCHEDULE VOLUME
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-600">
                    <th className="px-4 py-2 text-left w-12">RANK</th>
                    <th className="px-4 py-2 text-left">PROVIDER</th>
                    <th className="px-4 py-2 text-left">COURSE</th>
                    <th className="px-4 py-2 text-left">CATEGORY</th>
                    <th className="px-4 py-2 text-right">SCHEDULES</th>
                    <th className="px-4 py-2 text-right">DEMAND</th>
                    <th className="px-4 py-2 text-right">UPDATED</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((course, idx) => {
                    const abbrev = getProviderAbbrev(course.provider_name)
                    const color = getProviderColor(abbrev)
                    const demand = getDemandLevel(course.popularity_score ?? 0)
                    const isHustle = course.provider_name.toLowerCase().includes('hustle')
                    const barWidth = maxScore > 0 ? ((course.popularity_score ?? 0) / maxScore) * 100 : 0
                    return (
                      <tr
                        key={course.sf_ref_no}
                        className={`border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors ${isHustle ? 'bg-purple-950/20' : ''}`}
                      >
                        <td className="px-4 py-3 text-zinc-600 font-bold text-xs">{idx + 1}</td>

                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span
                              className="text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap"
                              style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}
                            >
                              {abbrev}
                            </span>
                            {isHustle && (
                              <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded font-bold">YOU</span>
                            )}
                          </div>
                        </td>

                        <td className="px-4 py-3 max-w-xs">
                          <div className="text-zinc-200 text-xs leading-snug mb-1.5">
                            {course.source_api_url ? (
                              <Link href={course.source_api_url} target="_blank" className="hover:text-white flex items-start gap-1">
                                <span>{course.title}</span>
                                <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              </Link>
                            ) : <span>{course.title}</span>}
                          </div>
                          <div className="w-full bg-zinc-800 rounded-full h-0.5 max-w-[200px]">
                            <div
                              className="h-0.5 rounded-full"
                              style={{ width: `${barWidth}%`, backgroundColor: color }}
                            />
                          </div>
                        </td>

                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                          {course.category_text ?? '—'}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <span className={`text-xl font-bold ${demand.color}`}>
                            {course.popularity_score ?? 0}
                          </span>
                          <span className="text-xs text-zinc-600 ml-1">SCHED</span>
                        </td>

                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${demand.bg} ${demand.color}`}>
                            {demand.emoji} {demand.label}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-right text-xs text-zinc-700 whitespace-nowrap">
                          {formatDate(course.scraped_at)}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bottom panels ─────────────────────────────────────────────── */}
          <div className="grid grid-cols-3 gap-4">

            {/* Category leaderboard */}
            <div className="border border-zinc-800 rounded">
              <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold tracking-wider">CATEGORY DEMAND</span>
              </div>
              <div className="divide-y divide-zinc-900">
                {categories.length === 0 ? (
                  <div className="px-4 py-8 text-center text-zinc-700 text-xs">DATA_UNAVAILABLE</div>
                ) : categories.map((cat, idx) => {
                  const share = totalSchedules > 0
                    ? (cat.total / totalSchedules * 100).toFixed(1)
                    : '0'
                  const abbrev = getProviderAbbrev(cat.topCourse.provider_name)
                  const color = getProviderColor(abbrev)
                  return (
                    <div key={cat.category} className="px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-zinc-600 font-bold">#{idx + 1}</span>
                            <span className="text-xs text-zinc-300 truncate">{cat.category}</span>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-zinc-600">
                            <span>{cat.providers.size} providers</span>
                            <span>·</span>
                            <span style={{ color }}>Top: {abbrev}</span>
                          </div>
                          <div className="mt-1.5 w-full bg-zinc-800 rounded-full h-0.5">
                            <div className="h-0.5 rounded-full bg-blue-500" style={{ width: `${share}%` }} />
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className="text-sm font-bold text-white">{cat.total}</div>
                          <div className="text-xs text-zinc-600">{share}%</div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Right column: alerts + provider intel */}
            <div className="col-span-2 space-y-4">

              {/* Market alerts */}
              <div className="border border-zinc-800 rounded">
                <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" />
                  <span className="text-sm font-bold tracking-wider">MARKET ALERTS</span>
                  {hustleRank > 0 && (
                    <span className="ml-auto text-xs text-zinc-600">HUSTLE RANKS #{hustleRank}</span>
                  )}
                </div>
                <div className="divide-y divide-zinc-900 max-h-56 overflow-y-auto">
                  {alerts.length === 0 && changes.length === 0 ? (
                    <div className="px-4 py-8 text-center text-zinc-700 text-xs">
                      DATA_UNAVAILABLE — alerts generated after first cron run
                    </div>
                  ) : null}
                  {alerts.map((alert, i) => {
                    const severityColor =
                      alert.severity === 'high' ? 'text-red-400' :
                      alert.severity === 'medium' ? 'text-yellow-400' : 'text-zinc-400'
                    const icon =
                      alert.alert_type === 'RAPID_EXPANSION' ? '🚨' :
                      alert.alert_type === 'MARKET_DOMINANCE' ? '⚠️' :
                      alert.alert_type === 'COMPETITOR_RETREAT' ? '📉' :
                      alert.alert_type === 'MARKET_OPPORTUNITY' ? '💡' : '📊'
                    return (
                      <div key={i} className="px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                        <div className="flex items-start gap-2">
                          <span>{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-zinc-200 leading-snug">{alert.title}</div>
                            {alert.description && (
                              <div className="text-xs text-zinc-600 mt-0.5 leading-snug line-clamp-2">
                                {alert.description}
                              </div>
                            )}
                          </div>
                          <span className={`text-xs font-bold flex-shrink-0 ${severityColor}`}>
                            {alert.severity?.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    )
                  })}
                  {changes.slice(0, 5).map((change, i) => (
                    <div key={`c-${i}`} className="px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex items-start gap-2">
                        <span>
                          {change.change_type === 'NEW_COURSE' ? '🆕' :
                           change.change_type === 'COURSE_REMOVED' ? '❌' :
                           change.change_type === 'PRICE_CHANGE' ? '💰' : '📅'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs text-zinc-200 truncate">{change.course_name}</div>
                          <div className="text-xs text-zinc-600">
                            {getProviderAbbrev(change.provider_name)} · {change.change_type?.replace(/_/g, ' ')}
                          </div>
                        </div>
                        <span className="text-xs text-zinc-700 whitespace-nowrap">{formatDate(change.detected_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Provider intelligence */}
              <div className="border border-zinc-800 rounded">
                <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-bold tracking-wider">PROVIDER INTELLIGENCE</span>
                </div>
                {summaries.length === 0 ? (
                  <div className="px-4 py-8 text-center text-zinc-700 text-xs">DATA_UNAVAILABLE</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-zinc-900 text-zinc-600">
                          <th className="px-4 py-2 text-left">PROVIDER</th>
                          <th className="px-4 py-2 text-right">ACTIVE</th>
                          <th className="px-4 py-2 text-right">TOTAL</th>
                          <th className="px-4 py-2 text-right">MKT SHARE</th>
                          <th className="px-4 py-2 text-right">NEW 7D</th>
                          <th className="px-4 py-2 text-left">TOP CATEGORY</th>
                        </tr>
                      </thead>
                      <tbody>
                        {summaries.map((s) => {
                          const abbrev = getProviderAbbrev(s.provider_name)
                          const color = getProviderColor(abbrev)
                          const isHustle = s.provider_name.toLowerCase().includes('hustle')
                          return (
                            <tr
                              key={s.provider_name}
                              className={`border-b border-zinc-900 hover:bg-zinc-900/40 ${isHustle ? 'bg-purple-950/20' : ''}`}
                            >
                              <td className="px-4 py-2">
                                <div className="flex items-center gap-1.5">
                                  <span
                                    className="font-bold px-1.5 py-0.5 rounded text-xs"
                                    style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}
                                  >
                                    {abbrev}
                                  </span>
                                  {isHustle && (
                                    <span className="bg-purple-600 text-white px-1 rounded text-xs font-bold">YOU</span>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-2 text-right font-bold text-white">{s.active_courses ?? 0}</td>
                              <td className="px-4 py-2 text-right text-zinc-500">{s.total_courses ?? 0}</td>
                              <td className="px-4 py-2 text-right text-zinc-400">{s.market_share_pct?.toFixed(1) ?? '0'}%</td>
                              <td className="px-4 py-2 text-right">
                                <span className={(s.new_courses_7d ?? 0) > 0 ? 'text-green-400 font-bold' : 'text-zinc-600'}>
                                  {(s.new_courses_7d ?? 0) > 0 ? `+${s.new_courses_7d}` : '—'}
                                </span>
                              </td>
                              <td className="px-4 py-2 text-zinc-500 max-w-[120px] truncate">{s.top_category ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>

          {/* ── Data validation footer ───────────────────────────────────── */}
          <div className="border border-zinc-800 rounded px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-700">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3" />
              <span>SOURCE: MySkillsFuture Portal · myskillsfuture.gov.sg</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {lastRefresh ? (
                <>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    LAST REFRESH: {formatDate(lastRefresh.completed_at)} {formatTime(lastRefresh.completed_at)}
                  </span>
                  <span>{lastRefresh.rows_collected ?? 0} COURSES COLLECTED</span>
                  <span className={isStale ? 'text-yellow-600' : 'text-green-600'}>
                    {isStale ? '⚠ STALE (>30H)' : '✓ FRESH'}
                  </span>
                </>
              ) : (
                <span className="text-yellow-600">⚠ NO REFRESH LOGGED — RUN CRON TO COLLECT DATA</span>
              )}
              <span>NEXT REFRESH: 07:00 SGT DAILY</span>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
