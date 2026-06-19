/**
 * MySkillsFuture Demand Intelligence — Redesigned
 *
 * KPIs:
 *   1. Available Courses per provider (has_active_runs = true)
 *   2. Top Courses by Attendees (respondent_count = "Number Attended" on MySkillsFuture)
 *   3. Top Courses by Upcoming Course Runs (upcoming_run_count from Solr doclist.numFound)
 *   4. Market demand by competitor
 *
 * Data source: Supabase only. Never scrapes on page load.
 * Attendee data: only shown when collected from MySkillsFuture (respondent_count).
 * If attendee data is 0 or null across all courses: ATTENDEE DATA UNAVAILABLE.
 */

import { createServiceClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { ExternalLink, AlertTriangle, TrendingUp, Target, Clock, Database, Zap, Shield, Trophy, Users, Calendar, BookOpen } from 'lucide-react'

export const revalidate = 300

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sfCourseUrl(sfRefNo: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${encodeURIComponent(sfRefNo)}`
}

function sfProviderUrl(providerName: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/portal-search/portal-search.html?keyword=${encodeURIComponent(providerName)}&trainingProviderName=${encodeURIComponent(providerName)}`
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
function fmtNum(n: number | null | undefined) {
  if (n == null) return '—'
  return n.toLocaleString()
}

// ─── Fallback aggregation from sf_courses ────────────────────────────────────

type SFCourseRaw = {
  sf_ref_no: string; title: string; provider_name: string
  category_text: string | null; has_active_runs: boolean
  respondent_count: number | null; upcoming_run_count: number | null
  scraped_at: string; course_fee: number | null; quality_rating: number | null
}

function buildSummariesFromCourses(allCourses: SFCourseRaw[]) {
  const byProvider = new Map<string, SFCourseRaw[]>()
  for (const c of allCourses) {
    const list = byProvider.get(c.provider_name) ?? []
    list.push(c)
    byProvider.set(c.provider_name, list)
  }
  const totalActive = allCourses.filter(c => c.has_active_runs).length

  return [...byProvider.entries()].map(([provider_name, courses]) => {
    const active = courses.filter(c => c.has_active_runs)
    const catCounts = new Map<string, number>()
    for (const c of active) {
      if (c.category_text) catCounts.set(c.category_text, (catCounts.get(c.category_text) ?? 0) + 1)
    }
    let top_category: string | null = null, topCount = 0
    for (const [cat, cnt] of catCounts) {
      if (cnt > topCount) { top_category = cat; topCount = cnt }
    }
    const totalAttendees = courses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const totalRunCount = courses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const topByAttendees = [...courses].sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))[0]
    const topByRuns = [...courses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))[0]

    return {
      provider_name,
      competitor_id: null,
      snapshot_date: null,
      total_courses: courses.length,
      active_courses: active.length,
      total_schedules: totalRunCount,
      total_run_count: totalRunCount,
      total_attendees: totalAttendees,
      top_category,
      top_category_count: topCount,
      avg_course_fee: null,
      new_courses_7d: 0,
      market_share_pct: totalActive > 0 ? Math.round((active.length / totalActive) * 1000) / 10 : 0,
      activity_score: active.length,
      top_course_by_attendees: topByAttendees?.title ?? null,
      top_course_by_runs: topByRuns?.title ?? null,
      top_course_attendees: topByAttendees?.respondent_count ?? 0,
      top_course_run_count: topByRuns?.upcoming_run_count ?? 0,
      last_updated: courses[0]?.scraped_at ?? null,
    }
  }).sort((a, b) => b.active_courses - a.active_courses)
}

// ─── Data fetching ────────────────────────────────────────────────────────────

