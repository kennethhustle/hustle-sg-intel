/**
 * MySkillsFuture Demand Intelligence
 *
 * Reads ONLY from Supabase — never scrapes on page load.
 * Daily cron at 7am SGT: /api/cron/myskillsfuture-refresh
 *
 * Primary metric: active_courses per provider (courses with live scheduled runs).
 * Course URLs: built from sf_ref_no → myskillsfuture.gov.sg course-detail page.
 */

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ExternalLink, AlertTriangle, TrendingUp, Target, Clock, Database, Zap, Shield } from 'lucide-react'

export const revalidate = 300

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Direct link to a course on MySkillsFuture */
function sfCourseUrl(sfRefNo: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${encodeURIComponent(sfRefNo)}`
}

/** Direct search link for a provider on MySkillsFuture */
function sfProviderUrl(providerName: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/portal-search/portal-search.html?keyword=${encodeURIComponent(providerName)}&trainingProviderName=${encodeURIComponent(providerName)}`
}

function getDemandLevel(activeCourses: number): {
  label: string; emoji: string; color: string; bg: string
} {
  if (activeCourses >= 100) return { label: 'EXTREME',   emoji: '🔥', color: 'text-red-400',    bg: 'bg-red-950/60 border-red-800' }
  if (activeCourses >= 50)  return { label: 'VERY HIGH', emoji: '🔥', color: 'text-orange-400', bg: 'bg-orange-950/60 border-orange-800' }
  if (activeCourses >= 20)  return { label: 'HIGH',      emoji: '⚡', color: 'text-yellow-400', bg: 'bg-yellow-950/60 border-yellow-800' }
  if (activeCourses >= 10)  return { label: 'MEDIUM',    emoji: '📈', color: 'text-blue-400',   bg: 'bg-blue-950/60 border-blue-800' }
  if (activeCourses >= 1)   return { label: 'LOW',       emoji: '📉', color: 'text-zinc-400',   bg: 'bg-zinc-900/60 border-zinc-700' }
  return                         { label: 'INACTIVE',  emoji: '⚪', color: 'text-zinc-600',   bg: 'bg-zinc-950/60 border-zinc-800' }
}

function getProviderAbbrev(name: string): string {
  const map: Record<string, string> = {
    'BELLS':      'BELLS',
    'Vertical':   'VERTICAL',
    'OOm':        'OOM',
    'Skills Dev': 'SDA',
    'InfoTech':   'INFOTECH',
    'Info-Tech':  'INFOTECH',
    'ASK':        'ASK',
    'Heicoders':  'HEICODERS',
    'Happy':      'HAPPY',
    'Equinet':    'EQUINET',
    'Hustle':     'HUSTLE SG',
  }
  for (const [key, abbrev] of Object.entries(map)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return abbrev
  }
  return name.slice(0, 8).toUpperCase()
}

const PROVIDER_COLORS: Record<string, string> = {
  'HUSTLE SG': '#a855f7',
  'INFOTECH':  '#ef4444',
  'SDA':       '#f97316',
  'OOM':       '#eab308',
  'HEICODERS': '#22c55e',
  'ASK':       '#3b82f6',
  'EQUINET':   '#8b5cf6',
  'BELLS':     '#ec4899',
  'VERTICAL':  '#14b8a6',
  'HAPPY':     '#f59e0b',
}
function getColor(abbrev: string) { return PROVIDER_COLORS[abbrev] ?? '#6b7280' }

function fmtDate(iso?: string | null) {
  if (!iso) return 'Unknown'
  return new Date(iso).toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' })
}
function fmtTime(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore',
  }).toUpperCase()
}

