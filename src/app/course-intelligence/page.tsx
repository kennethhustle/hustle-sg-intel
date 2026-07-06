import { createServiceClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'
import { ModuleStatus } from '@/components/dashboard/module-status'
import { SourcePanel } from '@/components/dashboard/source-panel'
import { classifyCourse } from '@/lib/services/courses/categories'

export const revalidate = 300

// ═══════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════

const SF_URL = (ref: string) =>
  `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}`

const SCHED_URL = (ref: string) => `${SF_URL(ref)}#schedule`

function fmtDT(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }).toUpperCase(),
    time: d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }),
  }
}

function fmtScraped(iso: string) {
  const d = new Date(iso)
  return d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' })
}

function isHustleRaw(raw: string) { return raw.toUpperCase().includes('HUSTLE') }

// Neutral fallback palette used when a provider has no competitor_id match
// (and therefore no competitors.color) — cycled by provider name hash.
const FALLBACK_PALETTE = ['#94a3b8', '#64748b', '#a1a1aa', '#78716c', '#71717a']
function fallbackColor(name: string) {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length]
}

function demand(runs: number): { label: string; icon: string; cls: string } {
  if (runs >= 20) return { label: 'VERY HIGH', icon: '🔥', cls: 'text-red-500' }
  if (runs >= 5)  return { label: 'HIGH',      icon: '⚡', cls: 'text-yellow-400' }
  if (runs >= 2)  return { label: 'MEDIUM',    icon: '◈',  cls: 'text-blue-400' }
  return              { label: 'LOW',      icon: '·',  cls: 'text-slate-500' }
}

// ═══════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════

interface Course {
  sf_ref_no: string
  title: string
  provider_name: string
  competitor_id: string | null
  category_text: string | null
  has_active_runs: boolean
  respondent_count: number
  upcoming_run_count: number
  scraped_at: string
  category_cluster: string | null
  course_fee: number | null
  first_seen_at: string | null
  last_seen_at: string | null
  is_active: boolean
}

interface CompetitorInfo {
  id: string
  name: string
  color: string
  is_hustle: boolean
}

interface ProviderRow {
  /** Grouping key: competitor id when known, else the raw provider_name string */
  key: string
  name: string
  color: string
  isHustle: boolean
  topCourse: Course
  top3: Course[]
  topRuns: number
  fees: number[]
}

