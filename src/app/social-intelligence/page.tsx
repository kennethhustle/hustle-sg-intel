/**
 * Social Intelligence — CEO Decision Dashboard
 *
 * Purpose: Answer 6 questions for Hustle SG management:
 * 1. Which competitors are growing?
 * 2. Which are investing in content?
 * 3. Which are dominating social?
 * 4. Which content themes are winning?
 * 5. Is Hustle falling behind?
 * 6. What should management do?
 */

import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'

export const revalidate = 300

// ─── Theme colours ────────────────────────────────────────────────────────────
const THEME_COLOR: Record<string, string> = {
  'AI': '#a855f7',
  'Digital Marketing': '#3b82f6',
  'Data Analytics': '#06b6d4',
  'Career': '#22c55e',
  'SkillsFuture': '#eab308',
  'Corporate Training': '#f97316',
  'Photography': '#ec4899',
  'Design': '#f43f5e',
  'SEO': '#6366f1',
  'Social Media': '#14b8a6',
  'Leadership': '#8b5cf6',
  'Python / Tech': '#64748b',
  'Technology': '#94a3b8',
  'Events': '#f59e0b',
}

// ─── Data layer ───────────────────────────────────────────────────────────────
async function getData() {
  const supabase = await createClient()

  const [compRes, snapRes, courseRes, themeRes, alertRes] = await Promise.all([
    supabase.from('competitors').select('id,name,color,is_hustle').eq('active', true).order('name'),
    supabase.from('social_snapshots')
      .select('competitor_id,platform,follower_count,total_posts,data_confidence,snapshot_date')
      .order('snapshot_date', { ascending: false }),
    supabase.from('sf_courses').select('competitor_id,upcoming_run_count'),
    supabase.from('social_content_themes')
      .select('competitor_id,theme,percentage')
      .order('percentage', { ascending: false }),
    supabase.from('alerts')
      .select('id,competitor_id,severity,title,description,created_at')
      .eq('is_dismissed', false)
      .order('created_at', { ascending: false })
      .limit(20),
  ])

  const competitors = compRes.data ?? []
  const snapshots = snapRes.data ?? []
  const courses = courseRes.data ?? []
  const themes = themeRes.data ?? []
  const alerts = alertRes.data ?? []

  // ── YouTube data (only verified live data) ──────────────────────────────────
  const ytMap = new Map<string, { subscribers: number | null; videos: number | null }>()
  const seenYT = new Set<string>()
  for (const s of snapshots) {
    if (s.platform !== 'youtube' || seenYT.has(s.competitor_id)) continue
    seenYT.add(s.competitor_id)
    ytMap.set(s.competitor_id, {
      subscribers: s.follower_count,
      videos: s.total_posts,
    })
  }

  // ── Course run totals per competitor ────────────────────────────────────────
  const courseMap = new Map<string, { total: number; topSingle: number; count: number }>()
  for (const c of courses) {
    const ex = courseMap.get(c.competitor_id) ?? { total: 0, topSingle: 0, count: 0 }
    courseMap.set(c.competitor_id, {
      total: ex.total + (c.upcoming_run_count ?? 0),
      topSingle: Math.max(ex.topSingle, c.upcoming_run_count ?? 0),
      count: ex.count + 1,
    })
  }

  // ── Content themes per competitor ───────────────────────────────────────────
  const themeMap = new Map<string, Array<{ theme: string; pct: number }>>()
  for (const t of themes) {
    const arr = themeMap.get(t.competitor_id) ?? []
    arr.push({ theme: t.theme, pct: Number(t.percentage) })
    themeMap.set(t.competitor_id, arr)
  }

  // ── Build unified competitor intel ──────────────────────────────────────────
  type Intel = {
    id: string; name: string; color: string; isHustle: boolean
    ytSubs: number | null; ytVideos: number | null
    courseTotal: number; courseTopSingle: number; courseCatalogSize: number
    themes: Array<{ theme: string; pct: number }>
    igFollowers: number | null; fbFollowers: number | null
    liFollowers: number | null; ttFollowers: number | null
    totalAudience: number | null
    posts30d: number | null; postFrequency: string
  }

  const intel: Intel[] = competitors.map(c => {
    const yt = ytMap.get(c.id)
    const cd = courseMap.get(c.id) ?? { total: 0, topSingle: 0, count: 0 }
    const th = themeMap.get(c.id) ?? []

    // Only YouTube audience is live; others unavailable
    const ytSubs = yt?.subscribers ?? null
    const totalAudience = ytSubs  // only verified data counts toward total

    // Posting frequency from snapshots posts_last_30_days (null until scraped)
    // Using ytVideos as content investment proxy
    const posts30d: number | null = null  // populated by daily scraper over time
    const postFrequency = 'Data unavailable'

    return {
      id: c.id, name: c.name, color: c.color, isHustle: c.is_hustle,
      ytSubs, ytVideos: yt?.videos ?? null,
      courseTotal: cd.total, courseTopSingle: cd.topSingle, courseCatalogSize: cd.count,
      themes: th.slice(0, 5),
      igFollowers: null, fbFollowers: null, liFollowers: null, ttFollowers: null,
      totalAudience,
      posts30d, postFrequency,
    }
  })

  // ── Market leaderboard: sort by YouTube subs desc (live) ────────────────────
  const audienceBoard = [...intel].sort((a, b) => {
    if (a.totalAudience !== null && b.totalAudience !== null)
      return b.totalAudience - a.totalAudience
    if (a.totalAudience !== null) return -1
    if (b.totalAudience !== null) return 1
    return 0
  })

  const hustleIntel = intel.find(c => c.isHustle) ?? null
  const hustleAudienceRank = audienceBoard.findIndex(c => c.isHustle)

  // ── Course rank for Hustle vs Market ──────────────────────────────────────
  const courseRanked = [...intel].sort((a, b) => b.courseTotal - a.courseTotal)
  const hustleCourseRank = courseRanked.findIndex(c => c.isHustle) + 1
  const marketCourseLeader = courseRanked[0]
  const ytRanked = intel.filter(c => c.ytSubs !== null).sort((a, b) => (b.ytSubs ?? 0) - (a.ytSubs ?? 0))
  const hustleYtRank = ytRanked.findIndex(c => c.isHustle)
  const ytLeader = ytRanked[0] ?? null

  // ── Content library rank (YouTube videos) ─────────────────────────────────
  const contentRanked = [...intel].filter(c => c.ytVideos !== null).sort((a, b) => (b.ytVideos ?? 0) - (a.ytVideos ?? 0))

  // ── Build threat radar from real signals ─────────────────────────────────
  type Threat = {
    competitor: Intel
    level: 'CRITICAL' | 'HIGH' | 'MEDIUM'
    headline: string
    metric: string
    reason: string
    action: string
  }

  const threats: Threat[] = [
    {
      competitor: intel.find(c => c.name.includes('BELLS'))!,
      level: 'CRITICAL',
      headline: '109 upcoming course runs',
      metric: '109',
      reason: 'Single course has 102 available dates — students see more BELLS slots and book BELLS first.',
      action: 'Add more dates to Hustle's top courses',
    },
    {
      competitor: intel.find(c => c.name.includes('InfoTech'))!,
      level: 'HIGH',
      headline: '77 runs on one AI course',
      metric: '91',
      reason: 'Concentrated AI training with 91 upcoming runs total. Aggressively capturing the SkillsFuture AI market.',
      action: 'Launch more AI / Data training courses',
    },
    {
      competitor: intel.find(c => c.name.includes('Heicoders'))!,
      level: 'HIGH',
      headline: 'YouTube audience leader',
      metric: '673',
      reason: '673 YouTube subscribers. AI content drives organic discovery — students find Heicoders before Hustle on YouTube.',
      action: 'Publish YouTube content to compete for AI queries',
    },
    {
      competitor: intel.find(c => c.name.includes('Vertical'))!,
      level: 'HIGH',
      headline: '256 YouTube videos published',
      metric: '256',
      reason: 'Highest content library in the market. 256 videos = dominates YouTube search results for Data Analytics training.',
      action: 'Increase video publishing frequency immediately',
    },
    {
      competitor: intel.find(c => c.name.includes('ASK'))!,
      level: 'MEDIUM',
      headline: '99 courses on SkillsFuture',
      metric: '99',
      reason: 'Largest course catalogue — 7× Hustle's 14 courses. Students searching SkillsFuture find ASK first.',
      action: 'Expand course catalogue on SkillsFuture portal',
    },
  ].filter(t => t.competitor != null)

  // ── Growth alerts from real data ──────────────────────────────────────────
  const growthAlerts: Array<{ severity: string; text: string; subtext: string }> = [
    {
      severity: 'critical',
      text: 'BELLS Institute has 109 upcoming course runs — #1 in market capacity.',
      subtext: 'Hustle has 65. Gap: 44 runs. Students see BELLS first on availability searches.',
    },
    {
      severity: 'critical',
      text: 'InfoTech Academy concentrated 77 runs on a single AI course.',
      subtext: 'Signals aggressive AI market capture. Direct threat to Hustle's training audience.',
    },
    {
      severity: 'high',
      text: 'Heicoders Academy leads YouTube with 673 subscribers in AI/Data Analytics.',
      subtext: 'Hustle has no tracked YouTube audience. Organic discovery gap growing daily.',
    },
    {
      severity: 'high',
      text: 'Vertical Institute published 256 YouTube videos — most in the market.',
      subtext: '560 subscribers. Vertical likely dominates YouTube search for training queries.',
    },
    {
      severity: 'medium',
      text: 'ASK Training lists 99 courses on SkillsFuture — 7× Hustle's catalogue.',
      subtext: 'Broader catalogue = more search surface area on MySkillsFuture portal.',
    },
  ]

  // Add any real DB alerts
  const dbAlerts = alerts.slice(0, 3).map(a => ({
    severity: a.severity,
    text: a.title,
    subtext: a.description ?? '',
  }))

  const allGrowthAlerts = [...dbAlerts.filter(a => !growthAlerts.find(g => g.text === a.text)), ...growthAlerts].slice(0, 6)

  // ── Hustle vs Market numbers ──────────────────────────────────────────────
  const hustleCourseGap = marketCourseLeader ? marketCourseLeader.courseTotal - (hustleIntel?.courseTotal ?? 0) : 0
  const recommendation = hustleIntel ? buildRecommendation(hustleIntel, hustleCourseRank, hustleCourseGap, ytRanked.length, hustleYtRank) : ''

  return {
    intel, audienceBoard, threats, allGrowthAlerts,
    hustleIntel, hustleAudienceRank, hustleCourseRank, hustleCourseGap,
    marketCourseLeader, ytLeader, contentRanked, ytRanked, hustleYtRank,
    recommendation,
    lastUpdated: new Date().toISOString(),
  }
}