// ─── Data ─────────────────────────────────────────────────────────────────────
async function getData() {
  const sb = await createServiceClient()
  const [
    { data: rawSummaries },
    { data: courses },
    { data: alerts },
    { data: changes },
    { data: lastRefresh },
  ] = await Promise.all([
    // Provider summary — ordered by active courses desc
    sb.from('provider_summary')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .order('active_courses',  { ascending: false }),

    // All SF courses — for top-course-per-provider lookup + category breakdown
    sb.from('sf_courses')
      .select('sf_ref_no, title, provider_name, category_text, has_active_runs, quality_rating, respondent_count, scraped_at, course_fee')
      .eq('has_active_runs', true)
      .order('respondent_count', { ascending: false })
      .limit(500),

    sb.from('market_alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(8),

    sb.from('course_changes')
      .select('*')
      .order('detected_at', { ascending: false })
      .limit(10),

    sb.from('data_refresh_logs')
      .select('*')
      .eq('source', 'myskillsfuture')
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Deduplicate summaries — keep latest snapshot per provider
  const seen = new Set<string>()
  const summaries = (rawSummaries ?? []).filter((s) => {
    if (seen.has(s.provider_name)) return false
    seen.add(s.provider_name)
    return true
  }).sort((a, b) => (b.active_courses ?? 0) - (a.active_courses ?? 0))

  // Build top-course map per provider (highest respondent_count among active courses)
  const topCourseMap = new Map<string, typeof courses[0]>()
  for (const c of courses ?? []) {
    const existing = topCourseMap.get(c.provider_name)
    if (!existing || (c.respondent_count ?? 0) > (existing.respondent_count ?? 0)) {
      topCourseMap.set(c.provider_name, c)
    }
  }

  return { summaries, courses: courses ?? [], topCourseMap, alerts: alerts ?? [], changes: changes ?? [], lastRefresh }
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function DemandIntelligencePage() {
  const { summaries, courses, topCourseMap, alerts, changes, lastRefresh } = await getData()

  const hasData = summaries.length > 0
  const now = new Date()
  const sgTime = now.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
  }).toUpperCase()

  const isStale = lastRefresh
    ? now.getTime() - new Date(lastRefresh.completed_at).getTime() > 30 * 60 * 60 * 1000
    : true

  const top3     = summaries.slice(0, 3)
  const maxCount = summaries[0]?.active_courses ?? 1
  const totalActive = summaries.reduce((s, p) => s + (p.active_courses ?? 0), 0)
  const hustleRank  = summaries.findIndex((s) => s.provider_name.toLowerCase().includes('hustle')) + 1

  // Category breakdown from active courses
  const catMap = new Map<string, { total: number; providers: Set<string> }>()
  for (const c of courses) {
    if (!c.category_text) continue
    const e = catMap.get(c.category_text)
    if (!e) { catMap.set(c.category_text, { total: 1, providers: new Set([c.provider_name]) }) }
    else { e.total++; e.providers.add(c.provider_name) }
  }
  const categories = [...catMap.entries()]
    .map(([cat, d]) => ({ category: cat, ...d }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white font-mono">

      {/* ── Header ─── */}
      <div className="border-b border-zinc-800 bg-[#0d0d0d] px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span className="text-white font-bold text-lg tracking-widest">
            HUSTLE<span className="text-purple-400">/</span>INTEL
          </span>
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse inline-block" />
            DEMAND MONITORING · {totalActive} ACTIVE COURSES · {summaries.length} PROVIDERS
          </div>
        </div>
        <div className="flex items-center gap-4 text-xs text-zinc-500">
          {lastRefresh && <span>DATA: {fmtDate(lastRefresh.completed_at).toUpperCase()}</span>}
          {isStale && <span className="text-yellow-500 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> STALE</span>}
          <span className="text-zinc-400">{sgTime} SGT</span>
        </div>
      </div>

      {/* ── No data ─── */}
      {!hasData && (
        <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
          <Database className="w-12 h-12 text-zinc-700" />
          <div className="text-zinc-500 text-center">
            <div className="text-xl font-bold text-zinc-400 mb-2">DATA UNAVAILABLE</div>
            <div className="text-sm">No MySkillsFuture data collected yet.</div>
            <div className="text-sm mt-1">Daily cron runs at 7:00 AM SGT.</div>
            <div className="mt-3 text-xs text-zinc-600">
              Trigger manually: <code className="text-purple-400">GET /api/cron/myskillsfuture-refresh</code>
            </div>
          </div>
        </div>
      )}

      {hasData && (
        <div className="px-6 py-6 space-y-6">

          {/* ── Top 3 Podium ─── */}
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => {
              const p = top3[i]
              if (!p) return (
                <div key={i} className="border border-zinc-800 rounded bg-zinc-900/30 p-4 flex items-center justify-center text-zinc-700 text-sm">
                  DATA_UNAVAILABLE
                </div>
              )
              const abbrev   = getProviderAbbrev(p.provider_name)
              const color    = getColor(abbrev)
              const demand   = getDemandLevel(p.active_courses ?? 0)
              const topCourse = topCourseMap.get(p.provider_name)
              const medals   = ['🥇', '🥈', '🥉']
              const borders  = ['border-yellow-700', 'border-zinc-600', 'border-amber-800']
              const bgs      = ['bg-yellow-950/20', 'bg-zinc-900/30', 'bg-zinc-900/30']
              const isHustle = p.provider_name.toLowerCase().includes('hustle')
              return (
                <div key={i} className={`border rounded p-4 ${borders[i]} ${bgs[i]}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-lg">{medals[i]}</span>
                    <span className="text-xs text-zinc-600">#{i + 1} HIGHEST DEMAND</span>
                  </div>
                  <div className="flex items-center gap-2 mb-2">
                    <Link href={sfProviderUrl(p.provider_name)} target="_blank">
                      <span
                        className="text-xs font-bold px-2 py-0.5 rounded cursor-pointer hover:opacity-80"
                        style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}
                      >
                        {abbrev}
                      </span>
                    </Link>
                    {isHustle && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded font-bold">YOU</span>}
                  </div>
                  <div className="text-3xl font-bold text-white mb-0.5">{p.active_courses ?? 0}</div>
                  <div className="text-xs text-zinc-500 mb-3">ACTIVE SCHEDULED COURSES</div>
                  {topCourse ? (
                    <Link href={sfCourseUrl(topCourse.sf_ref_no)} target="_blank"
                      className="flex items-start gap-1 text-xs text-zinc-400 hover:text-white transition-colors mb-2">
                      <span className="leading-snug">Top: {topCourse.title}</span>
                      <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                    </Link>
                  ) : (
                    <div className="text-xs text-zinc-700 mb-2">Top course: DATA_UNAVAILABLE</div>
                  )}
                  {p.top_category && <div className="text-xs text-zinc-600 mb-3">{p.top_category}</div>}
                  <div className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded border ${demand.bg} ${demand.color}`}>
                    {demand.emoji} {demand.label}
                  </div>
                </div>
              )
            })}
          </div>

          {/* ── Provider Leaderboard ─── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold tracking-wider">ACTIVE SCHEDULE LEADERBOARD</span>
              </div>
              <span className="text-xs text-zinc-600">
                {summaries.length} COMPETITORS · RANKED BY COURSES WITH ACTIVE SCHEDULES
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800 text-xs text-zinc-600">
                    <th className="px-4 py-2 text-left w-12">RANK</th>
                    <th className="px-4 py-2 text-left">PROVIDER</th>
                    <th className="px-4 py-2 text-left">TOP COURSE</th>
                    <th className="px-4 py-2 text-left">TOP CATEGORY</th>
                    <th className="px-4 py-2 text-right">ACTIVE COURSES</th>
                    <th className="px-4 py-2 text-right">MKT SHARE</th>
                    <th className="px-4 py-2 text-right">DEMAND</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((p, idx) => {
                    const abbrev    = getProviderAbbrev(p.provider_name)
                    const color     = getColor(abbrev)
                    const demand    = getDemandLevel(p.active_courses ?? 0)
                    const isHustle  = p.provider_name.toLowerCase().includes('hustle')
                    const topCourse = topCourseMap.get(p.provider_name)
                    const barWidth  = maxCount > 0 ? ((p.active_courses ?? 0) / maxCount) * 100 : 0
                    return (
                      <tr key={p.provider_name}
                        className={`border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors ${isHustle ? 'bg-purple-950/20' : ''}`}>

                        <td className="px-4 py-3 text-zinc-600 font-bold text-xs">{idx + 1}</td>

                        {/* Provider badge */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Link href={sfProviderUrl(p.provider_name)} target="_blank">
                              <span
                                className="text-xs font-bold px-2 py-0.5 rounded whitespace-nowrap cursor-pointer hover:opacity-80"
                                style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}
                              >
                                {abbrev}
                              </span>
                            </Link>
                            {isHustle && <span className="text-xs bg-purple-600 text-white px-1.5 py-0.5 rounded font-bold">YOU</span>}
                          </div>
                        </td>

                        {/* Top course with direct URL */}
                        <td className="px-4 py-3 max-w-xs">
                          {topCourse ? (
                            <>
                              <Link href={sfCourseUrl(topCourse.sf_ref_no)} target="_blank"
                                className="text-zinc-200 text-xs hover:text-white flex items-start gap-1 leading-snug mb-1.5">
                                <span>{topCourse.title}</span>
                                <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                              </Link>
                              <div className="w-full bg-zinc-800 rounded-full h-0.5 max-w-[200px]">
                                <div className="h-0.5 rounded-full" style={{ width: `${barWidth}%`, backgroundColor: color }} />
                              </div>
                            </>
                          ) : (
                            <span className="text-zinc-700 text-xs">DATA_UNAVAILABLE</span>
                          )}
                        </td>

                        {/* Category */}
                        <td className="px-4 py-3 text-xs text-zinc-500 whitespace-nowrap">
                          {p.top_category ?? '—'}
                        </td>

                        {/* Active course count */}
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xl font-bold ${demand.color}`}>{p.active_courses ?? 0}</span>
                          <span className="text-xs text-zinc-600 ml-1">COURSES</span>
                        </td>

                        {/* Market share */}
                        <td className="px-4 py-3 text-right text-xs text-zinc-400">
                          {p.market_share_pct != null ? `${p.market_share_pct.toFixed(1)}%` : '—'}
                        </td>

                        {/* Demand level */}
                        <td className="px-4 py-3 text-right">
                          <span className={`text-xs px-2 py-0.5 rounded border whitespace-nowrap ${demand.bg} ${demand.color}`}>
                            {demand.emoji} {demand.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Bottom panels ─── */}
          <div className="grid grid-cols-3 gap-4">

            {/* Category demand */}
            <div className="border border-zinc-800 rounded">
              <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                <Target className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-bold tracking-wider">CATEGORY DEMAND</span>
              </div>
              <div className="divide-y divide-zinc-900">
                {categories.length === 0 ? (
                  <div className="px-4 py-8 text-center text-zinc-700 text-xs">DATA_UNAVAILABLE</div>
                ) : categories.map((cat, idx) => {
                  const share = courses.length > 0 ? (cat.total / courses.length * 100).toFixed(1) : '0'
                  return (
                    <div key={cat.category} className="px-4 py-3 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs text-zinc-600 font-bold">#{idx + 1}</span>
                            <span className="text-xs text-zinc-300 truncate">{cat.category}</span>
                          </div>
                          <div className="text-xs text-zinc-600">{cat.providers.size} providers</div>
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

            {/* Alerts + Provider intel */}
            <div className="col-span-2 space-y-4">

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
                    const sc = alert.severity === 'high' ? 'text-red-400' : alert.severity === 'medium' ? 'text-yellow-400' : 'text-zinc-400'
                    const icon = alert.alert_type === 'RAPID_EXPANSION' ? '🚨' : alert.alert_type === 'MARKET_DOMINANCE' ? '⚠️' : alert.alert_type === 'COMPETITOR_RETREAT' ? '📉' : '💡'
                    return (
                      <div key={i} className="px-4 py-3 hover:bg-zinc-900/40">
                        <div className="flex items-start gap-2">
                          <span>{icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-zinc-200 leading-snug">{alert.title}</div>
                            {alert.description && <div className="text-xs text-zinc-600 mt-0.5 line-clamp-2">{alert.description}</div>}
                          </div>
                          <span className={`text-xs font-bold flex-shrink-0 ${sc}`}>{alert.severity?.toUpperCase()}</span>
                        </div>
                      </div>
                    )
                  })}
                  {changes.map((change, i) => (
                    <div key={`c-${i}`} className="px-4 py-3 hover:bg-zinc-900/40">
                      <div className="flex items-start gap-2">
                        <span>{change.change_type === 'NEW_COURSE' ? '🆕' : change.change_type === 'COURSE_REMOVED' ? '❌' : change.change_type === 'PRICE_CHANGE' ? '💰' : '📅'}</span>
                        <div className="flex-1 min-w-0">
                          {change.sf_ref_no ? (
                            <Link href={sfCourseUrl(change.sf_ref_no)} target="_blank"
                              className="text-xs text-zinc-200 hover:text-white flex items-center gap-1">
                              <span className="truncate">{change.course_name}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0" />
                            </Link>
                          ) : (
                            <div className="text-xs text-zinc-200 truncate">{change.course_name}</div>
                          )}
                          <div className="text-xs text-zinc-600">{getProviderAbbrev(change.provider_name)} · {change.change_type?.replace(/_/g, ' ')}</div>
                        </div>
                        <span className="text-xs text-zinc-700 whitespace-nowrap">{fmtDate(change.detected_at)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-zinc-800 rounded">
                <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-bold tracking-wider">PROVIDER INTELLIGENCE</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-900 text-zinc-600">
                        <th className="px-4 py-2 text-left">PROVIDER</th>
                        <th className="px-4 py-2 text-right">ACTIVE</th>
                        <th className="px-4 py-2 text-right">TOTAL</th>
                        <th className="px-4 py-2 text-right">MKT %</th>
                        <th className="px-4 py-2 text-right">NEW 7D</th>
                        <th className="px-4 py-2 text-left">TOP CATEGORY</th>
                      </tr>
                    </thead>
                    <tbody>
                      {summaries.map((s) => {
                        const abbrev   = getProviderAbbrev(s.provider_name)
                        const color    = getColor(abbrev)
                        const isHustle = s.provider_name.toLowerCase().includes('hustle')
                        return (
                          <tr key={s.provider_name}
                            className={`border-b border-zinc-900 hover:bg-zinc-900/40 ${isHustle ? 'bg-purple-950/20' : ''}`}>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5">
                                <Link href={sfProviderUrl(s.provider_name)} target="_blank">
                                  <span className="font-bold px-1.5 py-0.5 rounded text-xs cursor-pointer hover:opacity-80"
                                    style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                                    {abbrev}
                                  </span>
                                </Link>
                                {isHustle && <span className="bg-purple-600 text-white px-1 rounded text-xs font-bold">YOU</span>}
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
              </div>

            </div>
          </div>

          {/* ── Data validation footer ─── */}
          <div className="border border-zinc-800 rounded px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-700">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3" />
              <span>SOURCE: MySkillsFuture Portal · myskillsfuture.gov.sg · Course URLs verified via courseReferenceNumber</span>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {lastRefresh ? (
                <>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    LAST REFRESH: {fmtDate(lastRefresh.completed_at)} {fmtTime(lastRefresh.completed_at)}
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
