import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { createClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/utils'
import { TrendingUp, AlertTriangle, BookOpen, Star, Activity, Target, Database } from 'lucide-react'

export const revalidate = 300

async function getSFData() {
  const supabase = await createClient()

  const [coursesRes, competitorsRes] = await Promise.all([
    supabase
      .from('sf_courses')
      .select(`
        sf_ref_no, title, provider_name, category_text, course_fee,
        popularity_score, respondent_count, quality_rating,
        has_active_runs, course_mode, source_api_url, scraped_at,
        competitor_id,
        competitors(id, name, color, is_hustle, tier)
      `)
      .order('popularity_score', { ascending: false }),
    supabase
      .from('competitors')
      .select('id, name, color, is_hustle, tier')
      .eq('active', true),
  ])

  return {
    courses: coursesRes.data ?? [],
    competitors: competitorsRes.data ?? [],
    lastUpdated: coursesRes.data?.[0]?.scraped_at ?? null,
  }
}

export default async function CourseIntelligencePage() {
  const { courses, lastUpdated } = await getSFData()

  // ── Per-provider stats ────────────────────────────────────────────────────
  type ProviderStats = {
    competitorId: string
    name: string
    color: string
    isHustle: boolean
    total: number
    activeRuns: number
    avgFee: number | null
    avgRating: number | null
    topCategory: string | null
    categories: Map<string, number>
    scrapedAt: string | null
  }

  const providerMap = new Map<string, ProviderStats>()

  for (const c of courses) {
    const comp = (Array.isArray(c.competitors) ? c.competitors[0] : c.competitors) as {
      id: string; name: string; color: string; is_hustle: boolean; tier: string
    } | null
    if (!comp) continue
    const cid = c.competitor_id as string

    if (!providerMap.has(cid)) {
      providerMap.set(cid, {
        competitorId: cid, name: comp.name, color: comp.color, isHustle: comp.is_hustle,
        total: 0, activeRuns: 0, avgFee: null, avgRating: null,
        topCategory: null, categories: new Map(), scrapedAt: null,
      })
    }

    const p = providerMap.get(cid)!
    p.total++
    if (c.has_active_runs) p.activeRuns++
    if (c.scraped_at && (!p.scrapedAt || c.scraped_at > p.scrapedAt)) p.scrapedAt = c.scraped_at
    if (c.category_text) p.categories.set(c.category_text, (p.categories.get(c.category_text) ?? 0) + 1)
  }

  for (const [cid, p] of providerMap) {
    const pCourses = courses.filter(c => c.competitor_id === cid)
    const feeCourses = pCourses.filter(c => c.course_fee !== null && (c.course_fee as number) > 0)
    const ratingCourses = pCourses.filter(c => c.quality_rating !== null && (c.quality_rating as number) > 0)

    p.avgFee = feeCourses.length > 0
      ? Math.round(feeCourses.reduce((s, c) => s + (c.course_fee as number), 0) / feeCourses.length)
      : null
    p.avgRating = ratingCourses.length > 0
      ? Math.round((ratingCourses.reduce((s, c) => s + (c.quality_rating as number), 0) / ratingCourses.length) * 10) / 10
      : null

    let topCat: string | null = null; let topCount = 0
    for (const [cat, count] of p.categories) {
      if (count > topCount) { topCount = count; topCat = cat }
    }
    p.topCategory = topCat
  }

  const providers = Array.from(providerMap.values()).sort((a, b) => b.total - a.total)
  const hustleProvider = providers.find(p => p.isHustle)

  // ── Category analysis ─────────────────────────────────────────────────────
  const globalCategories = new Map<string, number>()
  for (const c of courses) {
    if (c.category_text) globalCategories.set(c.category_text, (globalCategories.get(c.category_text) ?? 0) + 1)
  }
  const topCategories = Array.from(globalCategories.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)

  // ── Hustle gaps ───────────────────────────────────────────────────────────
  const hustleCats = new Set(
    courses
      .filter(c => { const comp = (Array.isArray(c.competitors) ? c.competitors[0] : c.competitors) as { is_hustle: boolean } | null; return comp?.is_hustle })
      .map(c => c.category_text)
      .filter(Boolean)
  )
  const gapCategories = Array.from(globalCategories.entries())
    .filter(([cat, count]) => !hustleCats.has(cat) && count >= 5)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  // ── Top courses by popularity ─────────────────────────────────────────────
  const topCourses = courses.filter(c => (c.popularity_score as number) > 0).slice(0, 10)
  const totalActive = courses.filter(c => c.has_active_runs).length

  return (
    <AppLayout title="MySkillsFuture Intelligence" lastUpdated={lastUpdated}>

      {/* Section 1: KPI Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-4 w-4 text-indigo-400" />
            <p className="text-xs text-slate-400">SF Courses Tracked</p>
          </div>
          <p className="text-2xl font-bold text-white">{courses.length}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Activity className="h-4 w-4 text-emerald-400" />
            <p className="text-xs text-slate-400">With Active Runs</p>
          </div>
          <p className="text-2xl font-bold text-white">{totalActive}</p>
          <p className="text-xs text-slate-500 mt-0.5">{Math.round((totalActive / Math.max(courses.length, 1)) * 100)}% of total</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-amber-400" />
            <p className="text-xs text-slate-400">Unique Categories</p>
          </div>
          <p className="text-2xl font-bold text-white">{globalCategories.size}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Target className="h-4 w-4 text-rose-400" />
            <p className="text-xs text-slate-400">Hustle vs Market</p>
          </div>
          <p className="text-2xl font-bold text-white">
            {hustleProvider?.total ?? 0}
            <span className="text-sm font-normal text-slate-500"> / {courses.length}</span>
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {hustleProvider ? `#${providers.findIndex(p => p.isHustle) + 1} by volume` : 'No data'}
          </p>
        </div>
      </div>

      {/* Section 2: Provider Comparison */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Provider Comparison</h2>
          <p className="text-xs text-slate-500 mt-0.5">Live from MySkillsFuture portal · {providers.length} providers</p>
        </div>
        {providers.length === 0 ? (
          <div className="p-6"><DataUnavailable label="No SF course data — run /api/cron/sf-refresh" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Provider</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Courses</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Runs</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Run Rate</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Fee</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Avg Rating</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Top Category</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p, i) => (
                  <tr key={p.competitorId} className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${p.isHustle ? 'bg-indigo-500/5' : ''}`}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-slate-600 w-4">{i + 1}</span>
                        <CompetitorBadge name={p.name} color={p.color} is_hustle={p.isHustle} size="sm" />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right"><span className="text-white font-medium">{p.total}</span></td>
                    <td className="px-4 py-3 text-right"><span className="text-emerald-400">{p.activeRuns}</span></td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-400 text-xs">{Math.round((p.activeRuns / Math.max(p.total, 1)) * 100)}%</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.avgFee !== null ? <span className="text-white">${p.avgFee.toLocaleString()}</span> : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.avgRating !== null ? (
                        <span className={`font-medium ${p.avgRating >= 4.5 ? 'text-emerald-400' : p.avgRating >= 4.0 ? 'text-amber-400' : 'text-slate-400'}`}>
                          ★ {p.avgRating}
                        </span>
                      ) : <span className="text-slate-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400 max-w-[180px] truncate">{p.topCategory ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Section 3: Category Dominance */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-1">Category Dominance</h2>
          <p className="text-xs text-slate-500 mb-4">Top 10 categories by course volume across all providers</p>
          {topCategories.length === 0 ? <DataUnavailable label="No data" /> : (
            <div className="space-y-2.5">
              {topCategories.map(([cat, count]) => {
                const maxCount = topCategories[0][1]
                const hustleCount = courses.filter(c => {
                  const comp = (Array.isArray(c.competitors) ? c.competitors[0] : c.competitors) as { is_hustle: boolean } | null
                  return comp?.is_hustle && c.category_text === cat
                }).length
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="text-xs text-slate-300 truncate max-w-[200px]">{cat}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        {hustleCount > 0 && (
                          <span className="text-[10px] px-1 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded">
                            Hustle: {hustleCount}
                          </span>
                        )}
                        <span className="text-xs text-slate-400">{count}</span>
                      </div>
                    </div>
                    <div className="bg-slate-800 rounded-full h-1.5">
                      <div className="h-1.5 rounded-full bg-indigo-500/60" style={{ width: `${(count / maxCount) * 100}%` }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Section 5: Hustle Market Gaps */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Hustle Market Gaps</h2>
          </div>
          <p className="text-xs text-slate-500 mb-4">Categories where competitors have ≥5 courses but Hustle has none</p>
          {gapCategories.length === 0 ? (
            <p className="text-sm text-emerald-400">✓ No significant gaps found</p>
          ) : (
            <div className="space-y-0">
              {gapCategories.map(([cat, count]) => (
                <div key={cat} className="flex items-center justify-between py-2 border-b border-slate-800/60">
                  <span className="text-xs text-slate-300 truncate max-w-[220px]">{cat}</span>
                  <span className="text-xs text-amber-400 shrink-0 ml-2">{count} competitor courses</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Section 4: Top Courses by Popularity */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Star className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-white">Top Courses by Popularity</h2>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">Ranked by SkillsFuture popularity score</p>
        </div>
        {topCourses.length === 0 ? (
          <div className="p-6"><DataUnavailable label="No popularity data available" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">#</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Course</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Provider</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Category</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Fee</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Rating</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Reviews</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Active</th>
                </tr>
              </thead>
              <tbody>
                {topCourses.map((course, i) => {
                  const comp = (Array.isArray(course.competitors) ? course.competitors[0] : course.competitors) as {
                    name: string; color: string; is_hustle: boolean
                  } | null
                  return (
                    <tr key={course.sf_ref_no} className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${comp?.is_hustle ? 'bg-indigo-500/5' : ''}`}>
                      <td className="px-4 py-3 text-xs text-slate-600">{i + 1}</td>
                      <td className="px-4 py-3">
                        {course.source_api_url ? (
                          <a href={course.source_api_url as string} target="_blank" rel="noopener noreferrer"
                            className="text-white hover:text-indigo-300 text-sm font-medium truncate block max-w-[240px]">
                            {course.title}
                          </a>
                        ) : (
                          <span className="text-white text-sm font-medium truncate block max-w-[240px]">{course.title}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {comp
                          ? <CompetitorBadge name={comp.name} color={comp.color} is_hustle={comp.is_hustle} size="sm" />
                          : <span className="text-slate-500 text-xs">{course.provider_name as string}</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-400 max-w-[140px] truncate">{(course.category_text as string) ?? '—'}</td>
                      <td className="px-4 py-3 text-right text-sm">
                        {course.course_fee !== null && (course.course_fee as number) > 0
                          ? <span className="text-white">${(course.course_fee as number).toLocaleString()}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {course.quality_rating !== null && (course.quality_rating as number) > 0
                          ? <span className={`text-sm font-medium ${(course.quality_rating as number) >= 4.5 ? 'text-emerald-400' : 'text-amber-400'}`}>★ {course.quality_rating as number}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400">
                        {(course.respondent_count as number) > 0 ? course.respondent_count as number : '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-block h-2 w-2 rounded-full ${course.has_active_runs ? 'bg-emerald-400' : 'bg-slate-700'}`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Section 7: Data Refresh Status */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-white">Data Refresh Status</h2>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {providers.map(p => (
            <div key={p.competitorId} className={`rounded-lg border p-3 ${p.isHustle ? 'border-indigo-500/30 bg-indigo-500/5' : 'border-slate-800 bg-slate-900/40'}`}>
              <p className="text-xs font-medium text-white truncate">{p.name}</p>
              <p className="text-lg font-bold text-white mt-0.5">{p.total}</p>
              <p className="text-[10px] text-slate-500 mt-1">{p.scrapedAt ? formatRelativeTime(p.scrapedAt) : 'Never'}</p>
            </div>
          ))}
        </div>
      </div>
    </AppLayout>
  )
}
