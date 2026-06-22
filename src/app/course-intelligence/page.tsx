import { createServiceClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'

export const revalidate = 300

// ═══════════════════════════════════════════════════
// CONSTANTS & HELPERS
// ═══════════════════════════════════════════════════

const SF_URL   = (ref: string) =>
  `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}`

// Schedule tab lives on the same page — #schedule fragment
const SCHED_URL = (ref: string) => `${SF_URL(ref)}#schedule`

function fmtDT(iso: string) {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }).toUpperCase(),
    time: d.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }),
  }
}

function isHustle(raw: string) { return raw.toUpperCase().includes('HUSTLE') }

const GROUP: Record<string, string> = {
  'BELLS INSTITUTE OF HIGHER LEARNING PTE. LTD.': 'BELLS Institute',
  'VERTICAL INSTITUTE PTE. LTD.': 'Vertical Institute',
  'OOM PTE. LTD.': 'OOm Pte Ltd',
  'SKILLS DEVELOPMENT ACADEMY PTE. LTD.': 'Skills Dev Academy',
  'INFO-TECH SYSTEMS LTD.': 'InfoTech Academy',
  '@ASK TRAINING PTE. LTD.': 'ASK Training',
  'HEICODERS ACADEMY PRIVATE LIMITED': 'Heicoders Academy',
  'HAPPY TOGETHER PTE. LTD.': 'Happy Together',
  'EQUINET ACADEMY PRIVATE LIMITED': 'Equinet Academy',
  'HUSTLE INSTITUTE PTE. LTD.': 'Hustle SG',
  'HUSTLE ACADEMY PTE. LTD.': 'Hustle SG',
}
function grp(raw: string) { return isHustle(raw) ? 'Hustle SG' : (GROUP[raw] ?? raw) }

// One distinct colour per provider — matches "LIVE MONITORING" terminal palette
const COLORS: Record<string, string> = {
  'InfoTech Academy':   '#00d4e0',
  'Skills Dev Academy': '#ff5555',
  'OOm Pte Ltd':        '#00c8c8',
  'Hustle SG':          '#a855f7',
  'Heicoders Academy':  '#22d3ee',
  'ASK Training':       '#f0c000',
  'Equinet Academy':    '#f59e0b',
  'BELLS Institute':    '#e2e8f0',
  'Vertical Institute': '#4ade80',
  'Happy Together':     '#f472b6',
}
function color(name: string) { return COLORS[name] ?? '#94a3b8' }

// Demand level from run count — thresholds calibrated to screenshot
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
  category_text: string | null
  has_active_runs: boolean
  respondent_count: number
  upcoming_run_count: number
  scraped_at: string
}

interface ProviderRow {
  name: string
  isHustle: boolean
  topCourse: Course
  top3: Course[]
  topRuns: number
}

// ═══════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════

