import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { formatDate, formatRelativeTime, formatCurrency } from '@/lib/utils'
import { ExternalLink, Briefcase } from 'lucide-react'
import type { Tier } from '@/lib/types'
import { getActiveJobs } from '@/lib/services/queries/hiring'

export const revalidate = 300

const SOURCE_LABELS: Record<string, string> = {
  mycareersfuture: 'MyCareersFuture',
  jobstreet: 'JobStreet',
  indeed: 'Indeed',
  career_page: 'Career Page',
}

const SOURCE_COLORS: Record<string, string> = {
  mycareersfuture: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  jobstreet: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  indeed: 'bg-blue-700/10 text-blue-300 border-blue-700/20',
  career_page: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

// Collapse duplicate postings that accumulate across daily scrape runs.
// A logical job is identified by competitor_id + normalized(title) + source.
// The normalization, non-job filtering, and read-time dedup now live in the
// shared hiring query layer so the Dashboard reuses the exact same logic.

async function getHiringData() {
  const { jobs, competitors, lastUpdated } = await getActiveJobs()

  // Velocity: jobs per competitor
  const velocityMap = new Map<string, number>()
  const sourceMap = new Map<string, number>()

  for (const job of jobs) {
    const cid = job.competitor_id
    velocityMap.set(cid, (velocityMap.get(cid) ?? 0) + 1)
    sourceMap.set(job.source, (sourceMap.get(job.source) ?? 0) + 1)
  }

  return { jobs, competitors, velocityMap, sourceMap, lastUpdated }
}

export default async function HiringIntelligencePage() {
  const { jobs, competitors, velocityMap, sourceMap, lastUpdated } = await getHiringData()

  return (
    <AppLayout title="Hiring Intelligence" lastUpdated={lastUpdated} module="hiring">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">{jobs.length}</p>
          <p className="text-xs text-slate-400 mt-0.5">Active job postings</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {new Set(jobs.map((j) => j.competitor_id)).size}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Companies hiring</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {jobs.filter((j) => j.source === 'mycareersfuture').length}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Via MyCareersFuture</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
          <p className="text-2xl font-bold text-white">
            {jobs.filter((j) => j.scraped_at && new Date(j.scraped_at) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).length}
          </p>
          <p className="text-xs text-slate-400 mt-0.5">Seen in last 7 days</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 mb-6">
        {/* Hiring velocity */}
        <div className="lg:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Hiring Velocity</h2>
          <div className="space-y-2">
            {competitors
              .sort((a, b) => (velocityMap.get(b.id) ?? 0) - (velocityMap.get(a.id) ?? 0))
              .map((c) => {
                const count = velocityMap.get(c.id) ?? 0
                const max = Math.max(...Array.from(velocityMap.values()), 1)
                return (
                  <div key={c.id} className="flex items-center gap-2">
                    <CompetitorBadge
                      name={c.name}
                      color={c.color}
                      is_hustle={c.is_hustle}
                      size="sm"
                      className="shrink-0 max-w-[120px] truncate"
                    />
                    <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${(count / max) * 100}%`,
                          backgroundColor: c.color,
                        }}
                      />
                    </div>
                    <span className="text-xs text-slate-400 w-6 text-right">{count}</span>
                  </div>
                )
              })}
          </div>
        </div>

        {/* Source breakdown */}
        <div className="lg:col-span-1 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">By Source</h2>
          <div className="space-y-2.5">
            {Array.from(sourceMap.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([source, count]) => (
                <div key={source} className="flex items-center justify-between">
                  <span className={`text-xs px-2 py-0.5 rounded border ${SOURCE_COLORS[source] ?? 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                    {SOURCE_LABELS[source] ?? source}
                  </span>
                  <span className="text-sm font-medium text-white">{count}</span>
                </div>
              ))}
            {sourceMap.size === 0 && (
              <DataUnavailable label="No job data yet" />
            )}
          </div>
        </div>

        {/* Space for future chart */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-2">Recent Postings Summary</h2>
          <p className="text-xs text-slate-500 mb-4">Last 30 days activity</p>
          <div className="space-y-1.5">
            {competitors
              .filter((c) => (velocityMap.get(c.id) ?? 0) > 0)
              .sort((a, b) => (velocityMap.get(b.id) ?? 0) - (velocityMap.get(a.id) ?? 0))
              .slice(0, 6)
              .map((c) => (
                <div key={c.id} className="flex items-center justify-between py-1 border-b border-slate-800/50">
                  <CompetitorBadge
                    name={c.name}
                    color={c.color}
                    is_hustle={c.is_hustle}
                    tier={c.tier as Tier}
                    size="sm"
                  />
                  <div className="flex items-center gap-2">
                    <Briefcase className="h-3.5 w-3.5 text-slate-500" />
                    <span className="text-sm font-medium text-white">
                      {velocityMap.get(c.id) ?? 0} open roles
                    </span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>

      {/* Job Postings Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Active Job Postings</h2>
          <p className="text-xs text-slate-500 mt-0.5">{jobs.length} postings from {new Set(jobs.map((j) => j.source)).size} sources</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Competitor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Title</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Department</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Location</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Type</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Salary</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Source</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Posted / Seen</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Link</th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center">
                    <DataUnavailable label="No job postings scraped yet — run /api/cron/hiring-refresh" />
                  </td>
                </tr>
              ) : (
                jobs.slice(0, 100).map((job) => {
                  const compRaw = job.competitors
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
                      key={job.id}
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
                      <td
                        className="px-4 py-3 text-white text-sm font-medium max-w-[200px] truncate"
                        title={job.title}
                      >
                        {job.title}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs max-w-[120px] truncate">
                        {job.department ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {job.location ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {job.job_type ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-400">
                        {job.salary_min || job.salary_max ? (
                          <span className="text-white text-xs">
                            {formatCurrency(job.salary_min ?? null)} – {formatCurrency(job.salary_max ?? null)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${SOURCE_COLORS[job.source] ?? 'bg-slate-800 text-slate-400 border-slate-700'}`}>
                          {SOURCE_LABELS[job.source] ?? job.source}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {job.posted_at ? (
                          formatDate(job.posted_at)
                        ) : (
                          <span
                            className="text-slate-600"
                            title="Last seen on source — actual posting date unavailable"
                          >
                            Seen {formatRelativeTime(job.scraped_at)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {job.source_url ? (
                          <a
                            href={job.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex text-indigo-400 hover:text-indigo-300"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-slate-700">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
        {jobs.length > 100 && (
          <div className="px-5 py-3 border-t border-slate-800 text-xs text-slate-500">
            Showing 100 of {jobs.length} postings
          </div>
        )}
      </div>
    </AppLayout>
  )
}