async function getData() {
  const sb = await createServiceClient()

  const [
    { data: rawSummaries },
    { data: allCourses },
    { data: lastRefresh },
  ] = await Promise.all([
    sb.from('provider_summary')
      .select('*')
      .order('snapshot_date', { ascending: false })
      .order('active_courses', { ascending: false }),

    sb.from('sf_courses')
      .select('sf_ref_no,title,provider_name,category_text,has_active_runs,respondent_count,upcoming_run_count,scraped_at,course_fee,quality_rating')
      .eq('is_valid', true)
      .order('respondent_count', { ascending: false, nullsFirst: false })
      .limit(1000),

    sb.from('data_refresh_logs')
      .select('*')
      .eq('source', 'myskillsfuture')
      .eq('status', 'success')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  // Deduplicate provider_summary — latest snapshot per provider
  const seen = new Set<string>()
  const dbSummaries = (rawSummaries ?? []).filter(s => {
    if (seen.has(s.provider_name)) return false
    seen.add(s.provider_name)
    return true
  }).sort((a, b) => (b.active_courses ?? 0) - (a.active_courses ?? 0))

  const usingFallback = dbSummaries.length === 0 && (allCourses ?? []).length > 0
  const summaries = usingFallback
    ? buildSummariesFromCourses(allCourses ?? [])
    : dbSummaries

  const courses = allCourses ?? []

  // Check if attendee data is available
  const hasAttendeeData = courses.some(c => (c.respondent_count ?? 0) > 0)
  // Check if run count data is available
  const hasRunData = courses.some(c => (c.upcoming_run_count ?? 0) > 0)

  // Top courses by attendees (any course, all providers)
  const topByAttendees = [...courses]
    .filter(c => (c.respondent_count ?? 0) > 0)
    .sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    .slice(0, 20)

  // Top courses by run count
  const topByRuns = [...courses]
    .filter(c => (c.upcoming_run_count ?? 0) > 0)
    .sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    .slice(0, 20)

  // Per-provider top courses for the summary table
  const providerTopAttendees = new Map<string, typeof courses[0]>()
  const providerTopRuns = new Map<string, typeof courses[0]>()
  for (const c of courses) {
    const ea = providerTopAttendees.get(c.provider_name)
    if (!ea || (c.respondent_count ?? 0) > (ea.respondent_count ?? 0)) providerTopAttendees.set(c.provider_name, c)
    const er = providerTopRuns.get(c.provider_name)
    if (!er || (c.upcoming_run_count ?? 0) > (er.upcoming_run_count ?? 0)) providerTopRuns.set(c.provider_name, c)
  }

  // Hustle rank calculations
  const sortedByAvailable = [...summaries].sort((a, b) => (b.active_courses ?? 0) - (a.active_courses ?? 0))
  const sortedByRuns = [...summaries].sort((a, b) => (b.total_run_count ?? b.total_schedules ?? 0) - (a.total_run_count ?? a.total_schedules ?? 0))
  const sortedByAttendees = [...summaries].sort((a, b) => (b.total_attendees ?? 0) - (a.total_attendees ?? 0))

  function hustleRank(sorted: typeof summaries) {
    const idx = sorted.findIndex(s => s.provider_name.toLowerCase().includes('hustle'))
    return idx >= 0 ? idx + 1 : null
  }

  return {
    summaries,
    courses,
    topByAttendees,
    topByRuns,
    providerTopAttendees,
    providerTopRuns,
    hasAttendeeData,
    hasRunData,
    lastRefresh,
    usingFallback,
    hustleRankByAvailable: hustleRank(sortedByAvailable),
    hustleRankByRuns: hustleRank(sortedByRuns),
    hustleRankByAttendees: hustleRank(sortedByAttendees),
  }
}

// ─── Strategic Intelligence Generator ────────────────────────────────────────

function generateInsights(
  summaries: ReturnType<typeof buildSummariesFromCourses>,
  topByAttendees: { title: string; provider_name: string; respondent_count: number | null; upcoming_run_count: number | null }[],
  topByRuns: { title: string; provider_name: string; upcoming_run_count: number | null; respondent_count: number | null }[],
  hasAttendeeData: boolean,
  hasRunData: boolean,
) {
  const insights: { icon: string; type: 'threat' | 'opportunity' | 'insight'; level: 'HIGH' | 'MEDIUM' | 'LOW'; text: string }[] = []

  if (summaries.length === 0) return insights

  const top = summaries[0]
  const hustle = summaries.find(s => s.provider_name.toLowerCase().includes('hustle'))

  // Top provider dominance
  if (top.market_share_pct >= 20) {
    insights.push({
      icon: '⚠️',
      type: 'threat',
      level: 'HIGH',
      text: `${getProviderAbbrev(top.provider_name)} dominates available courses with ${top.active_courses} courses (${top.market_share_pct}% market share). Their ${top.top_category ?? 'core'} category is particularly strong.`,
    })
  }

  // Top attended course
  if (hasAttendeeData && topByAttendees[0]) {
    const c = topByAttendees[0]
    const abbrev = getProviderAbbrev(c.provider_name)
    insights.push({
      icon: '🏆',
      type: 'insight',
      level: 'HIGH',
      text: `${abbrev} owns the highest-attended course in the market — "${c.title}" with ${fmtNum(c.respondent_count)} attendees. Demand exceeds what course availability alone suggests.`,
    })
  }

  // Top run count course
  if (hasRunData && topByRuns[0]) {
    const c = topByRuns[0]
    const abbrev = getProviderAbbrev(c.provider_name)
    insights.push({
      icon: '📅',
      type: 'opportunity',
      level: 'HIGH',
      text: `"${c.title}" by ${abbrev} has ${fmtNum(c.upcoming_run_count)} upcoming course runs, indicating exceptionally strong operational demand and scheduling commitment.`,
    })
  }

  // Hustle position
  if (hustle) {
    const hustleRank = summaries.indexOf(hustle) + 1
    if (hustleRank > 3) {
      insights.push({
        icon: '🎯',
        type: 'opportunity',
        level: 'MEDIUM',
        text: `Hustle Institute ranks #${hustleRank} by available courses. Increasing active course listings in ${summaries[0].top_category ?? 'high-demand'} categories could close the gap with top competitors.`,
      })
    } else {
      insights.push({
        icon: '✅',
        type: 'insight',
        level: 'LOW',
        text: `Hustle Institute holds a top-${hustleRank} position by available courses. Sustaining and growing course run frequency will reinforce market presence.`,
      })
    }
  }

  // Providers with low attendees but high course count (supply > demand signal)
  for (const s of summaries.slice(0, 5)) {
    const avgAttendees = s.total_attendees > 0 && s.total_courses > 0
      ? Math.round(s.total_attendees / s.total_courses)
      : null
    if (avgAttendees !== null && s.active_courses > 20 && avgAttendees < 200) {
      insights.push({
        icon: '📊',
        type: 'insight',
        level: 'MEDIUM',
        text: `${getProviderAbbrev(s.provider_name)} runs ${s.active_courses} available courses but averages only ${fmtNum(avgAttendees)} attendees per course. Supply may exceed demand in their category mix.`,
      })
      break
    }
  }

  return insights.slice(0, 6)
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DemandIntelligencePage() {
  const {
    summaries, courses, topByAttendees, topByRuns,
    providerTopAttendees, providerTopRuns,
    hasAttendeeData, hasRunData, lastRefresh, usingFallback,
    hustleRankByAvailable, hustleRankByRuns, hustleRankByAttendees,
  } = await getData()

  const hasData = summaries.length > 0 || courses.length > 0
  const now = new Date()
  const sgTime = now.toLocaleString('en-SG', {
    timeZone: 'Asia/Singapore', hour: '2-digit', minute: '2-digit', hour12: true,
  }).toUpperCase()
  const isStale = lastRefresh
    ? now.getTime() - new Date(lastRefresh.completed_at).getTime() > 30 * 60 * 60 * 1000
    : true

  const totalAvailable = summaries.reduce((s, p) => s + (p.active_courses ?? 0), 0)
  const totalRunCount = summaries.reduce((s, p) => s + (p.total_run_count ?? p.total_schedules ?? 0), 0)
  const topRunCourse = topByRuns[0]
  const topAttendedCourse = topByAttendees[0]
  const maxAvailable = summaries[0]?.active_courses ?? 1
  const maxRuns = topByRuns[0]?.upcoming_run_count ?? 1

  const insights = generateInsights(summaries, topByAttendees, topByRuns, hasAttendeeData, hasRunData)
  const medals = ['🥇', '🥈', '🥉']
  const medalBorders = ['border-yellow-700', 'border-zinc-500', 'border-amber-800']
  const medalBgs = ['bg-yellow-950/20', 'bg-zinc-900/30', 'bg-amber-950/10']

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
            MYSKILLSFUTURE INTELLIGENCE · {summaries.length} PROVIDERS TRACKED
            {usingFallback && (
              <span className="ml-2 text-yellow-500 border border-yellow-800 bg-yellow-950/30 px-2 py-0.5 rounded">
                ⚠ FALLBACK MODE
              </span>
            )}
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
          </div>
        </div>
      )}

      {hasData && (
        <div className="px-6 py-6 space-y-6">

          {/* ── CHANGE 1+: KPI Cards ─── */}
          <div className="grid grid-cols-5 gap-3">

            {/* Available Courses */}
            <div className="border border-zinc-800 rounded bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-blue-400" />
                <span className="text-xs text-zinc-500 tracking-wider">AVAILABLE COURSES</span>
              </div>
              <div className="text-3xl font-bold text-white">{totalAvailable}</div>
              <div className="text-xs text-zinc-600 mt-1">courses with active schedules</div>
            </div>

            {/* Top Course Runs */}
            <div className="border border-zinc-800 rounded bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-xs text-zinc-500 tracking-wider">TOP COURSE RUNS</span>
              </div>
              {hasRunData && topRunCourse ? (
                <>
                  <div className="text-3xl font-bold text-green-400">{fmtNum(topRunCourse.upcoming_run_count)}</div>
                  <Link href={sfCourseUrl(topRunCourse.sf_ref_no)} target="_blank"
                    className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 mt-1 line-clamp-2 leading-snug">
                    {topRunCourse.title} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </Link>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-zinc-600">UNAVAILABLE</div>
                  <div className="text-xs text-zinc-700 mt-1">run scraper to collect</div>
                </>
              )}
            </div>

            {/* Top Attended Course */}
            <div className="border border-zinc-800 rounded bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Users className="w-4 h-4 text-orange-400" />
                <span className="text-xs text-zinc-500 tracking-wider">TOP ATTENDED COURSE</span>
              </div>
              {hasAttendeeData && topAttendedCourse ? (
                <>
                  <div className="text-3xl font-bold text-orange-400">{fmtNum(topAttendedCourse.respondent_count)}</div>
                  <Link href={sfCourseUrl(topAttendedCourse.sf_ref_no)} target="_blank"
                    className="text-xs text-zinc-400 hover:text-white flex items-center gap-1 mt-1 line-clamp-2 leading-snug">
                    {topAttendedCourse.title} <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </Link>
                </>
              ) : (
                <>
                  <div className="text-lg font-bold text-zinc-600">UNAVAILABLE</div>
                  <div className="text-xs text-zinc-700 mt-1">attendee data not collected</div>
                </>
              )}
            </div>

            {/* Providers Tracked */}
            <div className="border border-zinc-800 rounded bg-zinc-900/30 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-zinc-500 tracking-wider">PROVIDERS TRACKED</span>
              </div>
              <div className="text-3xl font-bold text-purple-400">{summaries.length}</div>
              <div className="text-xs text-zinc-600 mt-1">{courses.length} total courses indexed</div>
            </div>

            {/* Hustle Rank */}
            <div className="border border-purple-900 rounded bg-purple-950/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Trophy className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-purple-400 tracking-wider font-bold">HUSTLE RANK</span>
              </div>
              <div className="space-y-1">
                <div className="text-xs">
                  <span className="text-zinc-500">Available Courses:</span>{' '}
                  <span className="text-white font-bold">
                    {hustleRankByAvailable ? `#${hustleRankByAvailable}` : 'N/A'}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-zinc-500">Course Runs:</span>{' '}
                  <span className="text-white font-bold">
                    {hasRunData && hustleRankByRuns ? `#${hustleRankByRuns}` : 'N/A'}
                  </span>
                </div>
                <div className="text-xs">
                  <span className="text-zinc-500">By Attendees:</span>{' '}
                  <span className="text-white font-bold">
                    {hasAttendeeData && hustleRankByAttendees ? `#${hustleRankByAttendees}` : 'N/A'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* ── CHANGE 2 + 3: Top 3 podiums ─── */}
          <div className="grid grid-cols-2 gap-4">

            {/* CHANGE 2: Top 3 by Attendees */}
            <div className="border border-zinc-800 rounded">
              <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold tracking-wider">TOP 3 COURSES BY ATTENDEES</span>
                {!hasAttendeeData && (
                  <span className="ml-auto text-xs text-yellow-600 border border-yellow-800 px-2 py-0.5 rounded">ATTENDEE DATA UNAVAILABLE</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-0 divide-x divide-zinc-800">
                {[0, 1, 2].map(i => {
                  const c = topByAttendees[i]
                  if (!c || !hasAttendeeData) return (
                    <div key={i} className="p-4 flex flex-col items-center justify-center text-center min-h-[140px]">
                      <div className="text-zinc-700 text-xs">ATTENDEE DATA UNAVAILABLE</div>
                    </div>
                  )
                  const abbrev = getProviderAbbrev(c.provider_name)
                  const color = getColor(abbrev)
                  return (
                    <div key={i} className={`p-4 ${i === 0 ? 'bg-yellow-950/10' : ''}`}>
                      <div className="text-xs text-zinc-600 mb-1">{medals[i]} #{i + 1} ATTENDEES</div>
                      <div className="text-2xl font-bold text-orange-400 mb-1">{fmtNum(c.respondent_count)}</div>
                      <div className="text-xs text-zinc-500 mb-2">Attended</div>
                      <Link href={sfCourseUrl(c.sf_ref_no)} target="_blank"
                        className="text-xs text-zinc-200 hover:text-white flex items-start gap-1 mb-2 leading-snug">
                        <span className="line-clamp-2">{c.title}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      </Link>
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                        {abbrev}
                      </span>
                      {c.category_text && <div className="text-xs text-zinc-700 mt-1 truncate">{c.category_text}</div>}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* CHANGE 3: Top 3 by Upcoming Course Runs */}
            <div className="border border-zinc-800 rounded">
              <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-sm font-bold tracking-wider">TOP 3 COURSES BY UPCOMING RUNS</span>
                {!hasRunData && (
                  <span className="ml-auto text-xs text-yellow-600 border border-yellow-800 px-2 py-0.5 rounded">RUN DATA UNAVAILABLE</span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-0 divide-x divide-zinc-800">
                {[0, 1, 2].map(i => {
                  const c = topByRuns[i]
                  if (!c || !hasRunData) return (
                    <div key={i} className="p-4 flex flex-col items-center justify-center text-center min-h-[140px]">
                      <div className="text-zinc-700 text-xs">RUN DATA UNAVAILABLE</div>
                      <div className="text-zinc-800 text-xs mt-1">Requires scraper re-run</div>
                    </div>
                  )
                  const abbrev = getProviderAbbrev(c.provider_name)
                  const color = getColor(abbrev)
                  return (
                    <div key={i} className={`p-4 ${i === 0 ? 'bg-green-950/10' : ''}`}>
                      <div className="text-xs text-zinc-600 mb-1">{medals[i]} #{i + 1} COURSE RUNS</div>
                      <div className="text-2xl font-bold text-green-400 mb-1">{fmtNum(c.upcoming_run_count)}</div>
                      <div className="text-xs text-zinc-500 mb-2">Course Runs</div>
                      <Link href={sfCourseUrl(c.sf_ref_no)} target="_blank"
                        className="text-xs text-zinc-200 hover:text-white flex items-start gap-1 mb-2 leading-snug">
                        <span className="line-clamp-2">{c.title}</span>
                        <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      </Link>
                      <span className="text-xs font-bold px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                        {abbrev}
                      </span>
                      {c.category_text && <div className="text-xs text-zinc-700 mt-1 truncate">{c.category_text}</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── CHANGE 4: Top Courses by Course Runs leaderboard ─── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-green-400" />
                <span className="text-sm font-bold tracking-wider">TOP COURSES BY COURSE RUNS</span>
              </div>
              <span className="text-xs text-zinc-600">SORTED BY UPCOMING RUNS DESC</span>
            </div>
            {!hasRunData ? (
              <div className="px-4 py-8 text-center text-zinc-600 text-sm">
                RUN DATA UNAVAILABLE — requires scraper re-run to capture upcoming_run_count
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-600">
                      <th className="px-4 py-2 text-left w-10">RANK</th>
                      <th className="px-4 py-2 text-left">PROVIDER</th>
                      <th className="px-4 py-2 text-left">COURSE</th>
                      <th className="px-4 py-2 text-left">CATEGORY</th>
                      <th className="px-4 py-2 text-right">COURSE RUNS</th>
                      <th className="px-4 py-2 text-right">ATTENDEES</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByRuns.map((c, idx) => {
                      const abbrev = getProviderAbbrev(c.provider_name)
                      const color = getColor(abbrev)
                      return (
                        <tr key={c.sf_ref_no} className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                          <td className="px-4 py-2 text-zinc-600 font-bold">{idx + 1}</td>
                          <td className="px-4 py-2">
                            <Link href={sfProviderUrl(c.provider_name)} target="_blank">
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80"
                                style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                                {abbrev}
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-2 max-w-xs">
                            <Link href={sfCourseUrl(c.sf_ref_no)} target="_blank"
                              className="text-zinc-200 hover:text-white flex items-start gap-1">
                              <span className="line-clamp-2 leading-snug">{c.title}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-zinc-500 max-w-[140px] truncate">{c.category_text ?? '—'}</td>
                          <td className="px-4 py-2 text-right font-bold text-green-400">{fmtNum(c.upcoming_run_count)}</td>
                          <td className="px-4 py-2 text-right text-zinc-400">
                            {(c.respondent_count ?? 0) > 0 ? fmtNum(c.respondent_count) : <span className="text-zinc-700">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── CHANGE 5: Top Courses by Attendees leaderboard ─── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-orange-400" />
                <span className="text-sm font-bold tracking-wider">TOP COURSES BY ATTENDEES</span>
              </div>
              <span className="text-xs text-zinc-600">SORTED BY ATTENDEE COUNT DESC</span>
            </div>
            {!hasAttendeeData ? (
              <div className="px-4 py-8 text-center text-zinc-600 text-sm">
                ATTENDEE DATA UNAVAILABLE — only displayed when collected from MySkillsFuture
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-600">
                      <th className="px-4 py-2 text-left w-10">RANK</th>
                      <th className="px-4 py-2 text-left">PROVIDER</th>
                      <th className="px-4 py-2 text-left">COURSE</th>
                      <th className="px-4 py-2 text-left">CATEGORY</th>
                      <th className="px-4 py-2 text-right">ATTENDEES</th>
                      <th className="px-4 py-2 text-right">COURSE RUNS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topByAttendees.map((c, idx) => {
                      const abbrev = getProviderAbbrev(c.provider_name)
                      const color = getColor(abbrev)
                      return (
                        <tr key={c.sf_ref_no} className="border-b border-zinc-900 hover:bg-zinc-900/50 transition-colors">
                          <td className="px-4 py-2 text-zinc-600 font-bold">{idx + 1}</td>
                          <td className="px-4 py-2">
                            <Link href={sfProviderUrl(c.provider_name)} target="_blank">
                              <span className="text-xs font-bold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80"
                                style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                                {abbrev}
                              </span>
                            </Link>
                          </td>
                          <td className="px-4 py-2 max-w-xs">
                            <Link href={sfCourseUrl(c.sf_ref_no)} target="_blank"
                              className="text-zinc-200 hover:text-white flex items-start gap-1">
                              <span className="line-clamp-2 leading-snug">{c.title}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            </Link>
                          </td>
                          <td className="px-4 py-2 text-zinc-500 max-w-[140px] truncate">{c.category_text ?? '—'}</td>
                          <td className="px-4 py-2 text-right font-bold text-orange-400">{fmtNum(c.respondent_count)}</td>
                          <td className="px-4 py-2 text-right text-zinc-400">
                            {(c.upcoming_run_count ?? 0) > 0 ? fmtNum(c.upcoming_run_count) : <span className="text-zinc-700">—</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── CHANGE 6: Competitor Summary Table ─── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-400" />
              <span className="text-sm font-bold tracking-wider">COMPETITOR SUMMARY</span>
              <span className="ml-auto text-xs text-zinc-600">ALL PROVIDERS · RANKED BY AVAILABLE COURSES</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-600">
                    <th className="px-4 py-2 text-left w-8">#</th>
                    <th className="px-4 py-2 text-left">PROVIDER</th>
                    <th className="px-4 py-2 text-right">AVAILABLE COURSES</th>
                    <th className="px-4 py-2 text-right">TOTAL ATTENDEES</th>
                    <th className="px-4 py-2 text-right">TOTAL RUNS</th>
                    <th className="px-4 py-2 text-left">TOP COURSE BY ATTENDEES</th>
                    <th className="px-4 py-2 text-left">TOP COURSE BY RUNS</th>
                    <th className="px-4 py-2 text-right">MKT SHARE</th>
                  </tr>
                </thead>
                <tbody>
                  {summaries.map((s, idx) => {
                    const abbrev = getProviderAbbrev(s.provider_name)
                    const color = getColor(abbrev)
                    const isHustle = s.provider_name.toLowerCase().includes('hustle')
                    const topAttCourse = providerTopAttendees.get(s.provider_name)
                    const topRunCourse = providerTopRuns.get(s.provider_name)
                    const totalRunCount = s.total_run_count ?? s.total_schedules ?? 0
                    const totalAttendees = s.total_attendees ?? 0
                    return (
                      <tr key={s.provider_name}
                        className={`border-b border-zinc-900 hover:bg-zinc-900/40 transition-colors ${isHustle ? 'bg-purple-950/20' : ''}`}>
                        <td className="px-4 py-3 text-zinc-600 font-bold">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <Link href={sfProviderUrl(s.provider_name)} target="_blank">
                              <span className="font-bold px-1.5 py-0.5 rounded cursor-pointer hover:opacity-80"
                                style={{ backgroundColor: color + '22', color, border: `1px solid ${color}55` }}>
                                {abbrev}
                              </span>
                            </Link>
                            {isHustle && <span className="bg-purple-600 text-white px-1 rounded font-bold">YOU</span>}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-base font-bold text-white">{s.active_courses ?? 0}</span>
                          <span className="text-zinc-600 ml-1">/ {s.total_courses ?? 0}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {totalAttendees > 0
                            ? <span className="text-orange-400 font-bold">{fmtNum(totalAttendees)}</span>
                            : <span className="text-zinc-700">UNAVAILABLE</span>
                          }
                        </td>
                        <td className="px-4 py-3 text-right">
                          {totalRunCount > 0
                            ? <span className="text-green-400 font-bold">{fmtNum(totalRunCount)}</span>
                            : <span className="text-zinc-700">—</span>
                          }
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          {topAttCourse && hasAttendeeData ? (
                            <Link href={sfCourseUrl(topAttCourse.sf_ref_no)} target="_blank"
                              className="text-zinc-300 hover:text-white flex items-start gap-1">
                              <span className="line-clamp-2 leading-snug">{topAttCourse.title}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            </Link>
                          ) : <span className="text-zinc-700">UNAVAILABLE</span>}
                        </td>
                        <td className="px-4 py-3 max-w-[180px]">
                          {topRunCourse && hasRunData ? (
                            <Link href={sfCourseUrl(topRunCourse.sf_ref_no)} target="_blank"
                              className="text-zinc-300 hover:text-white flex items-start gap-1">
                              <span className="line-clamp-2 leading-snug">{topRunCourse.title}</span>
                              <ExternalLink className="w-3 h-3 flex-shrink-0 mt-0.5" />
                            </Link>
                          ) : <span className="text-zinc-700">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-zinc-400">
                          {s.market_share_pct != null ? `${s.market_share_pct}%` : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── CHANGE 7: Strategic Intelligence ─── */}
          <div className="border border-zinc-800 rounded">
            <div className="border-b border-zinc-800 px-4 py-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-yellow-400" />
              <span className="text-sm font-bold tracking-wider">STRATEGIC INTELLIGENCE</span>
            </div>
            {insights.length === 0 ? (
              <div className="px-4 py-8 text-center text-zinc-700 text-sm">
                Intelligence available after first full cron run with attendee + run data
              </div>
            ) : (
              <div className="divide-y divide-zinc-900">
                {insights.map((ins, i) => {
                  const typeColors: Record<string, string> = {
                    threat: 'text-red-400 border-red-900 bg-red-950/20',
                    opportunity: 'text-green-400 border-green-900 bg-green-950/20',
                    insight: 'text-blue-400 border-blue-900 bg-blue-950/20',
                  }
                  const levelColors: Record<string, string> = {
                    HIGH: 'text-red-400',
                    MEDIUM: 'text-yellow-400',
                    LOW: 'text-zinc-500',
                  }
                  return (
                    <div key={i} className="px-4 py-4 hover:bg-zinc-900/40 transition-colors">
                      <div className="flex items-start gap-3">
                        <span className="text-lg flex-shrink-0">{ins.icon}</span>
                        <div className="flex-1">
                          <p className="text-sm text-zinc-200 leading-relaxed">{ins.text}</p>
                        </div>
                        <div className="flex-shrink-0 flex flex-col items-end gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded border capitalize ${typeColors[ins.type]}`}>
                            {ins.type.toUpperCase()}
                          </span>
                          <span className={`text-xs font-bold ${levelColors[ins.level]}`}>
                            {ins.level}
                          </span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Data validation footer ─── */}
          <div className="border border-zinc-800 rounded px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-700">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3" />
              <span>SOURCE: MySkillsFuture · myskillsfuture.gov.sg · Attendee counts = "Number Attended" from SF course pages · Run counts from Solr grouped API</span>
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
              <span>NEXT REFRESH: 09:00 SGT (01:00 UTC) DAILY</span>
            </div>
          </div>

        </div>
      )}
    </div>
  )
}
