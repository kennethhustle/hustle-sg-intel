import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'
import { ModuleStatus } from '@/components/dashboard/module-status'
import { SourcePanel } from '@/components/dashboard/source-panel'
import {
  getCourseMarketSnapshot,
  getProviderCourseLeaderboard,
  getCourseLeaderboard,
  getCategoryIntelligence,
  getHustleGapAnalysis,
  getRecentCourseChanges,
} from '@/lib/services/courses/intelligence'
import { ProviderTable } from './provider-table'
import { CourseTable } from './course-table'
import { CategoryMatrix } from './category-matrix'
import { ChangesTimeline } from './changes-timeline'
import type { AiInsightRow } from './types'

export const revalidate = 300

const SGT = 'Asia/Singapore'

function fmtSgt(iso: string | null): string {
  if (!iso) return 'never'
  const d = new Date(iso)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dISO = dayFmt.format(d)
  const nowISO = dayFmt.format(now)
  const yesterdayISO = dayFmt.format(new Date(now.getTime() - 86_400_000))
  const timeStr = d.toLocaleTimeString('en-SG', { timeZone: SGT, hour: 'numeric', minute: '2-digit', hour12: true })
  if (dISO === nowISO) return `Today, ${timeStr} SGT`
  if (dISO === yesterdayISO) return `Yesterday, ${timeStr} SGT`
  return `${d.toLocaleDateString('en-SG', { timeZone: SGT, day: 'numeric', month: 'short', year: 'numeric' })}, ${timeStr} SGT`
}

function rankLabel(rank: number | null, total: number): string {
  if (rank == null) return '—'
  return `#${rank} of ${total}`
}

// ═══════════════════════════════════════════════════
// AI Insights (page-owned query — strategic_insights)
// ═══════════════════════════════════════════════════

const COURSE_INSIGHT_TYPES = ['course_launch_idea', 'opportunity', 'threat', 'defensive_action', 'market_shift']

async function getAiCourseInsights(): Promise<AiInsightRow[]> {
  const supabase = await createServiceClient()
  const nowIso = new Date().toISOString()

  const { data, error } = await supabase
    .from('strategic_insights')
    .select(
      'id, insight_type, title, body, severity, confidence, evidence, recommended_action, suggested_owner, timeframe, related_categories, data_sources, created_at, expires_at'
    )
    .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error || !data) return []

  const filtered = data.filter((row) => {
    const hasCourseType = COURSE_INSIGHT_TYPES.includes(row.insight_type) && Array.isArray(row.related_categories) && row.related_categories.length > 0
    const hasMskSource = Array.isArray(row.data_sources) && row.data_sources.includes('myskillsfuture')
    return hasCourseType || hasMskSource
  })

  return filtered.slice(0, 6).map((row) => ({
    id: row.id,
    insight_type: row.insight_type,
    title: row.title,
    body: row.body,
    severity: row.severity,
    confidence: row.confidence,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    recommended_action: row.recommended_action,
    suggested_owner: row.suggested_owner,
    timeframe: row.timeframe,
    related_categories: Array.isArray(row.related_categories) ? row.related_categories : [],
    data_sources: Array.isArray(row.data_sources) ? row.data_sources : [],
    created_at: row.created_at,
  }))
}

// ═══════════════════════════════════════════════════
// Small presentational helpers
// ═══════════════════════════════════════════════════

function MetricCard({
  title,
  value,
  tooltip,
  accent,
}: {
  title: string
  value: React.ReactNode
  tooltip: string
  accent?: 'emerald' | 'red' | 'indigo' | 'amber'
}) {
  const accentCls = accent === 'emerald' ? 'text-emerald-400' : accent === 'red' ? 'text-red-400' : accent === 'indigo' ? 'text-indigo-300' : accent === 'amber' ? 'text-amber-400' : 'text-slate-100'
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-1.5" title={tooltip}>
      <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase">{title}</p>
      <p className={`text-2xl font-bold font-mono ${accentCls}`}>{value}</p>
      <p className="text-[10px] text-slate-600 mt-auto">Calculated from cached MySkillsFuture data</p>
    </div>
  )
}

const SEVERITY_STYLES: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border-red-500/30',
  high: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  medium: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  low: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}
const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  medium: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
  low: 'bg-slate-500/15 text-slate-400 border-slate-500/30',
}