// ═══════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function getData() {
  const supabase = await createServiceClient()

  const [{ data, error }, { data: competitorRows }] = await Promise.all([
    supabase
      .from('sf_courses')
      .select(
        'sf_ref_no, title, provider_name, competitor_id, category_text, has_active_runs, respondent_count, upcoming_run_count, scraped_at, category_cluster, course_fee, first_seen_at, last_seen_at, is_active',
      ),
    supabase.from('competitors').select('id, name, color, is_hustle'),
  ])

  if (error || !data || data.length === 0) return null

  const courses = data as Course[]
  const competitors = (competitorRows ?? []) as CompetitorInfo[]
  const competitorById = new Map(competitors.map(c => [c.id, c]))

  const lastScraped = courses.reduce(
    (m, c) => (c.scraped_at > m ? c.scraped_at : m),
    courses[0].scraped_at,
  )

  // Resolve a course to its display group: competitor row when competitor_id
  // matches a known competitor, otherwise fall back to the raw provider_name
  // string (grouping key = provider_name in that case).
  function resolveGroup(c: Course): { key: string; name: string; color: string; isHustle: boolean } {
    const comp = c.competitor_id ? competitorById.get(c.competitor_id) : undefined
    if (comp) {
      return { key: comp.id, name: comp.name, color: comp.color, isHustle: comp.is_hustle }
    }
    return { key: c.provider_name, name: c.provider_name, color: fallbackColor(c.provider_name), isHustle: isHustleRaw(c.provider_name) }
  }

  // ── Group by competitor (fallback: provider_name string) ──
  const pMap = new Map<string, { group: ReturnType<typeof resolveGroup>; courses: Course[] }>()
  for (const c of courses) {
    const group = resolveGroup(c)
    const existing = pMap.get(group.key)
    if (existing) existing.courses.push(c)
    else pMap.set(group.key, { group, courses: [c] })
  }

  const rows: ProviderRow[] = Array.from(pMap.values()).map(({ group, courses: pc }) => {
    const sorted = [...pc].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    return {
      key: group.key,
      name: group.name,
      color: group.color,
      isHustle: group.isHustle,
      topCourse: sorted[0],
      top3: sorted.slice(0, 3),
      topRuns: sorted[0]?.upcoming_run_count ?? 0,
      fees: pc.map(c => c.course_fee).filter((f): f is number => f != null),
    }
  })

  // Only providers with at least one course with a real run count
  const activeRows = rows.filter(r => r.topRuns > 0)
  activeRows.sort((a, b) => b.topRuns - a.topRuns)

  const maxRuns    = activeRows[0]?.topRuns ?? 1
  const hasRunData = activeRows.length > 0

  // ── Validation sample: Hustle SG + top tracked competitors, sorted by
  //    provider then run count DESC. Driven by the competitors table rather
  //    than a hardcoded provider name list. ──
  const topCompetitorIds = new Set(
    [...activeRows]
      .filter(r => !r.isHustle)
      .slice(0, 4)
      .map(r => r.key)
  )
  const hustleIds = new Set(competitors.filter(c => c.is_hustle).map(c => c.id))
  const validationCourses = courses
    .filter(c => (c.competitor_id && (hustleIds.has(c.competitor_id) || topCompetitorIds.has(c.competitor_id))) || isHustleRaw(c.provider_name))
    .sort((a, b) => {
      const ga = resolveGroup(a).name
      const gb = resolveGroup(b).name
      if (ga !== gb) return ga.localeCompare(gb)
      return (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0)
    })
  const validationLabel = [...hustleIds].length > 0 || topCompetitorIds.size > 0
    ? Array.from(new Set(validationCourses.map(c => resolveGroup(c).name))).join(' · ')
    : 'No competitors configured'

  // ── Category Clusters: aggregate by category_cluster (fallback to classifyCourse) ──
  type ClusterAgg = {
    cluster: string
    totalRuns: number
    providers: Set<string>
    hustleRuns: number
  }
  const clusterMap = new Map<string, ClusterAgg>()
  for (const c of courses) {
    const cluster = c.category_cluster ?? classifyCourse(c.title, c.category_text)
    const group = resolveGroup(c)
    const agg = clusterMap.get(cluster) ?? { cluster, totalRuns: 0, providers: new Set<string>(), hustleRuns: 0 }
    const runs = c.upcoming_run_count ?? 0
    agg.totalRuns += runs
    agg.providers.add(group.key)
    if (group.isHustle) agg.hustleRuns += runs
    clusterMap.set(cluster, agg)
  }
  // Compute best-competitor total runs per cluster (sum across their courses, not just max single course)
  const clusterCompetitorRuns = new Map<string, Map<string, { name: string; runs: number }>>()
  for (const c of courses) {
    const group = resolveGroup(c)
    if (group.isHustle) continue
    const cluster = c.category_cluster ?? classifyCourse(c.title, c.category_text)
    const byProvider = clusterCompetitorRuns.get(cluster) ?? new Map<string, { name: string; runs: number }>()
    const existing = byProvider.get(group.key)
    const runs = (existing?.runs ?? 0) + (c.upcoming_run_count ?? 0)
    byProvider.set(group.key, { name: group.name, runs })
    clusterCompetitorRuns.set(cluster, byProvider)
  }
  const categoryClusters = Array.from(clusterMap.values()).map(agg => {
    const byProvider = clusterCompetitorRuns.get(agg.cluster)
    let best: { name: string; runs: number } | null = null
    if (byProvider) {
      for (const { name, runs } of byProvider.values()) {
        if (!best || runs > best.runs) best = { name, runs }
      }
    }
    const isGap = agg.hustleRuns === 0 || (best != null && agg.hustleRuns < best.runs * 0.5)
    return {
      cluster: agg.cluster,
      totalRuns: agg.totalRuns,
      providerCount: agg.providers.size,
      hustleRuns: agg.hustleRuns,
      bestCompetitor: best,
      isGap,
    }
  }).sort((a, b) => b.totalRuns - a.totalRuns)

  // ── New courses (last 7 days) ──
  const now = Date.now()
  const SEVEN_DAYS = 7 * 86_400_000
  const FOURTEEN_DAYS = 14 * 86_400_000
  const newCourses = courses
    .filter(c => c.first_seen_at && now - new Date(c.first_seen_at).getTime() <= SEVEN_DAYS)
    .sort((a, b) => (b.first_seen_at ?? '').localeCompare(a.first_seen_at ?? ''))

  // ── Recently deactivated (is_active=false AND last_seen_at within last 14 days) ──
  const recentlyDeactivated = courses
    .filter(c => c.is_active === false && c.last_seen_at && now - new Date(c.last_seen_at).getTime() <= FOURTEEN_DAYS)
    .sort((a, b) => (b.last_seen_at ?? '').localeCompare(a.last_seen_at ?? ''))

  return {
    rows: activeRows,
    maxRuns,
    hasRunData,
    lastScraped,
    totalCourses: courses.length,
    totalEntities: activeRows.length,
    debugCourses: validationCourses,
    validationLabel,
    categoryClusters,
    newCourses,
    recentlyDeactivated,
    resolveGroup,
  }
}