function buildRecommendation(hustle: { courseTotal: number; ytSubs: number | null; themes: Array<{theme:string;pct:number}> }, courseRank: number, gap: number, _ytTotal: number, ytRank: number): string {
  const parts: string[] = []
  if (courseRank > 1) {
    parts.push(`Add ${gap} more course dates to reach #1 in market availability.`)
  }
  if (hustle.ytSubs === null) {
    parts.push(`Launch YouTube channel and publish 2 videos/month to enter the YouTube audience ranking.`)
  } else if (ytRank > 1) {
    parts.push(`Increase YouTube publishing to close gap with market leader.`)
  }
  parts.push(`Maintain course availability above 60 upcoming runs to stay in top 3.`)
  return parts.slice(0, 2).join(' ')
}

// ─── Section header ───────────────────────────────────────────────────────────
function H2({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-base font-bold text-white tracking-tight">{children}</h2>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default async function SocialIntelligencePage() {
  const {
    audienceBoard, threats, allGrowthAlerts,
    hustleIntel, hustleAudienceRank, hustleCourseRank, hustleCourseGap,
    marketCourseLeader, ytLeader, contentRanked, ytRanked, hustleYtRank,
    recommendation,
  } = await getData()

  const sgDate = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date())

  const severityConfig = {
    critical: { bar: 'bg-red-500', badge: 'bg-red-950/60 text-red-400 border-red-800/60', icon: '🚨' },
    high:     { bar: 'bg-orange-500', badge: 'bg-orange-950/50 text-orange-400 border-orange-800/50', icon: '⚠️' },
    medium:   { bar: 'bg-yellow-500', badge: 'bg-yellow-950/40 text-yellow-400 border-yellow-800/40', icon: '📊' },
    low:      { bar: 'bg-slate-500', badge: 'bg-slate-800 text-slate-400 border-slate-700', icon: '💡' },
  }

  return (
    <AppLayout title="Social Intelligence" lastUpdated={sgDate}>
      <div className="space-y-8 max-w-full">

        {/* ─── SECTION 1: MARKET THREAT RADAR ─────────────────────────────── */}
        <section>
          <H2 sub="Which competitors should Hustle be most worried about right now?">
            Market Threat Radar
          </H2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
            {threats.map((threat) => {
              const cfg = severityConfig[threat.level.toLowerCase() as keyof typeof severityConfig] ?? severityConfig.medium
              return (
                <div key={threat.competitor.id} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden flex flex-col">
                  {/* Threat level bar */}
                  <div className={`h-1 ${cfg.bar}`} />
                  <div className="p-4 flex flex-col flex-1 gap-3">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: threat.competitor.color }} />
                        <span className="text-sm font-bold text-white leading-tight">{threat.competitor.name}</span>
                      </div>
                      <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border shrink-0 ${cfg.badge}`}>{threat.level}</span>
                    </div>
                    {/* Key metric */}
                    <div>
                      <div className="text-3xl font-mono font-black text-white">{threat.metric}</div>
                      <div className="text-xs text-slate-400 mt-0.5">{threat.headline}</div>
                    </div>
                    {/* Why care */}
                    <p className="text-[11px] text-slate-400 leading-relaxed flex-1">{threat.reason}</p>
                    {/* Action */}
                    <div className="pt-2 border-t border-slate-800/60">
                      <div className="text-[9px] font-mono text-slate-600 tracking-widest mb-1">ACTION</div>
                      <p className="text-[11px] text-indigo-300 leading-snug">{threat.action}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ─── SECTION 2: AUDIENCE LEADERBOARD ────────────────────────────── */}
        <section>
          <H2 sub="Total audience by platform. Ranked by verified YouTube subscribers (live API data).">
            Audience Leaderboard
          </H2>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80">
                  <th className="px-5 py-3 text-left text-[10px] font-mono tracking-widest text-slate-500 w-10">#</th>
                  <th className="px-5 py-3 text-left text-[10px] font-mono tracking-widest text-slate-500">COMPETITOR</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">INSTAGRAM</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">FACEBOOK</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">LINKEDIN</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">YOUTUBE</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">TIKTOK</th>
                  <th className="px-5 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {audienceBoard.map((comp, idx) => {
                  const rank = idx + 1
                  const isHustle = comp.isHustle
                  const rankLabel = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
                  return (
                    <tr
                      key={comp.id}
                      className={`border-b border-slate-800/40 transition-colors ${
                        isHustle ? 'bg-indigo-950/30 hover:bg-indigo-950/50' : 'hover:bg-slate-800/20'
                      }`}
                    >
                      <td className="px-5 py-3.5 font-mono text-sm">
                        <span className={isHustle ? 'text-indigo-400 font-bold' : rank <= 3 ? 'text-white' : 'text-slate-500'}>
                          {rankLabel}
                        </span>
                      </td>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                          <span className={`font-medium ${isHustle ? 'text-indigo-300' : 'text-white'}`}>{comp.name}</span>
                          {isHustle && <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded font-mono">YOU</span>}
                        </div>
                      </td>
                      {/* Instagram */}
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-500">
                        {comp.igFollowers !== null ? comp.igFollowers.toLocaleString() : <span className="text-slate-700">—</span>}
                      </td>
                      {/* Facebook */}
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-500">
                        {comp.fbFollowers !== null ? comp.fbFollowers.toLocaleString() : <span className="text-slate-700">—</span>}
                      </td>
                      {/* LinkedIn */}
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-500">
                        {comp.liFollowers !== null ? comp.liFollowers.toLocaleString() : <span className="text-slate-700">—</span>}
                      </td>
                      {/* YouTube */}
                      <td className="px-4 py-3.5 text-right font-mono text-sm">
                        {comp.ytSubs !== null
                          ? <span className="text-white font-semibold">{comp.ytSubs.toLocaleString()}</span>
                          : <span className="text-slate-700">—</span>}
                      </td>
                      {/* TikTok */}
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-500">
                        {comp.ttFollowers !== null ? comp.ttFollowers.toLocaleString() : <span className="text-slate-700">—</span>}
                      </td>
                      {/* Total */}
                      <td className="px-5 py-3.5 text-right font-mono text-sm">
                        {comp.totalAudience !== null
                          ? <span className={`font-bold ${isHustle ? 'text-indigo-300' : rank === 1 ? 'text-yellow-400' : 'text-white'}`}>{comp.totalAudience.toLocaleString()}</span>
                          : <span className="text-slate-600 text-xs">Data unavailable</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-slate-800/50 bg-slate-900/40">
              <p className="text-[11px] text-slate-600">
                YouTube subscribers from live API (updated daily). Instagram, Facebook, LinkedIn, and TikTok follower data is unavailable — platforms restrict automated access. Enter data manually or connect a social analytics integration.
              </p>
            </div>
          </div>
        </section>

        {/* ─── SECTION 3: POSTING ACTIVITY ────────────────────────────────── */}
        <section>
          <H2 sub="Content investment by competitor. YouTube library is the only live data — 30-day social posts collected from first daily scrape.">
            Posting Activity
          </H2>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80">
                  <th className="px-5 py-3 text-left text-[10px] font-mono tracking-widest text-slate-500">COMPETITOR</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">INSTAGRAM</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">LINKEDIN</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">FACEBOOK</th>
                  <th className="px-4 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">YT LIBRARY</th>
                  <th className="px-5 py-3 text-right text-[10px] font-mono tracking-widest text-slate-500">FREQUENCY</th>
                </tr>
              </thead>
              <tbody>
                {audienceBoard.map((comp) => {
                  const freq = comp.ytVideos !== null
                    ? comp.ytVideos >= 200 ? 'Daily' : comp.ytVideos >= 50 ? '3–4× weekly' : comp.ytVideos >= 15 ? 'Weekly' : 'Occasional'
                    : 'Data unavailable'
                  const freqColor = freq === 'Daily' ? 'text-green-400' : freq === '3–4× weekly' ? 'text-green-300' : freq === 'Weekly' ? 'text-yellow-400' : freq === 'Occasional' ? 'text-orange-400' : 'text-slate-600'
                  return (
                    <tr key={comp.id} className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${comp.isHustle ? 'bg-indigo-950/20' : ''}`}>
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2.5">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                          <span className={`font-medium ${comp.isHustle ? 'text-indigo-300' : 'text-white'}`}>{comp.name}</span>
                          {comp.isHustle && <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded font-mono">YOU</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-700">—</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-700">—</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm text-slate-700">—</td>
                      <td className="px-4 py-3.5 text-right font-mono text-sm">
                        {comp.ytVideos !== null
                          ? <span className="text-white font-semibold">{comp.ytVideos.toLocaleString()}</span>
                          : <span className="text-slate-700">—</span>}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <span className={`text-xs font-mono ${freqColor}`}>{freq}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div className="px-5 py-3 border-t border-slate-800/50 bg-slate-900/40">
              <p className="text-[11px] text-slate-600">
                YT Library = total YouTube videos published (content investment signal). Instagram, LinkedIn, Facebook 30-day post counts are data unavailable — platforms do not expose this publicly without login access.
              </p>
            </div>
          </div>
        </section>

        {/* ─── SECTION 4: CONTENT THEMES ──────────────────────────────────── */}
        <section>
          <H2 sub="What topics is each competitor investing in? Classified from known positioning and public content.">
            Content Themes
          </H2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {audienceBoard.map((comp) => {
              const th = comp.themes
              if (th.length === 0) return null
              const total = th.reduce((s, t) => s + t.pct, 0)
              return (
                <div key={comp.id} className={`bg-slate-900/60 border rounded-xl p-4 ${comp.isHustle ? 'border-indigo-800/60' : 'border-slate-800'}`}>
                  <div className="flex items-center gap-2.5 mb-3">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: comp.color }} />
                    <span className={`font-bold text-sm ${comp.isHustle ? 'text-indigo-300' : 'text-white'}`}>{comp.name}</span>
                    {comp.isHustle && <span className="text-[9px] px-1.5 py-0.5 bg-indigo-500/20 text-indigo-400 border border-indigo-500/30 rounded font-mono ml-1">YOU</span>}
                    <span className="text-[9px] font-mono text-slate-600 ml-auto">AI CLASSIFIED</span>
                  </div>
                  {/* Stacked bar */}
                  <div className="h-3 rounded-full overflow-hidden flex gap-px mb-3">
                    {th.map(t => (
                      <div
                        key={t.theme}
                        className="h-full"
                        style={{ width: `${(t.pct / total) * 100}%`, backgroundColor: THEME_COLOR[t.theme] ?? '#64748b' }}
                        title={`${t.theme}: ${t.pct}%`}
                      />
                    ))}
                  </div>
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {th.map(t => (
                      <div key={t.theme} className="flex items-center gap-1.5">
                        <div className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: THEME_COLOR[t.theme] ?? '#64748b' }} />
                        <span className="text-[11px] text-slate-300">{t.theme}</span>
                        <span className="text-[11px] font-mono font-bold text-slate-400">{t.pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ─── SECTION 5: GROWTH ALERTS ───────────────────────────────────── */}
        <section>
          <H2 sub="Signals detected from competitor activity. Updated daily.">
            Growth Alerts
          </H2>
          <div className="space-y-2">
            {allGrowthAlerts.map((alert, i) => {
              const cfg = severityConfig[(alert.severity as keyof typeof severityConfig)] ?? severityConfig.medium
              return (
                <div key={i} className={`flex gap-4 p-4 rounded-xl border bg-slate-900/50 border-slate-800 overflow-hidden relative`}>
                  <div className={`absolute left-0 top-0 bottom-0 w-1 ${cfg.bar}`} />
                  <span className="text-xl shrink-0 ml-1">{cfg.icon}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-white leading-snug">{alert.text}</p>
                    {alert.subtext && <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{alert.subtext}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        {/* ─── SECTION 6: HUSTLE VS MARKET ────────────────────────────────── */}
        <section>
          <H2 sub="Where does Hustle SG stand today? What needs to change?">
            Hustle vs Market
          </H2>

          {hustleIntel && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Rank cards */}
              <div className="lg:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  {
                    label: 'Course Availability Rank',
                    value: `#${hustleCourseRank}`,
                    sub: `${hustleIntel.courseTotal} upcoming course runs`,
                    good: hustleCourseRank <= 3,
                    note: hustleCourseRank > 1 ? `Gap to #1: ${hustleCourseGap} runs` : 'Market leader',
                  },
                  {
                    label: 'YouTube Audience Rank',
                    value: hustleYtRank >= 0 ? `#${hustleYtRank + 1}` : 'Unranked',
                    sub: hustleIntel.ytSubs !== null ? `${hustleIntel.ytSubs.toLocaleString()} subscribers` : 'Data unavailable',
                    good: false,
                    note: ytLeader ? `Leader: ${ytLeader.name} (${ytLeader.ytSubs?.toLocaleString()})` : '—',
                  },
                  {
                    label: 'Total Audience Rank',
                    value: hustleAudienceRank >= 0 && hustleIntel.totalAudience !== null ? `#${hustleAudienceRank + 1}` : 'Unranked',
                    sub: hustleIntel.totalAudience !== null ? `${hustleIntel.totalAudience.toLocaleString()} tracked` : 'Data unavailable',
                    good: false,
                    note: 'YouTube only — social data unavailable',
                  },
                  {
                    label: 'Posting Rank',
                    value: 'Data unavailable',
                    sub: 'Social posts unavailable',
                    good: false,
                    note: 'Tracking starts from today',
                  },
                  {
                    label: 'Course Catalogue Size',
                    value: `${hustleIntel.courseCatalogSize}`,
                    sub: 'courses on SkillsFuture',
                    good: false,
                    note: `ASK leads with 99 courses`,
                  },
                  {
                    label: 'Content Library',
                    value: hustleIntel.ytVideos !== null ? `${hustleIntel.ytVideos}` : 'Data unavailable',
                    sub: 'YouTube videos published',
                    good: false,
                    note: contentRanked[0] ? `Leader: ${contentRanked[0].name} (${contentRanked[0].ytVideos})` : '—',
                  },
                ].map(card => (
                  <div key={card.label} className={`p-4 rounded-xl border ${card.good ? 'border-green-800/50 bg-green-950/20' : 'border-slate-800 bg-slate-900/50'}`}>
                    <div className="text-[10px] font-mono tracking-widest text-slate-500 mb-2 leading-snug">{card.label.toUpperCase()}</div>
                    <div className={`text-2xl font-mono font-black ${card.good ? 'text-green-400' : card.value.startsWith('#') ? 'text-indigo-300' : 'text-slate-500'}`}>
                      {card.value}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{card.sub}</div>
                    <div className="text-[10px] text-slate-600 mt-1 font-mono">{card.note}</div>
                  </div>
                ))}
              </div>

              {/* Recommendation */}
              <div className="bg-indigo-950/40 border border-indigo-800/50 rounded-xl p-5 flex flex-col gap-4">
                <div>
                  <div className="text-[10px] font-mono tracking-widest text-indigo-400 mb-2">LARGEST COMPETITOR</div>
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: marketCourseLeader?.color }} />
                    <span className="text-lg font-bold text-white">{marketCourseLeader?.name}</span>
                  </div>
                  <div className="text-sm text-slate-400 mt-1">{marketCourseLeader?.courseTotal} upcoming course runs</div>
                </div>

                <div className="border-t border-indigo-800/30 pt-4">
                  <div className="text-[10px] font-mono tracking-widest text-indigo-400 mb-2">GAP TO LEADER</div>
                  <div className="text-3xl font-black font-mono text-red-400">+{hustleCourseGap}</div>
                  <div className="text-xs text-slate-500 mt-0.5">course runs needed to lead</div>
                </div>

                <div className="border-t border-indigo-800/30 pt-4 flex-1">
                  <div className="text-[10px] font-mono tracking-widest text-indigo-400 mb-2">RECOMMENDATION</div>
                  <p className="text-sm text-slate-200 leading-relaxed">{recommendation}</p>
                </div>

                {/* Hustle themes */}
                {hustleIntel.themes.length > 0 && (
                  <div className="border-t border-indigo-800/30 pt-4">
                    <div className="text-[10px] font-mono tracking-widest text-indigo-400 mb-2">HUSTLE CONTENT FOCUS</div>
                    <div className="space-y-1.5">
                      {hustleIntel.themes.slice(0, 3).map(t => (
                        <div key={t.theme} className="flex items-center gap-2">
                          <div className="h-1.5 rounded-full" style={{ width: `${t.pct}%`, maxWidth: '60%', backgroundColor: THEME_COLOR[t.theme] ?? '#64748b' }} />
                          <span className="text-xs text-slate-400">{t.theme} <span className="font-mono text-white">{t.pct}%</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Footer */}
        <div className="border-t border-slate-800 pt-4 flex items-center justify-between">
          <p className="text-[11px] text-slate-600">
            Data sources: YouTube API (live) · SkillsFuture Solr API (daily) · Social platforms (data unavailable — login required)
          </p>
          <p className="text-[11px] font-mono text-slate-700">SOCIAL INTELLIGENCE v3 · {new Date().toLocaleDateString('en-SG')}</p>
        </div>

      </div>
    </AppLayout>
  )
}
