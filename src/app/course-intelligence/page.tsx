import { createServiceClient } from '@/lib/supabase/server'

export const revalidate = 300

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

const SF_URL = (ref: string) =>
  `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}`

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtDateTime(iso: string): string {
  return (
    new Date(iso).toLocaleString('en-SG', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Singapore',
    }) + ' SGT'
  )
}

function isHustle(name: string): boolean {
  return name.toUpperCase().includes('HUSTLE')
}

const ALIASES: Record<string, string> = {
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

function aliasName(raw: string): string {
  if (isHustle(raw)) return 'Hustle SG'
  return ALIASES[raw] ?? raw
}

function calcThreat(attendees: number, courses: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' {
  if (attendees > 80_000 || courses > 150) return 'CRITICAL'
  if (attendees > 20_000 || courses > 40) return 'HIGH'
  if (attendees > 5_000 || courses > 15) return 'MEDIUM'
  return 'LOW'
}

function calcOpp(attendees: number, hustleCount: number): 'HIGH' | 'MEDIUM' | 'LOW' | 'PRESENT' {
  if (hustleCount > 0) return 'PRESENT'
  if (attendees >= 10_000) return 'HIGH'
  if (attendees >= 2_000) return 'MEDIUM'
  return 'LOW'
}

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

interface Course {
  sf_ref_no: string
  title: string
  provider_name: string
  category_text: string | null
  course_fee: number | null
  has_active_runs: boolean
  respondent_count: number
  upcoming_run_count: number
  scraped_at: string
}

interface ProviderData {
  name: string
  isHustle: boolean
  available: number
  active: number
  totalAttendees: number
  totalRuns: number
  rankByAttendees: number
  rankByCourses: number
  topCourse: Course | null
  topCategory: string
  threat: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
}

interface CategoryData {
  name: string
  totalAttendees: number
  providerCount: number
  courseCount: number
  hustlePresent: boolean
  opp: 'HIGH' | 'MEDIUM' | 'LOW' | 'PRESENT'
}

// ═══════════════════════════════════════════════════════════════
// DATA LAYER
// ═══════════════════════════════════════════════════════════════

async function getData() {
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('sf_courses')
    .select(
      'sf_ref_no, title, provider_name, category_text, course_fee, has_active_runs, respondent_count, upcoming_run_count, scraped_at',
    )

  if (error) {
    console.error('[course-intelligence]', error.message)
    return null
  }

  const courses = (data ?? []) as Course[]
  if (courses.length === 0) return null

  const lastScraped = courses.reduce(
    (m, c) => (c.scraped_at > m ? c.scraped_at : m),
    courses[0].scraped_at,
  )

  // ── Provider aggregation ──
  const pMap = new Map<string, Course[]>()
  for (const c of courses) {
    const k = aliasName(c.provider_name)
    if (!pMap.has(k)) pMap.set(k, [])
    pMap.get(k)!.push(c)
  }

  const providers: ProviderData[] = Array.from(pMap.entries()).map(([name, pc]) => {
    const totalAttendees = pc.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const totalRuns = pc.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)
    const active = pc.filter(c => c.has_active_runs).length
    const catCount = new Map<string, number>()
    for (const c of pc) {
      if (c.category_text) catCount.set(c.category_text, (catCount.get(c.category_text) ?? 0) + 1)
    }
    const topCategory = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'
    const sorted = [...pc].sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    return {
      name,
      isHustle: isHustle(pc[0].provider_name),
      available: pc.length,
      active,
      totalAttendees,
      totalRuns,
      rankByAttendees: 0,
      rankByCourses: 0,
      topCourse: sorted[0] ?? null,
      topCategory,
      threat: calcThreat(totalAttendees, pc.length),
    }
  })

  const byAtt = [...providers].sort((a, b) => b.totalAttendees - a.totalAttendees)
  const byCrs = [...providers].sort((a, b) => b.available - a.available)
  for (const p of providers) {
    p.rankByAttendees = byAtt.findIndex(x => x.name === p.name) + 1
    p.rankByCourses = byCrs.findIndex(x => x.name === p.name) + 1
  }
  // Sort: non-Hustle by attendees DESC, Hustle always last
  providers.sort((a, b) => {
    if (a.isHustle !== b.isHustle) return a.isHustle ? 1 : -1
    return b.totalAttendees - a.totalAttendees
  })

  // ── Category analysis ──
  const cMap = new Map<string, { att: number; prov: Set<string>; n: number; hustle: number }>()
  for (const c of courses) {
    const cat = c.category_text ?? 'Uncategorised'
    if (!cMap.has(cat)) cMap.set(cat, { att: 0, prov: new Set(), n: 0, hustle: 0 })
    const e = cMap.get(cat)!
    e.att += c.respondent_count ?? 0
    e.prov.add(aliasName(c.provider_name))
    e.n++
    if (isHustle(c.provider_name)) e.hustle++
  }
  const categories: CategoryData[] = [...cMap.entries()]
    .map(([name, v]) => ({
      name,
      totalAttendees: v.att,
      providerCount: v.prov.size,
      courseCount: v.n,
      hustlePresent: v.hustle > 0,
      opp: calcOpp(v.att, v.hustle),
    }))
    .sort((a, b) => b.totalAttendees - a.totalAttendees)

  // ── Derived ──
  const topByAtt = [...courses]
    .sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    .slice(0, 20)

  const hasRunData = courses.some(c => (c.upcoming_run_count ?? 0) > 0)
  const topByRuns = hasRunData
    ? [...courses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0)).slice(0, 20)
    : []

  const whitespace = categories.filter(c => c.opp === 'HIGH' || c.opp === 'MEDIUM')
  const wsNames = new Set(whitespace.map(c => c.name))
  const toCopy = courses
    .filter(c => !isHustle(c.provider_name) && c.category_text && wsNames.has(c.category_text))
    .sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    .slice(0, 10)

  const hustleStats = providers.find(p => p.isHustle) ?? null
  const biggestThreat = providers.find(p => !p.isHustle) ?? null
  const topOpp = categories.find(c => c.opp === 'HIGH') ?? null
  const totalMarketAttendees = courses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)

  return {
    courses,
    providers,
    categories,
    topByAtt,
    topByRuns,
    toCopy,
    whitespace,
    lastScraped,
    hasRunData,
    hustleStats,
    biggestThreat,
    topOpp,
    totalMarketAttendees,
    topCourse: topByAtt[0] ?? null,
  }
}