// ═══════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════

const MEDALS = ['🥇', '🥈', '🥉']

export default async function CourseIntelligencePage() {
  const d = await getData()

  if (!d) {
    return (
      <AppLayout title="MySkillsFuture Intelligence">
        <div className="flex items-center justify-center h-64 font-mono">
          <div className="text-center">
            <p className="text-slate-400 text-sm">MYSKILLSFUTURE DEMAND INTELLIGENCE</p>
            <p className="text-slate-600 text-xs mt-2">No data available. Run sf-refresh cron.</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  const { rows, maxRuns, hasRunData, lastScraped, totalCourses, totalEntities, debugCourses, validationLabel, categoryClusters, newCourses, recentlyDeactivated, resolveGroup } = d
  const { date, time } = fmtDT(lastScraped)
  const podium = rows.slice(0, 3)

  return (
    <AppLayout title="MySkillsFuture Intelligence" lastUpdated={lastScraped}>
      <div className="space-y-6">

        <ModuleStatus module="sf_courses" sourceLabel="MySkillsFuture cached data" />

        {/* ══ STATUS ROW ══ */}
        <div className="flex items-center gap-3 font-mono text-xs text-slate-500 flex-wrap">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400">LIVE MONITORING</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>{totalEntities} providers tracked</span>
          <span className="text-slate-700">·</span>
          <span>DATA: {date} {time} SGT</span>
          <DataSourceBadge kind="live" asOf={lastScraped} detail="MySkillsFuture API + nightly scrape" />
        </div>

        {/* ══ RUN DATA PENDING BANNER ══ */}
        {!hasRunData && (
          <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3">
            <span className="text-amber-400 text-lg shrink-0">⏳</span>
            <div>
              <p className="text-amber-300 text-sm font-semibold">Course run data pending</p>
              <p className="text-amber-700 text-xs mt-0.5">
                upcoming_run_count is 0 for all {totalCourses} courses. Run counts refresh nightly at 00:10 SGT (runcount-refresh cron).
                The Schedule tab on MySkillsFuture shows the count as &quot;Showing 1–X of <strong>N course runs</strong>&quot; —
                our scraper reads this from doclist.numFound in the Solr API.
              </p>
            </div>
          </div>
        )}

        {/* ══ DATA QUALITY NOTE ══ */}
        <div className="flex items-start gap-3 bg-amber-950/20 border border-amber-800/30 rounded-lg px-4 py-3">
          <span className="text-amber-400 text-sm shrink-0 font-mono">⚠</span>
          <div className="text-xs text-amber-700 font-mono leading-relaxed">
            <span className="text-amber-500 font-semibold">DATA SOURCE:</span>{' '}
            upcoming_run_count is sourced from the MySF API (run counts refresh nightly at 00:10 SGT via runcount-refresh). The API may include
            provider-planned unpublished run slots that are not yet publicly visible on the MySF schedule page.
            Values shown are direct DB values — verify against the{' '}
            <span className="text-amber-500">↗ schedule links</span> below for confirmation.
            Run count = 0 courses are excluded from this view.
          </div>
        </div>

        {/* ══ PODIUM — TOP 3 ══ */}
        <div className="grid grid-cols-3 gap-3">
          {podium.map((r, i) => {
            const dmnd = demand(r.topRuns)
            const c = r.color
            const icons = ['🏆', '🥈', '🥉']
            const sizes = ['text-5xl', 'text-4xl', 'text-4xl']
            const borders = [
              'border-yellow-700/50 bg-yellow-950/20',
              'border-slate-600/40 bg-slate-800/30',
              'border-orange-800/40 bg-orange-950/15',
            ]
            return (
              <div key={r.key} className={`rounded-xl border ${borders[i]} p-5 flex flex-col gap-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-mono text-slate-500 tracking-wider">
                    #{i + 1} HIGHEST DEMAND
                  </span>
                  <span className="text-lg">{icons[i]}</span>
                </div>
                <div className="font-bold text-sm tracking-wide" style={{ color: c }}>
                  {r.name.toUpperCase()}
                  {r.isHustle && (
                    <span className="ml-2 text-[10px] font-mono bg-violet-900/60 text-violet-300 border border-violet-700/60 px-1.5 py-0.5 rounded">
                      YOU
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className={`font-bold font-mono ${sizes[i]} text-slate-100`}>
                    {hasRunData ? r.topRuns : '—'}
                  </span>
                  <span className="text-slate-500 text-sm font-mono">RUNS</span>
                </div>
                {r.topCourse && (
                  <a
                    href={SCHED_URL(r.topCourse.sf_ref_no)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-400 text-xs hover:text-slate-200 transition-colors line-clamp-2 leading-snug"
                  >
                    {r.topCourse.title} ↗
                  </a>
                )}
                <div className={`text-xs font-mono mt-auto ${dmnd.cls}`}>
                  {dmnd.icon} {dmnd.label}
                </div>
              </div>
            )
          })}
        </div>
        <p className="text-[11px] text-slate-500 -mt-3">Source: MySkillsFuture API + run scraper</p>

        {/* ══ LEADERBOARD ══ */}
        <div className="rounded-xl border border-slate-800/60 overflow-hidden">

          <div className="grid grid-cols-[2.5rem_1fr_auto] items-center px-5 py-2 bg-slate-900/60 border-b border-slate-800/60 text-[10px] font-mono text-slate-600 tracking-widest uppercase gap-4">
            <span>#</span>
            <span>Provider / Top Course</span>
            <span className="text-right">Runs · Demand</span>
          </div>

          {rows.map((r, i) => {
            const dmnd = demand(r.topRuns)
            const c = r.color
            const barPct = maxRuns > 0 ? Math.max(1, Math.round((r.topRuns / maxRuns) * 100)) : 0
            const barColor = r.topRuns >= 20 ? '#ef4444' : r.topRuns >= 5 ? '#f59e0b' : '#475569'
            const medianFee = median(r.fees)

            return (
              <details
                key={r.key}
                className="group border-b border-slate-800/40 last:border-0"
              >
                <summary className="grid grid-cols-[2.5rem_1fr_auto] items-center px-5 py-3.5 gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-slate-800/30 transition-colors select-none">

                  <span className="text-slate-600 font-mono text-sm text-center">{i + 1}</span>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="font-bold text-xs tracking-widest font-mono" style={{ color: c }}>
                        {r.name.toUpperCase()}
                      </span>
                      {r.isHustle && (
                        <span className="text-[9px] font-mono bg-violet-900/50 text-violet-400 border border-violet-800/60 px-1.5 py-px rounded">
                          YOU
                        </span>
                      )}
                      {medianFee != null && (
                        <span className="text-[10px] font-mono text-slate-500">
                          median fee ${medianFee.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        </span>
                      )}
                      <span className="text-slate-700 text-[10px] font-mono ml-auto group-open:rotate-180 transition-transform">▾</span>
                    </div>
                    {r.topCourse && (
                      <a
                        href={SCHED_URL(r.topCourse.sf_ref_no)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-200 text-sm hover:text-orange-400 transition-colors"
                      >
                        {r.topCourse.title} ↗
                      </a>
                    )}
                    <div className="mt-2 h-0.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>

                  <div className="text-right shrink-0 w-28">
                    {hasRunData ? (
                      <a
                        href={r.topCourse ? SCHED_URL(r.topCourse.sf_ref_no) : '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-block hover:opacity-80 transition-opacity"
                      >
                        <span className="font-bold font-mono text-2xl text-slate-100">{r.topRuns}</span>
                        <span className="text-slate-500 text-xs font-mono ml-1">RUNS</span>
                      </a>
                    ) : (
                      <span className="text-slate-600 font-mono text-xs">PENDING</span>
                    )}
                    <div className={`text-xs font-mono mt-0.5 ${dmnd.cls}`}>
                      {dmnd.icon} {dmnd.label}
                    </div>
                  </div>
                </summary>

                {/* ── Expanded: top 3 courses ── */}
                <div className="px-5 pb-4 pt-1 bg-slate-900/40 border-t border-slate-800/40">
                  <p className="text-[10px] font-mono text-slate-600 tracking-widest uppercase mb-3">
                    Top 3 Courses by Upcoming Run Count
                  </p>
                  <div className="space-y-3">
                    {r.top3.map((c2, j) => {
                      const runs2 = c2.upcoming_run_count ?? 0
                      const att   = c2.respondent_count ?? 0
                      return (
                        <div key={c2.sf_ref_no} className="flex items-start gap-3">
                          <span className="text-xl shrink-0 leading-none">{MEDALS[j] ?? `${j + 1}.`}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-baseline justify-between gap-3 flex-wrap">
                              <a
                                href={SF_URL(c2.sf_ref_no)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-200 text-sm font-medium hover:text-orange-400 transition-colors"
                              >
                                {c2.title} ↗
                              </a>
                              <div className="shrink-0 flex items-baseline gap-2">
                                {runs2 > 0 ? (
                                  <a
                                    href={SCHED_URL(c2.sf_ref_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold font-mono text-orange-400 hover:text-orange-300 transition-colors"
                                  >
                                    {runs2} <span className="text-slate-500 text-xs">Runs ↗</span>
                                  </a>
                                ) : (
                                  <span className="text-slate-600 font-mono text-xs">RUN COUNT NOT VERIFIED</span>
                                )}
                                {att > 0 && (
                                  <span className="text-slate-500 text-xs">
                                    · {att >= 1000 ? `${(att / 1000).toFixed(1)}K` : att} Attended
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600">
                              <span className="font-mono">{c2.sf_ref_no}</span>
                              {c2.category_text && <span>· {c2.category_text}</span>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </details>
            )
          })}
        </div>

        {/* ══ CATEGORY CLUSTERS ══ */}
        <div className="rounded-xl border border-slate-800/60 overflow-hidden">
          <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800/60 flex items-center justify-between">
            <span className="text-[10px] font-mono text-slate-400 tracking-widest uppercase">Category Clusters</span>
            <span className="text-[10px] font-mono text-slate-600">Hustle&apos;s runs vs best competitor, per cluster</span>
          </div>
          {categoryClusters.length === 0 ? (
            <p className="text-slate-600 text-xs font-mono px-5 py-4">No category cluster data available.</p>
          ) : (
            <div className="divide-y divide-slate-800/40">
              {categoryClusters.map(cl => (
                <div key={cl.cluster} className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <span className="text-sm font-semibold text-slate-200">{cl.cluster}</span>
                    <div className="text-[10px] text-slate-600 font-mono mt-0.5">{cl.providerCount} provider{cl.providerCount === 1 ? '' : 's'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-slate-600 font-mono uppercase">Total Runs</div>
                    <div className="text-sm font-mono font-bold text-slate-200">{cl.totalRuns}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-slate-600 font-mono uppercase">Hustle vs Best</div>
                    <div className="text-sm font-mono">
                      <span className="text-violet-300 font-bold">{cl.hustleRuns}</span>
                      <span className="text-slate-600"> / </span>
                      <span className="text-slate-300">{cl.bestCompetitor?.runs ?? 0}</span>
                      {cl.bestCompetitor && <span className="text-slate-600 text-[10px]"> ({cl.bestCompetitor.name})</span>}
                    </div>
                  </div>
                  <div className="text-right w-20">
                    {cl.isGap ? (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border bg-red-950/60 text-red-400 border-red-800/50">
                        GAP
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border bg-emerald-950/60 text-emerald-400 border-emerald-800/50">
                        LEADING
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ══ NEW COURSES / RECENTLY DEACTIVATED ══ */}
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-800/60 overflow-hidden">
            <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800/60">
              <span className="text-[10px] font-mono text-emerald-400 tracking-widest uppercase">New Courses (Last 7 Days)</span>
            </div>
            {newCourses.length === 0 ? (
              <p className="text-slate-600 text-xs font-mono px-5 py-4">No new courses detected in the last 7 days.</p>
            ) : (
              <div className="divide-y divide-slate-800/40 max-h-72 overflow-y-auto">
                {newCourses.map(c => (
                  <div key={c.sf_ref_no} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <a href={SF_URL(c.sf_ref_no)} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-200 hover:text-emerald-400 transition-colors line-clamp-1">
                        {c.title} ↗
                      </a>
                      <div className="text-[10px] text-slate-600 font-mono mt-0.5">{resolveGroup(c).name}</div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {c.first_seen_at ? new Date(c.first_seen_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-800/60 overflow-hidden">
            <div className="px-5 py-3 bg-slate-900/60 border-b border-slate-800/60">
              <span className="text-[10px] font-mono text-red-400 tracking-widest uppercase">Recently Deactivated (Last 14 Days)</span>
            </div>
            {recentlyDeactivated.length === 0 ? (
              <p className="text-slate-600 text-xs font-mono px-5 py-4">No courses deactivated in the last 14 days.</p>
            ) : (
              <div className="divide-y divide-slate-800/40 max-h-72 overflow-y-auto">
                {recentlyDeactivated.map(c => (
                  <div key={c.sf_ref_no} className="px-5 py-2.5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <a href={SF_URL(c.sf_ref_no)} target="_blank" rel="noopener noreferrer" className="text-xs text-slate-400 hover:text-red-400 transition-colors line-clamp-1">
                        {c.title} ↗
                      </a>
                      <div className="text-[10px] text-slate-600 font-mono mt-0.5">{resolveGroup(c).name}</div>
                    </div>
                    <span className="text-[10px] text-slate-500 font-mono shrink-0">
                      {c.last_seen_at ? new Date(c.last_seen_at).toLocaleDateString('en-SG', { day: '2-digit', month: 'short' }) : '—'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ══ VALIDATION SAMPLE ══ */}
        <details className="group rounded-xl border border-slate-800/60 overflow-hidden">
          <summary className="flex items-center justify-between px-5 py-3 bg-slate-900/60 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-slate-800/40 transition-colors select-none">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-400 tracking-widest uppercase">🔬 Validation Sample</span>
              <span className="text-[10px] font-mono text-slate-600">{validationLabel}</span>
            </div>
            <span className="text-slate-700 text-[10px] font-mono group-open:rotate-180 transition-transform">▾</span>
          </summary>

          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead>
                <tr className="border-b border-slate-800/60 bg-slate-900/40">
                  <th className="text-left px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Provider</th>
                  <th className="text-left px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal">Course</th>
                  <th className="text-right px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Run Count</th>
                  <th className="text-right px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Attended</th>
                  <th className="text-left px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Ref No</th>
                  <th className="text-left px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Source</th>
                  <th className="text-left px-4 py-2 text-[10px] text-slate-600 tracking-widest uppercase font-normal whitespace-nowrap">Scraped At</th>
                </tr>
              </thead>
              <tbody>
                {debugCourses.map((c, idx) => {
                  const group = resolveGroup(c)
                  const provName = group.name
                  const clr = group.color
                  const runs = c.upcoming_run_count ?? 0
                  const att  = c.respondent_count ?? 0
                  const isZero = runs === 0
                  return (
                    <tr
                      key={c.sf_ref_no}
                      className={`border-b border-slate-800/30 last:border-0 ${idx % 2 === 0 ? 'bg-transparent' : 'bg-slate-900/20'} ${isZero ? 'opacity-40' : ''}`}
                    >
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <span className="font-bold text-[10px] tracking-wide" style={{ color: clr }}>
                          {provName.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 max-w-xs">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-300 hover:text-orange-400 transition-colors leading-snug"
                        >
                          {c.title} ↗
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {isZero ? (
                          <span className="text-slate-600">NOT VERIFIED</span>
                        ) : (
                          <a
                            href={SCHED_URL(c.sf_ref_no)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-bold text-orange-400 hover:text-orange-300 transition-colors"
                          >
                            {runs} ↗
                          </a>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-500 whitespace-nowrap">
                        {att > 0 ? (att >= 1000 ? `${(att / 1000).toFixed(1)}K` : att) : '—'}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-600 hover:text-slate-400 transition-colors text-[10px]"
                        >
                          {c.sf_ref_no}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        <a
                          href={SCHED_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sky-700 hover:text-sky-500 transition-colors text-[10px]"
                        >
                          Schedule ↗
                        </a>
                      </td>
                      <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap text-[10px]">
                        {fmtScraped(c.scraped_at)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>

        {/* ══ DATA SOURCES ══ */}
        <SourcePanel
          module="course_intelligence"
          extraLines={[`Cached in Supabase — ${totalCourses.toLocaleString()} course records`]}
        />

        {/* ══ FOOTER ══ */}
        <footer className="text-[10px] font-mono text-slate-700 space-y-0.5 pb-4">
          <p>
            SOURCE: MySF API (upcoming_run_count) · Schedule tab shows &quot;Showing 1–X of <strong className="text-slate-600">N course runs</strong>&quot; ·
            API may include unpublished provider-planned run slots · Click ↗ links to verify live counts
          </p>
          <p>
            HUSTLE SG = HUSTLE INSTITUTE PTE. LTD. + HUSTLE ACADEMY PTE. LTD. ·{' '}
            {totalCourses} courses indexed · Attended = Course_Quality_NumberOfRespondents ·
            Run Count = 0 courses hidden from leaderboard (shown greyed in validation sample)
          </p>
        </footer>

      </div>
    </AppLayout>
  )
}