async function getData() {
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('sf_courses')
    .select(
      'sf_ref_no, title, provider_name, category_text, has_active_runs, respondent_count, upcoming_run_count, scraped_at',
    )

  if (error || !data || data.length === 0) return null

  const courses = data as Course[]
  const lastScraped = courses.reduce(
    (m, c) => (c.scraped_at > m ? c.scraped_at : m),
    courses[0].scraped_at,
  )

  // Group by normalised provider
  const pMap = new Map<string, Course[]>()
  for (const c of courses) {
    const k = grp(c.provider_name)
    if (!pMap.has(k)) pMap.set(k, [])
    pMap.get(k)!.push(c)
  }

  const rows: ProviderRow[] = Array.from(pMap.entries()).map(([name, pc]) => {
    const sorted = [...pc].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    return {
      name,
      isHustle: isHustle(pc[0].provider_name),
      topCourse: sorted[0],
      top3: sorted.slice(0, 3),
      topRuns: sorted[0]?.upcoming_run_count ?? 0,
    }
  })

  // Sort purely by top course run count DESC (no Hustle pin — honest leaderboard)
  // Only show providers where at least one course has a real run count
  const activeRows = rows.filter(r => r.topRuns > 0)
  activeRows.sort((a, b) => b.topRuns - a.topRuns)

  const maxRuns   = activeRows[0]?.topRuns ?? 1
  const hasRunData = activeRows.length > 0

  return {
    rows: activeRows,
    maxRuns,
    hasRunData,
    lastScraped,
    totalCourses: courses.length,
    totalEntities: activeRows.length,
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

  const { rows, maxRuns, hasRunData, lastScraped, totalCourses, totalEntities } = d
  const { date, time } = fmtDT(lastScraped)
  const podium = rows.slice(0, 3)

  return (
    <AppLayout title="MySkillsFuture Intelligence" lastUpdated={lastScraped}>
      <div className="space-y-6">

        {/* ══ STATUS ROW ══ */}
        <div className="flex items-center gap-3 font-mono text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-green-400">LIVE MONITORING</span>
          </span>
          <span className="text-slate-700">·</span>
          <span>{totalEntities} providers tracked</span>
          <span className="text-slate-700">·</span>
          <span>DATA: {date} {time} SGT</span>
        </div>

        {/* ══ RUN DATA PENDING BANNER ══ */}
        {!hasRunData && (
          <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-800/40 rounded-lg px-4 py-3">
            <span className="text-amber-400 text-lg shrink-0">⏳</span>
            <div>
              <p className="text-amber-300 text-sm font-semibold">Course run data pending</p>
              <p className="text-amber-700 text-xs mt-0.5">
                upcoming_run_count is 0 for all {totalCourses} courses. Populates after next scrape at 01:00 SGT.
                The Schedule tab on MySkillsFuture shows the count as &quot;Showing 1–X of <strong>N course runs</strong>&quot; —
                our scraper reads this from doclist.numFound in the Solr API.
              </p>
            </div>
          </div>
        )}

        {/* ══ PODIUM — TOP 3 ══ */}
        <div className="grid grid-cols-3 gap-3">
          {podium.map((r, i) => {
            const dmnd = demand(r.topRuns)
            const c = color(r.name)
            const icons = ['🏆', '🥈', '🥉']
            const sizes = ['text-5xl', 'text-4xl', 'text-4xl']
            const borders = [
              'border-yellow-700/50 bg-yellow-950/20',
              'border-slate-600/40 bg-slate-800/30',
              'border-orange-800/40 bg-orange-950/15',
            ]
            return (
              <div key={r.name} className={`rounded-xl border ${borders[i]} p-5 flex flex-col gap-2`}>
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
                    href={SF_URL(r.topCourse.sf_ref_no)}
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

        {/* ══ LEADERBOARD ══ */}
        <div className="rounded-xl border border-slate-800/60 overflow-hidden">

          {/* Column headers */}
          <div className="grid grid-cols-[2.5rem_1fr_auto] items-center px-5 py-2 bg-slate-900/60 border-b border-slate-800/60 text-[10px] font-mono text-slate-600 tracking-widest uppercase gap-4">
            <span>#</span>
            <span>Provider / Top Course</span>
            <span className="text-right">Runs · Demand</span>
          </div>

          {rows.map((r, i) => {
            const dmnd = demand(r.topRuns)
            const c = color(r.name)
            const barPct = maxRuns > 0 ? Math.max(1, Math.round((r.topRuns / maxRuns) * 100)) : 0
            const barColor = r.topRuns >= 20 ? '#ef4444' : r.topRuns >= 5 ? '#f59e0b' : '#475569'

            return (
              <details
                key={r.name}
                className="group border-b border-slate-800/40 last:border-0"
              >
                {/* ── Clickable row ── */}
                <summary className="grid grid-cols-[2.5rem_1fr_auto] items-center px-5 py-3.5 gap-4 cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-slate-800/30 transition-colors select-none">

                  {/* Rank */}
                  <span className="text-slate-600 font-mono text-sm text-center">{i + 1}</span>

                  {/* Provider + course */}
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
                      <span className="text-slate-700 text-[10px] font-mono ml-auto group-open:rotate-180 transition-transform">▾</span>
                    </div>
                    {r.topCourse && (
                      <a
                        href={SF_URL(r.topCourse.sf_ref_no)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-slate-200 text-sm hover:text-orange-400 transition-colors"
                      >
                        {r.topCourse.title} ↗
                      </a>
                    )}
                    {/* Progress bar */}
                    <div className="mt-2 h-0.5 w-full bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${barPct}%`, backgroundColor: barColor }}
                      />
                    </div>
                  </div>

                  {/* Runs + demand */}
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
                    Top 3 Courses by Upcoming Runs
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
                                {hasRunData ? (
                                  <a
                                    href={SCHED_URL(c2.sf_ref_no)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-bold font-mono text-orange-400 hover:text-orange-300 transition-colors"
                                  >
                                    {runs2} <span className="text-slate-500 text-xs">Runs ↗</span>
                                  </a>
                                ) : (
                                  <span className="text-slate-600 font-mono text-xs">—</span>
                                )}
                                {att > 0 && (
                                  <span className="text-slate-500 text-xs">
                                    · {att >= 1000 ? `${(att / 1000).toFixed(1)}K` : att} Attended
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-600">
                              <span>{c2.provider_name}</span>
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

        {/* ══ FOOTER ══ */}
        <footer className="text-[10px] font-mono text-slate-700 space-y-0.5 pb-4">
          <p>SOURCE: MySkillsFuture Schedule tab · upcoming_run_count = &quot;Showing 1–X of <strong className="text-slate-600">N course runs</strong>&quot; scraped via browser navigation (Schedule data is AEM-rendered, requires authenticated session)</p>
          <p>HUSTLE SG = HUSTLE INSTITUTE PTE. LTD. + HUSTLE ACADEMY PTE. LTD. · {totalCourses} courses indexed · attendee counts from Course_Quality_NumberOfRespondents (verified)</p>
        </footer>

      </div>
    </AppLayout>
  )
}
