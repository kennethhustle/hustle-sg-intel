import { AppLayout } from '@/components/layout/app-layout'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { createClient } from '@/lib/supabase/server'
import { formatDate, formatNumber, cn } from '@/lib/utils'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import type { Tier } from '@/lib/types'

export const revalidate = 300

// ─── Module tracking chips (same idea as the admin table) ─────────────────────
const MODULE_CHIPS: { key: 'track_courses' | 'track_hiring' | 'track_marketing' | 'track_social' | 'track_seo' | 'include_in_opportunity_engine'; letter: string; title: string }[] = [
  { key: 'track_courses', letter: 'C', title: 'Courses' },
  { key: 'track_hiring', letter: 'H', title: 'Hiring' },
  { key: 'track_marketing', letter: 'M', title: 'Marketing' },
  { key: 'track_social', letter: 'S', title: 'Social' },
  { key: 'track_seo', letter: 'SEO', title: 'SEO' },
  { key: 'include_in_opportunity_engine', letter: 'OE', title: 'Opportunity Engine' },
]

const SOCIAL_PLATFORMS = ['facebook', 'instagram', 'linkedin', 'youtube', 'tiktok'] as const
type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  tiktok: 'TikTok',
}

// Hiring function-bucket classification via simple regex on job title.
const FUNCTION_BUCKETS: { label: string; pattern: RegExp }[] = [
  { label: 'Sales / Business Development', pattern: /sales|business development/i },
  { label: 'Trainer / Facilitator', pattern: /trainer|facilitator/i },
  { label: 'Curriculum / Instructional Design', pattern: /curriculum|instructional design/i },
  { label: 'Marketing / Brand', pattern: /marketing|brand/i },
]

function classifyJobFunction(title: string): string {
  for (const bucket of FUNCTION_BUCKETS) {
    if (bucket.pattern.test(title)) return bucket.label
  }
  return 'Other'
}

interface CompetitorRow {
  id: string
  name: string
  slug: string
  short_name: string | null
  website: string
  color: string
  tier: Tier
  active: boolean
  is_hustle: boolean
  archived_at: string | null
  track_courses: boolean
  track_hiring: boolean
  track_marketing: boolean
  track_social: boolean
  track_seo: boolean
  include_in_opportunity_engine: boolean
}

async function getCompetitor(slug: string): Promise<CompetitorRow | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('competitors')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()
  return (data as CompetitorRow) ?? null
}

