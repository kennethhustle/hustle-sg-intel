import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { createClient } from '@/lib/supabase/server'
import { formatCurrency, formatRelativeTime } from '@/lib/utils'
import { ExternalLink, CheckCircle, XCircle } from 'lucide-react'
import type { Tier } from '@/lib/types'

export const revalidate = 300

async function getCourseData() {
  const supabase = await createClient()

  const [coursesRes, competitorsRes] = await Promise.all([
    supabase
      .from('course_catalog')
      .select(`
        *,
        competitors(id, name, slug, color, is_hustle, tier)
      `)
      .eq('is_active', true)
      .order('scraped_at', { ascending: false })
      .limit(300),
    supabase.from('competitors').select('id, name, color, is_hustle, tier').eq('active', true),
  ])

  const courses = coursesRes.data ?? []
  const competitors = competitorsRes.data ?? []

  // Counts per competitor
  const countMap = new Map<string, { total: number; sf: number }>()
  for (const c of courses) {
    const cid = c.competitor_id
    const prev = countMap.get(cid) ?? { total: 0, sf: 0 }
    countMap.set(cid, {
      total: prev.total + 1,
      sf: prev.sf + (c.is_skillsfuture_claimable ? 1 : 0),
    })
  }

  // Category distribution
  const categoryDist = new Map<string, number>()
  for (const c of courses) {
    if (c.category) {
      categoryDist.set(c.category, (categoryDist.get(c.category) ?? 0) + 1)
    }
  }

  const lastUpdated = courses[0]?.scraped_at ?? null

  return { courses, competitors, countMap, categoryDist, lastUpdated }
}

export default async function CourseIntelligencePage() {
  const { courses, competitors, countMap, categoryDist, lastUpdated } = await getCourseData()

  const sortedCategories = Array.from(categoryDist.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)

  return (
    <AppLayout title="Course Intelligence" lastUpdated={lastUpdated}>
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">{courses.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Courses catalogued</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {courses.filter((c) => c.is_skillsfuture_claimable).length}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">SkillsFuture claimable</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {new Set(courses.map((c) => c.category).filter(Boolean)).size}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Categories</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {courses.filter((c) => c.price !== null).length > 0
              ? `${formatCurrency(
                  courses
                    .filter((c) => c.price !== null)
                    .reduce((sum, c) => sum + (c.price ?? 0), 0) /
                    courses.filter((c) => c.price !== null).length
                )}`
              : '–'}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Avg price (known)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Per-competitor counts */}
        <div className="lg:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Courses by Competitor</h2>
          <div className="space-y-2.5">
            {competitors
              .sort((a, b) => (countMap.get(b.id)?.total ?? 0) - (countMap.get(a.id)?.total ?? 0))
              .map((c) => {
                const counts = countMap.get(c.id)
                return (
                  <div key={c.id} className="flex items-center justify-between">
                    <CompetitorBadge
                      name={c.name}
                      color={c.color}
                      is_hustle={c.is_hustle}
                      size="sm"
                    />
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        {counts?.total ?? 0}
                      </span>
                      {counts && counts.sf > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded">
                          {counts.sf} SF
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Category distribution */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Top Categories</h2>
          {sortedCategories.length === 0 ? (
            <DataUnavailable label="No category data" />
          ) : (
            <div className="space-y-2">
              {sortedCategories.map(([category, count]) => {
                const maxCount = sortedCategories[0][1]
                return (
                  <div key={category} className="flex items-center gap-3">
                    <span className="text-xs text-slate-300 w-48 truncate shrink-0">{category}</span>
                    <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-indigo-500/70"
                        style={{ width: `${(count / maxCount) * 100}%` }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-8 text-right shrink-0">{count}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Course Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Course Catalog</h2>
          <p className="text-xs text-slate-500 mt-0.5">{courses.length} active courses</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Competitor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Course Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Category</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Price</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Hours</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">SF</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">SF Credit</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Source</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Updated</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {courses.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center">
                    <DataUnavailable label="No courses scraped yet — run /api/cron/courses-refresh" />
                  </td>
                </tr>
              ) : (
                courses.slice(0, 100).map((course) => {
                  const compRaw = course.competitors
                  const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as {
                    id: string
                    name: string
                    slug: string
                    color: string
                    is_hustle: boolean
                    tier: string
                  } | null | undefined

                  return (
                    <tr
                      key={course.id}
                      className={`border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors ${
                        comp?.is_hustle ? 'bg-indigo-500/5' : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        {comp ? (
                          <CompetitorBadge
                            name={comp.name}
                            color={comp.color}
                            is_hustle={comp.is_hustle}
                            size="sm"
                          />
                        ) : (
                          <span className="text-slate-500 text-xs">Unknown</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-white text-sm max-w-[220px] truncate font-medium">
                        {course.title}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[120px] truncate">
                        {course.category ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm">
                        {course.price !== null ? (
                          <span className="text-white">{formatCurrency(course.price)}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400">
                        {course.duration_hours ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {course.is_skillsfuture_claimable ? (
                          <CheckCircle className="h-4 w-4 text-emerald-400 mx-auto" />
                        ) : (
                          <XCircle className="h-4 w-4 text-slate-700 mx-auto" />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs">
                        {course.skillsfuture_credit !== null ? (
                          <span className="text-emerald-400">{formatCurrency(course.skillsfuture_credit)}</span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded">
                          {course.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {formatRelativeTime(course.scraped_at)}
                      </td>
                      <td className="px-4 py-3">
                        {course.source_url ? (
                          <a
                            href={course.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex text-indigo-400 hover:text-indigo-300"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {courses.length > 100 && (
          <div className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">
            Showing 100 of {courses.length} courses
          </div>
        )}
      </div>
    </AppLayout>
  )
}