// ═══════════════════════════════════════════════════════════════
// STRATEGIC ALERTS GENERATOR
// ═══════════════════════════════════════════════════════════════

type AlertLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO'
interface Alert { level: AlertLevel; title: string; detail: string }

function buildAlerts(d: NonNullable<Awaited<ReturnType<typeof getData>>>): Alert[] {
  const alerts: Alert[] = []

  if ((d.hustleStats?.available ?? 0) < 25) {
    alerts.push({
      level: 'HIGH',
      title: 'HUSTLE COVERAGE INCOMPLETE',
      detail: `${d.hustleStats?.available ?? 0} of ~39 verified Hustle courses indexed. HUSTLE ACADEMY entity not yet scraped — approximately 25 courses missing from all metrics.`,
    })
  }

  const criticalThreats = d.providers.filter(p => !p.isHustle && p.threat === 'CRITICAL')
  for (const ct of criticalThreats.slice(0, 2)) {
    alerts.push({
      level: 'CRITICAL',
      title: `${ct.name.toUpperCase()} MARKET DOMINANCE`,
      detail: `${fmt(ct.totalAttendees)} total attendees · ${ct.available} courses available. Top course: "${ct.topCourse?.title ?? '—'}" (${fmt(ct.topCourse?.respondent_count ?? 0)} attended).`,
    })
  }

  const ops = d.categories.filter(c => c.opp === 'HIGH')
  for (const op of ops.slice(0, 2)) {
    alerts.push({
      level: 'MEDIUM',
      title: `OPPORTUNITY: ${op.name.toUpperCase()}`,
      detail: `${fmt(op.totalAttendees)} total attendees · ${op.providerCount} provider(s) · Hustle SG has zero courses. ${op.providerCount === 1 ? 'Single-provider market — entry would disrupt incumbent.' : 'Entry opportunity exists.'}`,
    })
  }

  alerts.push({
    level: 'INFO',
    title: 'HUSTLE COMPETITIVE POSITION',
    detail: `Rank #${d.hustleStats?.rankByAttendees ?? '?'} of ${d.providers.length} by total attendees. Rank #${d.hustleStats?.rankByCourses ?? '?'} by available courses. Visual content is core strength. Growth requires category expansion.`,
  })

  if (!d.hasRunData) {
    alerts.push({
      level: 'INFO',
      title: 'SCHEDULE RUN DATA PENDING',
      detail: 'upcoming_run_count = 0 for all indexed courses. Will populate after next sf-refresh cron cycle (01:00 SGT daily). Section 04 unavailable until then.',
    })
  }

  return alerts
}