async function getProfileData(competitorId: string) {
  const supabase = await createClient()

  const [
    sfCoursesRes,
    marketingRes,
    jobPostingsRes,
    socialSnapshotsRes,
    seoRankingsRes,
    alertsRes,
    insightsRes,
  ] = await Promise.all([
    supabase
      .from('sf_courses')
      .select('title, category_cluster, upcoming_run_count, respondent_count, course_fee, is_active')
      .eq('competitor_id', competitorId),
    supabase
      .from('competitor_marketing_data')
      .select('meta_ads, google_reviews, google_rating, google_ads, google_ads_verified_at')
      .eq('competitor_id', competitorId)
      .maybeSingle(),
    supabase
      .from('job_postings')
      .select('title, source, posted_at, scraped_at, is_active')
      .eq('competitor_id', competitorId)
      .order('scraped_at', { ascending: false })
      .limit(50),
    supabase
      .from('social_snapshots')
      .select('platform, follower_count, snapshot_date, data_source')
      .eq('competitor_id', competitorId)
      .order('snapshot_date', { ascending: false }),
    supabase
      .from('seo_rankings')
      .select('position, is_ad, checked_at, seo_keywords(keyword)')
      .eq('competitor_id', competitorId)
      .order('checked_at', { ascending: false })
      .limit(50),
    supabase
      .from('alerts')
      .select('id, title, description, severity, created_at')
      .eq('competitor_id', competitorId)
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('strategic_insights')
      .select('id, title, insight_type, created_at')
      .contains('competitor_ids', [competitorId])
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  return {
    sfCourses: sfCoursesRes.data ?? [],
    marketing: marketingRes.data ?? null,
    jobPostings: jobPostingsRes.data ?? [],
    socialSnapshots: socialSnapshotsRes.data ?? [],
    seoRankings: (seoRankingsRes.data ?? []) as Array<{
      position: number | null
      is_ad: boolean
      checked_at: string
      seo_keywords: { keyword: string } | { keyword: string }[] | null
    }>,
    alerts: alertsRes.data ?? [],
    insights: insightsRes.data ?? [],
  }
}

export default async function CompetitorProfilePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const competitor = await getCompetitor(slug)
  if (!competitor) notFound()

  const {
    sfCourses, marketing, jobPostings, socialSnapshots, seoRankings, alerts, insights,
  } = await getProfileData(competitor.id)

  // ── Overview stats ──────────────────────────────────────────────────────────
  const activeCourses = sfCourses.filter(c => c.is_active)
  const totalUpcomingRuns = activeCourses.reduce((sum, c) => sum + (c.upcoming_run_count ?? 0), 0)
  const activeJobPostings = jobPostings.filter(j => j.is_active)

  const latestByPlatform = new Map<string, typeof socialSnapshots[number]>()
  for (const s of socialSnapshots) {
    if (!latestByPlatform.has(s.platform)) latestByPlatform.set(s.platform, s)
  }
  const youtubeSnapshot = latestByPlatform.get('youtube') ?? null

  // ── Courses ──────────────────────────────────────────────────────────────────
  const topCourses = [...activeCourses]
    .sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    .slice(0, 10)

  const clusterMap = new Map<string, number>()
  for (const c of activeCourses) {
    const cluster = c.category_cluster ?? 'Other'
    clusterMap.set(cluster, (clusterMap.get(cluster) ?? 0) + (c.upcoming_run_count ?? 0))
  }
  const clusterDist = Array.from(clusterMap.entries()).sort((a, b) => b[1] - a[1])
  const maxClusterVal = Math.max(...clusterDist.map(([, v]) => v), 1)

  // ── Hiring ───────────────────────────────────────────────────────────────────
  const recentJobs = jobPostings.slice(0, 10)
  const functionCounts = new Map<string, number>()
  for (const j of jobPostings) {
    const bucket = classifyJobFunction(j.title)
    functionCounts.set(bucket, (functionCounts.get(bucket) ?? 0) + 1)
  }

  // ── SEO ──────────────────────────────────────────────────────────────────────
  const seoRows = seoRankings.map(r => {
    const kwRaw = r.seo_keywords
    const kw = Array.isArray(kwRaw) ? kwRaw[0] : kwRaw
    return { keyword: kw?.keyword ?? 'Unknown', position: r.position, is_ad: r.is_ad, checked_at: r.checked_at }
  })

  const status: 'active' | 'inactive' | 'archived' =
    competitor.archived_at ? 'archived' : competitor.active ? 'active' : 'inactive'

  return (
    <AppLayout title={competitor.name}>
      <div className="space-y-6 max-w-6xl">

        {/* ── Back link ── */}
        <Link href="/competitors" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Competitors
        </Link>

        {/* ── Header ── */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full border border-white/10 shrink-0" style={{ backgroundColor: competitor.color }} />
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl font-bold text-white tracking-tight">{competitor.name}</h1>
                  {competitor.is_hustle && (
                    <span className="text-[9px] font-mono bg-violet-900/50 text-violet-400 border border-violet-800/60 px-1.5 py-0.5 rounded">US</span>
                  )}
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded border font-medium',
                    competitor.tier === 'High' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : competitor.tier === 'Mid' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                  )}>
                    {competitor.tier}
                  </span>
                  <span className={cn(
                    'text-[10px] px-1.5 py-0.5 rounded border font-mono uppercase',
                    status === 'archived' ? 'bg-slate-800 text-slate-500 border-slate-700'
                      : status === 'inactive' ? 'bg-amber-950/40 text-amber-500 border-amber-800/50'
                      : 'bg-emerald-950/30 text-emerald-500 border-emerald-800/40'
                  )}>
                    {status}
                  </span>
                </div>
                {competitor.website && (
                  <a
                    href={competitor.website.startsWith('http') ? competitor.website : `https://${competitor.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-sky-500 hover:text-sky-400 mt-1 transition-colors"
                  >
                    {competitor.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 flex-wrap">
              {MODULE_CHIPS.map(m => {
                const on = Boolean(competitor[m.key])
                return (
                  <span
                    key={m.key}
                    title={`${m.title}: ${on ? 'tracked' : 'not tracked'}`}
                    className={cn(
                      'text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border',
                      on ? 'text-indigo-300 border-indigo-700/60 bg-indigo-950/40' : 'text-slate-600 border-slate-800 bg-slate-900/40 opacity-40'
                    )}
                  >
                    {m.letter}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── Overview cards ── */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">{formatNumber(totalUpcomingRuns)}</p>
            <p className="text-xs text-slate-500 mt-0.5">Upcoming SF runs</p>
            <DataSourceBadge kind="cached" className="mt-2" detail="MySkillsFuture course directory" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">{activeCourses.length}</p>
            <p className="text-xs text-slate-500 mt-0.5">Active SF courses</p>
            <DataSourceBadge kind="cached" className="mt-2" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">{marketing?.meta_ads ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-0.5">Meta ads (active)</p>
            <DataSourceBadge kind="live" className="mt-2" detail="Meta Ad Library API" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">
              {marketing?.google_reviews ? marketing.google_reviews.toLocaleString() : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              Google reviews{marketing?.google_rating ? ` · ★ ${Number(marketing.google_rating).toFixed(1)}` : ''}
            </p>
            <DataSourceBadge kind="live" className="mt-2" detail="Google Places API" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">{marketing?.google_ads ?? '—'}</p>
            <p className="text-xs text-slate-500 mt-0.5">Google ads (est.)</p>
            <DataSourceBadge kind="manual" asOf={marketing?.google_ads_verified_at ?? null} className="mt-2" detail="Google Ads Transparency (manual)" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">{activeJobPostings.length}</p>
            <p className="text-xs text-slate-500 mt-0.5">Active job postings</p>
            <DataSourceBadge kind="cached" className="mt-2" />
          </div>
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4">
            <p className="text-2xl font-bold text-white font-mono">
              {youtubeSnapshot?.follower_count !== undefined && youtubeSnapshot?.follower_count !== null
                ? formatNumber(youtubeSnapshot.follower_count)
                : '—'}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">YouTube subscribers</p>
            {youtubeSnapshot ? (
              <DataSourceBadge
                kind={youtubeSnapshot.data_source === 'verified_manual' ? 'manual' : youtubeSnapshot.data_source === 'api' ? 'live' : 'cached'}
                asOf={youtubeSnapshot.snapshot_date}
                className="mt-2"
              />
            ) : (
              <DataSourceBadge kind="unavailable" className="mt-2" />
            )}
          </div>
        </div>

        {/* ── Courses section ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Courses</h2>
            <DataSourceBadge kind="cached" detail="MySkillsFuture course directory" />
          </div>
          {topCourses.length === 0 ? (
            <DataUnavailable label="No SkillsFuture course data available" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-800">
                      <th className="text-left px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Title</th>
                      <th className="text-left px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Cluster</th>
                      <th className="text-right px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Runs</th>
                      <th className="text-right px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Respondents</th>
                      <th className="text-right px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topCourses.map((c, i) => (
                      <tr key={i} className="border-b border-slate-800/40">
                        <td className="px-2 py-2 text-xs text-white max-w-[180px] truncate" title={c.title}>{c.title}</td>
                        <td className="px-2 py-2 text-xs text-slate-400">{c.category_cluster ?? '—'}</td>
                        <td className="px-2 py-2 text-xs text-right text-white font-mono">{c.upcoming_run_count ?? 0}</td>
                        <td className="px-2 py-2 text-xs text-right text-slate-400 font-mono">{c.respondent_count ?? '—'}</td>
                        <td className="px-2 py-2 text-xs text-right text-slate-400 font-mono">
                          {c.course_fee ? `$${Number(c.course_fee).toFixed(0)}` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">Cluster distribution (by upcoming runs)</p>
                <div className="space-y-2">
                  {clusterDist.map(([cluster, val]) => (
                    <div key={cluster} className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 w-40 truncate shrink-0" title={cluster}>{cluster}</span>
                      <div className="flex-1 bg-slate-800 rounded-full h-1.5">
                        <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${(val / maxClusterVal) * 100}%` }} />
                      </div>
                      <span className="text-xs text-white font-mono w-8 text-right">{val}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Hiring section ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Hiring</h2>
            <DataSourceBadge kind="cached" />
          </div>
          {recentJobs.length === 0 ? (
            <DataUnavailable label="No job posting data available" />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-1.5">
                {recentJobs.map((j, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 border-b border-slate-800/50 text-xs">
                    <span className="text-white truncate max-w-[220px]" title={j.title}>{j.title}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-slate-500 font-mono">{j.source}</span>
                      <span className="text-slate-600">{j.posted_at ? formatDate(j.posted_at) : formatDate(j.scraped_at)}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">By function</p>
                <div className="space-y-2">
                  {Array.from(functionCounts.entries()).sort((a, b) => b[1] - a[1]).map(([bucket, count]) => (
                    <div key={bucket} className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">{bucket}</span>
                      <span className="text-white font-mono">{count}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ── Social section ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Social</h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            {SOCIAL_PLATFORMS.map(p => {
              const snap = latestByPlatform.get(p)
              return (
                <div key={p} className="bg-slate-800/40 border border-slate-700/50 rounded-lg p-3">
                  <p className="text-xs text-slate-400 mb-1">{PLATFORM_LABELS[p]}</p>
                  <p className="text-lg font-bold text-white font-mono">
                    {snap?.follower_count !== undefined && snap?.follower_count !== null ? formatNumber(snap.follower_count) : '—'}
                  </p>
                  {snap ? (
                    <DataSourceBadge
                      kind={snap.data_source === 'verified_manual' ? 'manual' : snap.data_source === 'api' ? 'live' : 'cached'}
                      asOf={snap.snapshot_date}
                      className="mt-1.5"
                    />
                  ) : (
                    <DataSourceBadge kind="unavailable" className="mt-1.5" />
                  )}
                </div>
              )
            })}
          </div>
        </section>

        {/* ── SEO section ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">SEO Rankings</h2>
            <DataSourceBadge kind="static" detail="Manual Google Search snapshot" />
          </div>
          {seoRows.length === 0 ? (
            <DataUnavailable label="No SEO ranking data available" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-left px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Keyword</th>
                    <th className="text-right px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Position</th>
                    <th className="text-right px-2 py-2 text-[10px] font-mono text-slate-500 uppercase tracking-wide">Ad?</th>
                  </tr>
                </thead>
                <tbody>
                  {seoRows.map((r, i) => (
                    <tr key={i} className="border-b border-slate-800/40">
                      <td className="px-2 py-2 text-xs text-white">{r.keyword}</td>
                      <td className="px-2 py-2 text-xs text-right text-slate-300 font-mono">{r.position ?? 'Not ranking'}</td>
                      <td className="px-2 py-2 text-xs text-right text-slate-400">{r.is_ad ? 'Yes' : 'No'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ── Recent alerts ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4">Recent Alerts</h2>
          {alerts.length === 0 ? (
            <DataUnavailable label="No alerts for this competitor" />
          ) : (
            <div className="space-y-2">
              {alerts.map(a => (
                <div key={a.id} className="flex items-start justify-between gap-3 p-3 bg-slate-800/30 border border-slate-800/60 rounded-lg">
                  <div>
                    <p className="text-sm text-white font-medium">{a.title}</p>
                    {a.description && <p className="text-xs text-slate-500 mt-0.5">{a.description}</p>}
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">{formatDate(a.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── AI mentions ── */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">AI Mentions</h2>
            <DataSourceBadge kind="ai" />
          </div>
          {insights.length === 0 ? (
            <DataUnavailable label="No AI-generated strategic insights mention this competitor" />
          ) : (
            <div className="space-y-2">
              {insights.map(ins => (
                <div key={ins.id} className="flex items-start justify-between gap-3 p-3 bg-slate-800/30 border border-slate-800/60 rounded-lg">
                  <div>
                    <p className="text-sm text-white font-medium">{ins.title}</p>
                    <p className="text-[10px] text-slate-500 mt-0.5 font-mono uppercase">{ins.insight_type}</p>
                  </div>
                  <span className="text-xs text-slate-600 shrink-0">{formatDate(ins.created_at)}</span>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-slate-600 mt-4 leading-relaxed">
            Strengths, weaknesses, and counter-strategy assessments are derived from AI-generated strategic insights
            above. No content is fabricated beyond what appears in these insights.
          </p>
        </section>

        {/* ── Back link (bottom) ── */}
        <Link href="/competitors" className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Competitors
        </Link>
      </div>
    </AppLayout>
  )
}