function WhatThisMeansBlock({ title, icon, items }: { title: string; icon: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-slate-800/60 bg-slate-950/40 p-4">
      <p className="text-xs font-semibold text-slate-200 mb-2 flex items-center gap-1.5">
        <span>{icon}</span> {title}
      </p>
      {items.length === 0 ? (
        <p className="text-[11px] text-slate-600">Nothing flagged this refresh.</p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="text-xs text-slate-400 flex gap-1.5">
              <span className="text-slate-600 shrink-0">•</span> {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════

export default async function CourseIntelligencePage() {
  const [snapshot, providers, courses, categories, gapAnalysis, changes, aiInsights] = await Promise.all([
    getCourseMarketSnapshot(),
    getProviderCourseLeaderboard(),
    getCourseLeaderboard(500),
    getCategoryIntelligence(),
    getHustleGapAnalysis(),
    getRecentCourseChanges(14),
    getAiCourseInsights(),
  ])

  const lastRefreshed = snapshot.lastRefreshed
  const hasMarketData = snapshot.totalCourses > 0

  return (
    <AppLayout title="MySkillsFuture Intelligence" lastUpdated={lastRefreshed}>
      <div className="space-y-8">

        <ModuleStatus module="runcounts" sourceLabel="MySkillsFuture cached data" />

        {/* ══ BANNER ══ */}
        <div className="flex items-start gap-3 bg-sky-950/20 border border-sky-800/30 rounded-lg px-4 py-3">
          <span className="text-sky-400 text-sm shrink-0 font-mono">ⓘ</span>
          <div className="text-xs text-sky-200/80 leading-relaxed flex-1">
            Course and run data is refreshed from MySkillsFuture and cached in Supabase. Some run counts may include
            provider-planned runs that are not yet visible on public schedule pages. Use course links for final
            verification.
            <div className="mt-1">
              <Link href="/settings/data-sources" className="text-sky-400 hover:text-sky-300 underline underline-offset-2">
                View data sources →
              </Link>
            </div>
          </div>
          <DataSourceBadge kind="cached" asOf={lastRefreshed} detail="MySkillsFuture nightly refresh" />
        </div>

        {/* ══ A. COURSE MARKET SNAPSHOT ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Course Market Snapshot</h2>
          {!hasMarketData ? (
            <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
              No data yet — populates after the next nightly refresh.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <MetricCard title="Providers Tracked" value={snapshot.totalProviders} tooltip="Number of distinct competitors with at least one cached course." />
              <MetricCard title="Active Courses" value={snapshot.totalCourses.toLocaleString()} tooltip="Total courses currently cached from MySkillsFuture across all tracked providers." />
              <MetricCard title="Upcoming Runs" value={snapshot.totalRuns.toLocaleString()} tooltip="Sum of upcoming_run_count across all cached courses." />
              <MetricCard title="Categories" value={snapshot.totalCategories} tooltip="Distinct strategic category clusters represented in the cached course catalog." />
              <MetricCard title="New Courses (7d)" value={snapshot.newCourses7d} tooltip="Courses first seen in the cache within the last 7 days." accent="emerald" />
              <MetricCard title="Removed Courses (14d)" value={snapshot.removedCourses14d} tooltip="Courses that disappeared from the cache within the last 14 days." accent="red" />
              <MetricCard
                title="Highest-Growth Provider"
                value={snapshot.topGrowthProvider ? `${snapshot.topGrowthProvider.name} (+${snapshot.topGrowthProvider.deltaRuns})` : '—'}
                tooltip="Provider with the largest absolute increase in upcoming run count since the prior snapshot."
                accent="indigo"
              />
              <MetricCard
                title="Highest-Growth Category"
                value={snapshot.topGrowthCategory ? `${snapshot.topGrowthCategory.name} (+${snapshot.topGrowthCategory.deltaRuns})` : '—'}
                tooltip="Category with the largest absolute increase in total runs since the prior snapshot."
                accent="indigo"
              />
              <MetricCard title="Hustle Rank (Runs)" value={rankLabel(snapshot.hustleRankByRuns, snapshot.totalProviders)} tooltip="Hustle's rank among all tracked providers by total upcoming run count." accent="amber" />
              <MetricCard title="Hustle Rank (Courses)" value={rankLabel(snapshot.hustleRankByCourses, snapshot.totalProviders)} tooltip="Hustle's rank among all tracked providers by number of active courses." accent="amber" />
            </div>
          )}
        </section>

        {/* ══ B. PROVIDER LEADERBOARD ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Provider Leaderboard</h2>
          <ProviderTable rows={providers ?? []} />
        </section>

        {/* ══ C. TOP COURSES LEADERBOARD ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Top Courses Leaderboard</h2>
          <CourseTable rows={courses ?? []} />
        </section>

        {/* ══ D. CATEGORY INTELLIGENCE ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Category Intelligence</h2>
          <CategoryMatrix categories={categories ?? []} providers={providers ?? []} />
        </section>

        {/* ══ E. HUSTLE VS MARKET ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Hustle vs Market</h2>
          {!hasMarketData ? (
            <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
              No data yet — populates after the next nightly refresh.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Hustle stat cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                <MetricCard title="Hustle Runs" value={gapAnalysis.hustle.totalRuns.toLocaleString()} tooltip="Hustle's total upcoming run count across all active courses." accent="indigo" />
                <MetricCard title="Hustle Courses" value={gapAnalysis.hustle.activeCourses.toLocaleString()} tooltip="Hustle's total active course count." accent="indigo" />
                <MetricCard title="Market Share" value={`${gapAnalysis.hustle.marketSharePct.toFixed(1)}%`} tooltip="Hustle's share of total market runs across all tracked providers." accent="indigo" />
                <MetricCard title="Hustle Rank" value={gapAnalysis.hustle.rank != null ? `#${gapAnalysis.hustle.rank}` : '—'} tooltip="Hustle's rank among all tracked providers by total runs." accent="amber" />
                <MetricCard
                  title="Hustle Top Course"
                  value={gapAnalysis.hustle.topCourse ? `${gapAnalysis.hustle.topCourse.title} (${gapAnalysis.hustle.topCourse.runs})` : '—'}
                  tooltip="Hustle's highest-run course."
                />
              </div>

              {/* Strong categories */}
              <div>
                <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Strong Categories</p>
                {gapAnalysis.strongCategories.length === 0 ? (
                  <p className="text-xs text-slate-600">None identified this refresh.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {gapAnalysis.strongCategories.map((cat) => (
                      <span key={cat} className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25 text-xs">
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* Weak categories */}
              <div className="rounded-xl border border-slate-800/60 overflow-hidden">
                <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/60">
                  <span className="text-[10px] font-mono text-amber-400 tracking-widest uppercase">Weak Categories</span>
                </div>
                {gapAnalysis.weakCategories.length === 0 ? (
                  <p className="text-xs text-slate-600 px-4 py-3">No weak categories flagged this refresh.</p>
                ) : (
                  <div className="divide-y divide-slate-800/40">
                    {gapAnalysis.weakCategories.map((w) => (
                      <div key={w.category} className="px-4 py-2.5 text-xs text-slate-300">
                        <span className="font-medium">{w.category}:</span> Hustle {w.hustleRuns} runs vs {w.leaderName} {w.leaderRuns}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Absent categories */}
              <div className="rounded-xl border border-slate-800/60 overflow-hidden">
                <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/60">
                  <span className="text-[10px] font-mono text-red-400 tracking-widest uppercase">Absent Categories</span>
                </div>
                {gapAnalysis.absentCategories.length === 0 ? (
                  <p className="text-xs text-slate-600 px-4 py-3">Hustle has presence in every tracked category.</p>
                ) : (
                  <div className="divide-y divide-slate-800/40">
                    {gapAnalysis.absentCategories.map((a) => (
                      <div key={a.category} className="px-4 py-2.5 text-xs text-slate-300">
                        <span className="font-medium">{a.category}</span> — {a.marketRuns} market runs
                        {a.topCompetitor ? `, led by ${a.topCompetitor}` : ''} — Hustle absent
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Competitors ahead */}
              <div>
                <p className="text-[10px] font-mono text-slate-500 tracking-widest uppercase mb-2">Competitors Ahead</p>
                {gapAnalysis.competitorsAhead.length === 0 ? (
                  <p className="text-xs text-slate-600">Hustle leads the market by total runs.</p>
                ) : (
                  <ul className="space-y-1">
                    {gapAnalysis.competitorsAhead.map((c) => (
                      <li key={c.name} className="flex justify-between text-xs text-slate-300 max-w-md">
                        <span>{c.name}</span>
                        <span className="font-mono text-slate-500">{c.runs} runs</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* What This Means for Hustle */}
              <div className="rounded-xl border border-indigo-800/30 bg-indigo-950/10 p-5">
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <h3 className="text-sm font-bold text-indigo-200">What This Means for Hustle</h3>
                  <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">
                    Calculated from cached MySkillsFuture data
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  <WhatThisMeansBlock title="Attack Opportunities" icon="⚔" items={gapAnalysis.whatThisMeans.attackOpportunities} />
                  <WhatThisMeansBlock title="Defensive Priorities" icon="🛡" items={gapAnalysis.whatThisMeans.defensivePriorities} />
                  <WhatThisMeansBlock title="SEO / Landing Page Opportunities" icon="🔍" items={gapAnalysis.whatThisMeans.seoOpportunities} />
                  <WhatThisMeansBlock title="Pricing / Positioning Insights" icon="$" items={gapAnalysis.whatThisMeans.pricingInsights} />
                  <WhatThisMeansBlock title="Course Scheduling Insights" icon="📅" items={gapAnalysis.whatThisMeans.schedulingInsights} />
                  <WhatThisMeansBlock title="Watchlist" icon="👁" items={gapAnalysis.whatThisMeans.watchlist} />
                </div>
              </div>
            </div>
          )}
        </section>

        {/* ══ F. RECENT COURSE CHANGES ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">Recent Course Changes</h2>
          <ChangesTimeline changes={changes} />
        </section>

        {/* ══ G. AI COURSE MARKET INSIGHTS ══ */}
        <section>
          <h2 className="text-sm font-semibold text-slate-300 mb-3">AI Course Market Insights</h2>
          {aiInsights.length === 0 ? (
            <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
              No AI course insights yet — generated nightly at 01:15 AM SGT after data refresh.
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {aiInsights.map((insight) => (
                <div key={insight.id} className="rounded-xl border border-slate-800/60 bg-slate-900/40 p-4 flex flex-col gap-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-violet-900/40 text-violet-300 border border-violet-700/50 uppercase">
                      {insight.insight_type.replace(/_/g, ' ')}
                    </span>
                    {insight.severity && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.low}`}>
                        {insight.severity}
                      </span>
                    )}
                    {insight.confidence && (
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase ${CONFIDENCE_STYLES[insight.confidence] ?? CONFIDENCE_STYLES.low}`}>
                        {insight.confidence} confidence
                      </span>
                    )}
                    <DataSourceBadge kind="ai" detail="AI-generated from cached course data" className="ml-auto" />
                  </div>
                  <p className="text-sm font-semibold text-slate-100">{insight.title}</p>
                  {insight.body && <p className="text-xs text-slate-400">{insight.body}</p>}
                  {insight.evidence.length > 0 && (
                    <ul className="space-y-1 mt-1">
                      {insight.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-slate-500 flex gap-1.5">
                          <span className="text-slate-700 shrink-0">•</span> {e}
                        </li>
                      ))}
                    </ul>
                  )}
                  {insight.recommended_action && (
                    <p className="text-xs text-indigo-300 mt-1 border-t border-slate-800/60 pt-2">
                      → {insight.recommended_action}
                    </p>
                  )}
                  <div className="flex items-center gap-2 text-[10px] text-slate-600 mt-auto pt-1 flex-wrap">
                    {insight.suggested_owner && <span>Owner: {insight.suggested_owner}</span>}
                    {insight.timeframe && <span>· {insight.timeframe}</span>}
                    <span className="ml-auto">{fmtSgt(insight.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ══ H. DATA SOURCES ══ */}
        <SourcePanel
          module="course_intelligence"
          extraLines={[
            hasMarketData
              ? `Cached in Supabase — ${snapshot.totalCourses.toLocaleString()} course records across ${snapshot.totalProviders} providers`
              : 'No cached course records yet',
          ]}
        />

        <footer className="text-[10px] font-mono text-slate-700 space-y-0.5 pb-4">
          <p>
            SOURCE: MySkillsFuture API (cached in Supabase) · Run counts refresh nightly · Click ↗ links to verify live counts on MySkillsFuture
          </p>
          <p>
            HUSTLE SG = HUSTLE INSTITUTE PTE. LTD. + HUSTLE ACADEMY PTE. LTD. · All derived metrics on this page are calculated
            from cached MySkillsFuture data unless explicitly marked AI-generated.
          </p>
        </footer>

      </div>
    </AppLayout>
  )
}