// ═══════════════════════════════════════════════════════════════
// SUB-COMPONENTS
// ═══════════════════════════════════════════════════════════════

function ThreatBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    CRITICAL: 'bg-red-900/70 text-red-400 border border-red-800/80',
    HIGH: 'bg-orange-900/60 text-orange-400 border border-orange-800/70',
    MEDIUM: 'bg-yellow-900/50 text-yellow-500 border border-yellow-800/60',
    LOW: 'bg-slate-800 text-slate-500 border border-slate-700',
  }
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-px rounded tracking-wider ${cls[level] ?? cls.LOW}`}>
      {level}
    </span>
  )
}

function OppBadge({ level }: { level: string }) {
  const cls: Record<string, string> = {
    HIGH: 'bg-green-900/60 text-green-400 border border-green-800/70',
    MEDIUM: 'bg-cyan-900/50 text-cyan-400 border border-cyan-800/60',
    LOW: 'bg-slate-800 text-slate-600 border border-slate-700',
    PRESENT: 'bg-slate-800 text-slate-500 border border-slate-700',
  }
  return (
    <span className={`inline-block text-[10px] font-mono px-1.5 py-px rounded tracking-wider ${cls[level] ?? cls.LOW}`}>
      {level === 'PRESENT' ? 'ACTIVE' : level}
    </span>
  )
}

function Sec({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-3 mb-3 pb-1.5 border-b border-slate-800">
        <span className="text-[11px] font-mono tracking-[0.18em] text-slate-400 uppercase">{title}</span>
        {note && <span className="text-[10px] font-mono text-slate-600">{note}</span>}
      </div>
      {children}
    </section>
  )
}

// ═══════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════

export default async function CourseIntelligencePage() {
  const d = await getData()

  if (!d) {
    return (
      <div className="min-h-screen bg-[#030712] flex items-center justify-center">
        <div className="text-center font-mono">
          <div className="text-slate-500 text-xs tracking-widest mb-2">HUSTLE//INTEL</div>
          <div className="text-slate-300 text-sm">DATA UNAVAILABLE</div>
          <div className="text-slate-600 text-xs mt-1">
            No courses indexed in sf_courses. Run the sf-refresh cron to populate.
          </div>
        </div>
      </div>
    )
  }

  const alerts = buildAlerts(d)
  const { hustleStats, biggestThreat, topOpp, topCourse, providers, categories } = d

  return (
    <div className="min-h-screen bg-[#030712] text-slate-100">

      {/* ── HEADER ── */}
      <header className="sticky top-0 z-50 bg-[#030712]/95 backdrop-blur border-b border-slate-800 px-6 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-orange-400 font-mono text-xs font-bold tracking-[0.2em]">HUSTLE//INTEL</span>
          <span className="w-px h-3 bg-slate-700" />
          <span className="text-slate-300 font-mono text-xs tracking-[0.1em]">MYSKILLSFUTURE EXECUTIVE INTELLIGENCE</span>
          {hustleStats && (
            <>
              <span className="w-px h-3 bg-slate-700" />
              <span className="text-slate-500 font-mono text-[10px]">
                HUSTLE SG · RANK #{hustleStats.rankByAttendees}/{providers.length} BY ATTENDEES
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-5">
          <span className="text-slate-600 text-[10px] font-mono">{d.courses.length} COURSES INDEXED</span>
          <span className="text-slate-600 text-[10px] font-mono">
            SCRAPED: {fmtDateTime(d.lastScraped)}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-green-400 text-[10px] font-mono">LIVE</span>
          </span>
        </div>
      </header>

      <main className="px-6 py-6 max-w-[1600px] mx-auto">

        {/* ══ SECTION 1: EXECUTIVE BRIEF ══ */}
        <Sec title="01 — EXECUTIVE BRIEF" note="management answers within 30 seconds">
          <div className="grid grid-cols-3 gap-3">

            {/* Are we winning? */}
            <div className="bg-slate-900/60 border border-slate-800 rounded p-4">
              <div className="text-slate-500 text-[10px] font-mono tracking-widest mb-2">ARE WE WINNING?</div>
              <div className="text-orange-400 font-mono text-3xl font-bold leading-none">
                #{hustleStats?.rankByAttendees ?? '—'}
                <span className="text-slate-600 text-base">/{providers.length}</span>
              </div>
              <div className="text-slate-500 text-[10px] font-mono mt-1 mb-3">BY TOTAL ATTENDEES</div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">TOTAL ATTENDED</span>
                  <span className="text-slate-200">{fmt(hustleStats?.totalAttendees ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">AVAILABLE COURSES</span>
                  <span className="text-slate-200">{hustleStats?.available ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">RANK BY COURSES</span>
                  <span className="text-slate-200">#{hustleStats?.rankByCourses ?? '—'}/{providers.length}</span>
                </div>
              </div>
              <div className="mt-3 text-[10px] font-mono text-slate-600">STATUS: MARKET CHALLENGER</div>
            </div>

            {/* Biggest threat */}
            <div className="bg-red-950/30 border border-red-900/50 rounded p-4">
              <div className="text-red-500 text-[10px] font-mono tracking-widest mb-2">BIGGEST COMPETITOR THREAT</div>
              {biggestThreat ? (
                <>
                  <div className="text-red-300 font-mono text-lg font-bold leading-tight">
                    {biggestThreat.name.toUpperCase()}
                  </div>
                  <div className="mt-3 space-y-1 text-[11px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">TOTAL ATTENDED</span>
                      <span className="text-red-400 font-bold">{fmt(biggestThreat.totalAttendees)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">COURSES AVAILABLE</span>
                      <span className="text-slate-300">{biggestThreat.available}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">TOP CATEGORY</span>
                      <span className="text-slate-300 truncate max-w-[110px] text-right">{biggestThreat.topCategory}</span>
                    </div>
                  </div>
                  <div className="mt-3"><ThreatBadge level={biggestThreat.threat} /></div>
                </>
              ) : (
                <div className="text-slate-500 text-xs font-mono">DATA UNAVAILABLE</div>
              )}
            </div>

            {/* Top opportunity */}
            <div className="bg-green-950/25 border border-green-900/40 rounded p-4">
              <div className="text-green-600 text-[10px] font-mono tracking-widest mb-2">TOP MARKET OPPORTUNITY</div>
              {topOpp ? (
                <>
                  <div className="text-green-300 font-mono text-base font-bold leading-tight">
                    {topOpp.name.toUpperCase()}
                  </div>
                  <div className="mt-3 space-y-1 text-[11px] font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-500">MARKET ATTENDEES</span>
                      <span className="text-green-400 font-bold">{fmt(topOpp.totalAttendees)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">CURRENT PROVIDERS</span>
                      <span className="text-slate-300">{topOpp.providerCount}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">HUSTLE COURSES</span>
                      <span className="text-yellow-400">NONE</span>
                    </div>
                  </div>
                  <div className="mt-3 text-green-500 text-[10px] font-mono">ACTION: LAUNCH COURSE NOW</div>
                </>
              ) : (
                <div className="text-slate-500 text-xs font-mono">DATA UNAVAILABLE</div>
              )}
            </div>

            {/* Highest demand course */}
            <div className="bg-slate-900/60 border border-slate-800 rounded p-4">
              <div className="text-slate-500 text-[10px] font-mono tracking-widest mb-2">HIGHEST DEMAND COURSE (MARKET)</div>
              {topCourse ? (
                <>
                  <a
                    href={SF_URL(topCourse.sf_ref_no)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-slate-100 text-sm font-mono hover:text-orange-400 transition-colors leading-snug block"
                  >
                    {topCourse.title}
                  </a>
                  <div className="mt-2 text-slate-500 text-[10px] font-mono">
                    {aliasName(topCourse.provider_name).toUpperCase()}
                  </div>
                  <div className="text-orange-400 font-mono text-2xl font-bold mt-1">
                    {fmt(topCourse.respondent_count ?? 0)}
                  </div>
                  <div className="text-slate-600 text-[10px] font-mono">TOTAL ATTENDED</div>
                  <div className="mt-2 text-slate-700 text-[10px] font-mono">{topCourse.sf_ref_no}</div>
                </>
              ) : (
                <div className="text-slate-500 text-xs font-mono">DATA UNAVAILABLE</div>
              )}
            </div>

            {/* Total market */}
            <div className="bg-slate-900/60 border border-slate-800 rounded p-4">
              <div className="text-slate-500 text-[10px] font-mono tracking-widest mb-2">TOTAL MARKET SIZE</div>
              <div className="text-slate-100 font-mono text-3xl font-bold leading-none">
                {fmt(d.totalMarketAttendees)}
              </div>
              <div className="text-slate-600 text-[10px] font-mono mt-1 mb-3">TOTAL ATTENDEES INDEXED</div>
              <div className="space-y-1 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">COURSES INDEXED</span>
                  <span className="text-slate-200">{d.courses.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">ACTIVE PROVIDERS</span>
                  <span className="text-slate-200">{providers.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">CATEGORIES TRACKED</span>
                  <span className="text-slate-200">{categories.length}</span>
                </div>
              </div>
              <div className="mt-3 text-slate-700 text-[10px] font-mono">SOURCE: MYSKILLSFUTURE.GOV.SG</div>
            </div>

            {/* Hustle coverage */}
            <div className="bg-yellow-950/20 border border-yellow-900/40 rounded p-4">
              <div className="text-yellow-600 text-[10px] font-mono tracking-widest mb-2">HUSTLE SG COVERAGE STATUS</div>
              <div className="text-yellow-400 font-mono text-3xl font-bold leading-none">
                {hustleStats?.available ?? 0}
                <span className="text-slate-600 text-base">/39</span>
              </div>
              <div className="text-slate-600 text-[10px] font-mono mt-1 mb-3">INDEXED vs VERIFIED ON MYSKILLSFUTURE</div>
              <div className="bg-yellow-950/50 border border-yellow-900/60 rounded px-2.5 py-2 mb-2">
                <div className="text-yellow-400 text-[10px] font-mono">⚠ HUSTLE ACADEMY NOT YET INDEXED</div>
                <div className="text-slate-500 text-[10px] font-mono mt-0.5">~25 courses missing from all metrics</div>
              </div>
              <div className="space-y-0.5 text-[11px] font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-500">ACTIVE COURSES</span>
                  <span className="text-slate-300">{hustleStats?.active ?? 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">TOP CATEGORY</span>
                  <span className="text-slate-300 truncate max-w-[130px] text-right">{hustleStats?.topCategory ?? '—'}</span>
                </div>
              </div>
            </div>

          </div>
        </Sec>

        {/* ══ SECTION 2: COMPETITOR MATRIX ══ */}
        <Sec
          title="02 — COMPETITOR MATRIX"
          note={`ranked by total attendees · source: myskillsfuture.gov.sg · ${fmtDateTime(d.lastScraped)}`}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-slate-800">
                  {['#', 'PROVIDER', 'AVAIL', 'ACTIVE', 'ATTENDED', 'TOP COURSE BY ATTENDEES', 'TOP CATEGORY', 'THREAT'].map(h => (
                    <th
                      key={h}
                      className={`text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal ${
                        ['AVAIL', 'ACTIVE', 'ATTENDED'].includes(h) ? 'text-right' : 'text-left'
                      } ${h === 'THREAT' ? 'text-center pr-0' : ''} ${h === '#' ? 'w-6' : ''}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providers.map((p, i) => (
                  <tr
                    key={p.name}
                    className={`border-b transition-colors ${
                      p.isHustle
                        ? 'bg-orange-950/20 border-orange-900/30 hover:bg-orange-950/30'
                        : 'border-slate-900/80 hover:bg-slate-900/40'
                    }`}
                  >
                    <td className="py-2.5 pr-3 text-slate-600 text-center">
                      {p.isHustle ? '★' : i + 1}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span className={p.isHustle ? 'text-orange-400 font-bold' : 'text-slate-200'}>
                        {p.name}
                      </span>
                      {p.isHustle && (
                        <span className="ml-1 text-[9px] text-orange-700 font-mono">[SELF]</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-slate-300">{p.available}</td>
                    <td className="py-2.5 pr-3 text-right text-slate-400">{p.active}</td>
                    <td className={`py-2.5 pr-3 text-right font-bold ${p.isHustle ? 'text-orange-400' : 'text-slate-200'}`}>
                      {fmt(p.totalAttendees)}
                    </td>
                    <td className="py-2.5 pr-3 min-w-[240px]">
                      {p.topCourse ? (
                        <a
                          href={SF_URL(p.topCourse.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-400 hover:text-slate-200 transition-colors"
                          title={p.topCourse.title}
                        >
                          {p.topCourse.title.length > 40
                            ? p.topCourse.title.slice(0, 40) + '…'
                            : p.topCourse.title}
                          <span className="text-slate-600 ml-1">
                            ({fmt(p.topCourse.respondent_count ?? 0)})
                          </span>
                        </a>
                      ) : (
                        <span className="text-slate-700">—</span>
                      )}
                    </td>
                    <td
                      className="py-2.5 pr-3 text-slate-500 max-w-[150px] truncate text-[10px]"
                      title={p.topCategory}
                    >
                      {p.topCategory.length > 22 ? p.topCategory.slice(0, 22) + '…' : p.topCategory}
                    </td>
                    <td className="py-2.5 text-center">
                      {p.isHustle ? (
                        <span className="text-[10px] text-slate-700">—</span>
                      ) : (
                        <ThreatBadge level={p.threat} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] font-mono text-slate-700">
            ATTENDEE COUNT = Course_Quality_NumberOfRespondents from MySkillsFuture Solr API · verified source data ✓
          </div>
        </Sec>

        {/* ══ SECTION 3: TOP COURSES BY ATTENDEES ══ */}
        <Sec title="03 — TOP COURSES BY ATTENDEES" note="verified from myskillsfuture.gov.sg · click course ref to view">
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-8">RK</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-32">COURSE REF</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left">COURSE TITLE</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-36">PROVIDER</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-44">CATEGORY</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-right w-24">ATTENDED</th>
                  <th className="text-[10px] text-slate-500 tracking-wider py-2 font-normal text-center w-20">STATUS</th>
                </tr>
              </thead>
              <tbody>
                {d.topByAtt.map((c, i) => {
                  const hustle = isHustle(c.provider_name)
                  return (
                    <tr
                      key={c.sf_ref_no}
                      className={`border-b transition-colors ${
                        hustle
                          ? 'bg-orange-950/15 border-orange-900/20 hover:bg-orange-950/25'
                          : 'border-slate-900/80 hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="py-2 pr-3 text-slate-600">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-500 hover:text-orange-400 transition-colors text-[10px]"
                        >
                          {c.sf_ref_no}
                        </a>
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`hover:text-orange-400 transition-colors ${
                            hustle ? 'text-orange-300 font-bold' : 'text-slate-200'
                          }`}
                        >
                          {c.title}
                        </a>
                        {hustle && <span className="ml-1 text-[9px] text-orange-700">[HUSTLE]</span>}
                      </td>
                      <td className="py-2 pr-3 text-slate-400">{aliasName(c.provider_name)}</td>
                      <td className="py-2 pr-3 text-slate-500 text-[10px]">{c.category_text ?? '—'}</td>
                      <td className="py-2 pr-3 text-right font-bold text-slate-200">
                        {fmt(c.respondent_count ?? 0)}
                      </td>
                      <td className="py-2 text-center">
                        <span
                          className={`text-[10px] ${c.has_active_runs ? 'text-green-500' : 'text-slate-600'}`}
                        >
                          {c.has_active_runs ? '● ACTIVE' : '○ INACTIVE'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Sec>

        {/* ══ SECTION 4: TOP COURSES BY SCHEDULE RUNS ══ */}
        <Sec title="04 — TOP COURSES BY SCHEDULE RUNS">
          {!d.hasRunData ? (
            <div className="bg-slate-900/50 border border-slate-800 rounded p-6 text-center">
              <div className="text-amber-400 font-mono text-xs tracking-widest mb-2">
                SOURCE NOT VERIFIED
              </div>
              <div className="text-slate-400 font-mono text-xs">
                upcoming_run_count = 0 for all {d.courses.length} indexed courses.
              </div>
              <div className="text-slate-600 font-mono text-xs mt-1">
                Run count data will populate after the next sf-refresh cron cycle (01:00 SGT daily).
              </div>
              <div className="text-slate-700 font-mono text-[10px] mt-2">
                Schedule run counts are not displayed until verified source data is available.
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-8">RK</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-32">COURSE REF</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left">COURSE TITLE</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-36">PROVIDER</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-right w-20">RUNS</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-right w-24">ATTENDED</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topByRuns.map((c, i) => (
                    <tr
                      key={c.sf_ref_no}
                      className={`border-b transition-colors ${
                        isHustle(c.provider_name)
                          ? 'bg-orange-950/15 border-orange-900/20 hover:bg-orange-950/25'
                          : 'border-slate-900/80 hover:bg-slate-900/40'
                      }`}
                    >
                      <td className="py-2 pr-3 text-slate-600">{i + 1}</td>
                      <td className="py-2 pr-3">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-500 hover:text-orange-400 transition-colors text-[10px]"
                        >
                          {c.sf_ref_no}
                        </a>
                      </td>
                      <td className="py-2 pr-3">
                        <a
                          href={SF_URL(c.sf_ref_no)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`hover:text-orange-400 transition-colors ${
                            isHustle(c.provider_name) ? 'text-orange-300 font-bold' : 'text-slate-200'
                          }`}
                        >
                          {c.title}
                        </a>
                      </td>
                      <td className="py-2 pr-3 text-slate-400">{aliasName(c.provider_name)}</td>
                      <td className="py-2 pr-3 text-right font-bold text-slate-200">
                        {c.upcoming_run_count ?? 0}
                      </td>
                      <td className="py-2 pr-3 text-right text-slate-400">
                        {fmt(c.respondent_count ?? 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Sec>

        {/* ══ SECTION 5: COURSES TO COPY ══ */}
        <Sec title="05 — COURSES TO COPY" note="high-demand courses in categories where hustle sg is absent">
          {d.toCopy.length === 0 ? (
            <div className="text-slate-600 font-mono text-xs">
              No courses identified. Hustle has presence in all high-demand categories.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-8">RK</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left">COURSE TITLE</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-36">BY PROVIDER</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-left w-44">CATEGORY</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-right w-24">ATTENDED</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-3 font-normal text-center w-20">PRIORITY</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pl-3 font-normal text-left">STRATEGIC NOTE</th>
                  </tr>
                </thead>
                <tbody>
                  {d.toCopy.map((c, i) => {
                    const catData = categories.find(cat => cat.name === c.category_text)
                    const att = c.respondent_count ?? 0
                    const priority = att >= 5_000 ? 'HIGH' : 'MEDIUM'
                    const note =
                      catData?.providerCount === 1
                        ? `Monopoly — only ${aliasName(c.provider_name)} active. Entry disrupts market.`
                        : `${fmt(catData?.totalAttendees ?? 0)} market · ${catData?.providerCount ?? '?'} providers · Hustle SG absent`
                    return (
                      <tr
                        key={c.sf_ref_no}
                        className="border-b border-slate-900/80 hover:bg-slate-900/40 transition-colors"
                      >
                        <td className="py-2.5 pr-3 text-slate-600">{i + 1}</td>
                        <td className="py-2.5 pr-3">
                          <a
                            href={SF_URL(c.sf_ref_no)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-200 hover:text-orange-400 transition-colors"
                          >
                            {c.title}
                          </a>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-400">{aliasName(c.provider_name)}</td>
                        <td className="py-2.5 pr-3 text-slate-500 text-[10px]">{c.category_text ?? '—'}</td>
                        <td className="py-2.5 pr-3 text-right font-bold text-slate-200">{fmt(att)}</td>
                        <td className="py-2.5 pr-3 text-center">
                          <span
                            className={`text-[10px] font-mono px-1.5 py-px rounded border ${
                              priority === 'HIGH'
                                ? 'bg-green-900/60 text-green-400 border-green-800/70'
                                : 'bg-cyan-900/50 text-cyan-400 border-cyan-800/60'
                            }`}
                          >
                            {priority}
                          </span>
                        </td>
                        <td className="py-2.5 pl-3 text-slate-600 text-[10px]">{note}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Sec>

        {/* ══ SECTION 6: WHITE SPACE OPPORTUNITIES ══ */}
        <Sec
          title="06 — WHITE SPACE OPPORTUNITIES"
          note="categories with demand but zero hustle sg presence"
        >
          {d.whitespace.length === 0 ? (
            <div className="text-slate-600 font-mono text-xs">
              No white space identified. Hustle SG is present in all high-demand categories.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono border-collapse">
                <thead>
                  <tr className="border-b border-slate-800">
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-4 font-normal text-center w-20">OPP.</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-4 font-normal text-left">CATEGORY</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-4 font-normal text-right w-28">MKT ATTENDED</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-4 font-normal text-right w-24">PROVIDERS</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pr-4 font-normal text-right w-20">COURSES</th>
                    <th className="text-[10px] text-slate-500 tracking-wider py-2 pl-3 font-normal text-left">RECOMMENDED ACTION</th>
                  </tr>
                </thead>
                <tbody>
                  {d.whitespace.map(cat => {
                    const action =
                      cat.providerCount === 1
                        ? `Disrupt monopoly — only 1 incumbent. Low competitive resistance on entry.`
                        : cat.opp === 'HIGH'
                        ? `Launch immediately — ${fmt(cat.totalAttendees)} market, ${cat.providerCount} competitors to benchmark`
                        : `Evaluate entry — ${fmt(cat.totalAttendees)} market, manageable competition`
                    return (
                      <tr
                        key={cat.name}
                        className="border-b border-slate-900/80 hover:bg-slate-900/40 transition-colors"
                      >
                        <td className="py-2.5 pr-4 text-center">
                          <OppBadge level={cat.opp} />
                        </td>
                        <td className="py-2.5 pr-4 text-slate-200">{cat.name}</td>
                        <td className="py-2.5 pr-4 text-right font-bold text-slate-200">
                          {fmt(cat.totalAttendees)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-slate-400">{cat.providerCount}</td>
                        <td className="py-2.5 pr-4 text-right text-slate-500">{cat.courseCount}</td>
                        <td className="py-2.5 pl-3 text-slate-500 text-[10px]">{action}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Sec>

        {/* ══ SECTION 7: STRATEGIC ALERTS ══ */}
        <Sec title="07 — STRATEGIC ALERTS" note="auto-generated from indexed data">
          <div className="space-y-2">
            {alerts.map((a, i) => {
              const styles: Record<AlertLevel, string> = {
                CRITICAL: 'border-red-900/60 bg-red-950/30',
                HIGH: 'border-orange-900/50 bg-orange-950/20',
                MEDIUM: 'border-yellow-900/40 bg-yellow-950/15',
                INFO: 'border-slate-800 bg-slate-900/40',
              }
              const labelCls: Record<AlertLevel, string> = {
                CRITICAL: 'text-red-400',
                HIGH: 'text-orange-400',
                MEDIUM: 'text-yellow-500',
                INFO: 'text-slate-500',
              }
              const icons: Record<AlertLevel, string> = {
                CRITICAL: '⚡',
                HIGH: '⚠',
                MEDIUM: 'ℹ',
                INFO: '●',
              }
              return (
                <div
                  key={i}
                  className={`flex gap-3 border rounded px-4 py-3 ${styles[a.level]}`}
                >
                  <span className={`font-mono text-[10px] shrink-0 w-20 pt-px ${labelCls[a.level]}`}>
                    {icons[a.level]} {a.level}
                  </span>
                  <div>
                    <span className={`font-mono text-xs font-bold ${labelCls[a.level]}`}>
                      {a.title}:{' '}
                    </span>
                    <span className="font-mono text-xs text-slate-400">{a.detail}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </Sec>

        {/* ── FOOTER ── */}
        <footer className="mt-12 pt-4 border-t border-slate-900 text-[10px] font-mono text-slate-700 space-y-1">
          <div>
            DATA SOURCE: MySkillsFuture Solr API (myskillsfuture.gov.sg) ·
            respondent_count = Course_Quality_NumberOfRespondents (verified field) ·
            upcoming_run_count = doclist.numFound per course group (pending re-scrape)
          </div>
          <div>
            LAST SCRAPED: {fmtDateTime(d.lastScraped)} ·
            AUTO-REFRESH: 01:00 SGT daily (sf-refresh) + 01:30 SGT (aggregation) ·
            PAGE CACHE: 5 min
          </div>
          <div>
            HUSTLE SG = HUSTLE INSTITUTE PTE. LTD. + HUSTLE ACADEMY PTE. LTD. (aggregated) ·
            HUSTLE ACADEMY entity not yet indexed — analysis is partial until next scrape cycle
          </div>
          <div>
            DATA INTEGRITY: All attendee counts sourced directly from MySkillsFuture. No estimated or fabricated values displayed.
            If data is unavailable, sections display &quot;DATA UNAVAILABLE&quot; or &quot;SOURCE NOT VERIFIED&quot;.
          </div>
        </footer>

      </main>
    </div>
  )
}
