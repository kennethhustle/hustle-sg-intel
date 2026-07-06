/**
 * Performance Intelligence — CEO & Growth Team Dashboard
 *
 * Answers 5 strategic questions:
 * 1. Which competitors are investing the most?
 * 2. Who is aggressively buying demand?
 * 3. Which channels are competitors prioritising?
 * 4. Is Hustle under-investing?
 * 5. Which competitors should we monitor?
 *
 * Data sources:
 * - Meta Ads: Meta Ad Library API (auto-refreshed 00:25 SGT daily via marketing-refresh cron)
 * - Google Reviews/Ratings: Google Places API (auto-refreshed 00:25 SGT daily via marketing-refresh cron)
 * - Google Ads: Manually verified estimate from Google Ads Transparency (see google_ads_verified_at)
 * - SF Runs & Respondents: Supabase sf_courses table (cached, nightly)
 */

import type { ReactNode } from 'react'
import { AppLayout } from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { RefreshStatus } from '@/components/marketing/refresh-status'
import type { RefreshLog } from '@/components/marketing/refresh-status'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'

export const revalidate = 300

// ─── Types ────────────────────────────────────────────────────────────────────

type ThreatLevel = 'VERY HIGH' | 'HIGH' | 'MEDIUM' | 'LOW'

interface Competitor {
  id: string
  name: string
  color: string
  isHustle?: boolean
  metaAds: number
  googleAds: number
  googleRating: number
  googleReviews: number
  sfRuns: number
  sfRespondents: number
  reviewUrl: string
  metaAdsUrl: string
  googleAdsUrl: string
  sfUrl: string
  googleAdsVerifiedAt: string | null
  googleAdsSourceUrl: string | null
  googleAdsEnteredBy: string | null
  reviewDelta30d: number | null
  // Computed
  threatScore?: number
  threatLevel?: ThreatLevel
  metaRank?: number
  reviewRank?: number
  googleAdsRank?: number
  scoreBreakdown?: { reviews: number; googleAds: number; metaAds: number; sfRespondents: number; sfRuns: number }
}

// ─── Threat Score engine ──────────────────────────────────────────────────────

// Threat Score weights — must stay in sync with the "How is this scored?" panel copy below.
const SCORE_WEIGHTS = { reviews: 20, googleAds: 25, metaAds: 25, sfRespondents: 20, sfRuns: 10 } as const

function computeScores(data: Competitor[]): Competitor[] {
  const maxReviews     = Math.max(...data.map(c => c.googleReviews), 1)
  const maxGoogleAds   = Math.max(...data.map(c => c.googleAds), 1)
  const maxMetaAds     = Math.max(...data.map(c => c.metaAds), 1)
  const maxRespondents = Math.max(...data.map(c => c.sfRespondents), 1)
  const maxRuns        = Math.max(...data.map(c => c.sfRuns), 1)

  const scored = data.map(c => {
    const breakdown = {
      reviews:       (c.googleReviews  / maxReviews)     * SCORE_WEIGHTS.reviews,
      googleAds:     (c.googleAds      / maxGoogleAds)   * SCORE_WEIGHTS.googleAds,
      metaAds:       (c.metaAds        / maxMetaAds)     * SCORE_WEIGHTS.metaAds,
      sfRespondents: (c.sfRespondents  / maxRespondents) * SCORE_WEIGHTS.sfRespondents,
      sfRuns:        (c.sfRuns         / maxRuns)        * SCORE_WEIGHTS.sfRuns,
    }
    const score = breakdown.reviews + breakdown.googleAds + breakdown.metaAds + breakdown.sfRespondents + breakdown.sfRuns

    const threatLevel: ThreatLevel =
      score >= 60 ? 'VERY HIGH' :
      score >= 35 ? 'HIGH'      :
      score >= 18 ? 'MEDIUM'    : 'LOW'

    return { ...c, threatScore: Math.round(score * 10) / 10, threatLevel, scoreBreakdown: breakdown }
  })

  const byMeta      = [...scored].sort((a, b) => b.metaAds - a.metaAds)
  const byReviews   = [...scored].sort((a, b) => b.googleReviews - a.googleReviews)
  const byGoogleAds = [...scored].sort((a, b) => b.googleAds - a.googleAds)

  return scored.map(c => ({
    ...c,
    metaRank:      byMeta.findIndex(x => x.name === c.name) + 1,
    reviewRank:    byReviews.findIndex(x => x.name === c.name) + 1,
    googleAdsRank: byGoogleAds.findIndex(x => x.name === c.name) + 1,
  }))
}

// ─── Threat badge ─────────────────────────────────────────────────────────────

const THREAT_STYLE: Record<ThreatLevel, { badge: string; bar: string; dot: string }> = {
  'VERY HIGH': { badge: 'bg-red-950/70 text-red-400 border-red-800/60',           bar: 'bg-red-500',    dot: 'bg-red-500'    },
  'HIGH':      { badge: 'bg-orange-950/60 text-orange-400 border-orange-800/60',  bar: 'bg-orange-500', dot: 'bg-orange-500' },
  'MEDIUM':    { badge: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/50',  bar: 'bg-yellow-500', dot: 'bg-yellow-500' },
  'LOW':       { badge: 'bg-slate-800 text-slate-400 border-slate-700',           bar: 'bg-slate-500',  dot: 'bg-slate-500'  },
}

// ─── UI helpers ───────────────────────────────────────────────────────────────

function Section({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900/50 border border-slate-800 rounded-xl p-5 ${className}`}>{children}</div>
}

function H2({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold text-white tracking-tight">{children}</h2>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Rank({ n }: { n: number }) {
  const color = n === 1 ? 'text-yellow-400' : n <= 3 ? 'text-white' : 'text-slate-400'
  return <span className={`font-mono font-bold text-sm ${color}`}>#{n}</span>
}

function ThreatBadge({ level }: { level: ThreatLevel }) {
  const s = THREAT_STYLE[level]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wide border ${s.badge}`}>
      {level}
    </span>
  )
}

// ─── Recommendation engine ────────────────────────────────────────────────────

function buildRecommendation(h: Competitor, topGoogleAds: Competitor): string[] {
  const recs: string[] = []
  if ((h.reviewRank ?? 10) > 5)    recs.push(`Google Reviews rank #${h.reviewRank} — run a post-course review campaign to move into top 5.`)
  if ((h.googleAdsRank ?? 10) > 5) recs.push(`Google Ads rank #${h.googleAdsRank} — increase Google search ad spend; ${topGoogleAds.name} outspends by ${topGoogleAds.googleAds - h.googleAds} ads.`)
  if ((h.metaRank ?? 10) > 3)      recs.push(`Meta Ads rank #${h.metaRank} — at ${h.metaAds} active ads, there is room to increase social ad volume.`)
  recs.push(`Maintain ${h.sfRuns} upcoming SF runs to stay top 3 in market capacity.`)
  return recs.slice(0, 2)
}

// ─── Data fetch ───────────────────────────────────────────────────────────────

async function getData() {
  const supabase = await createClient()

  const { data: rows } = await supabase
    .from('competitors')
    .select(`
      id, name, color, is_hustle,
      competitor_marketing_data (
        google_reviews, google_rating, google_ads, meta_ads,
        sf_runs, sf_respondents,
        review_url, meta_ads_url, google_ads_url, sf_url,
        google_ads_verified_at, google_ads_source_url, google_ads_notes, google_ads_entered_by
      )
    `)
    .eq('active', true)
    .order('name')

  const { data: logs } = await supabase
    .from('data_refresh_logs')
    .select('id, started_at, completed_at, status, duration_seconds, records_updated, error_message, triggered_by')
    .eq('module', 'marketing')
    .order('started_at', { ascending: false })
    .limit(10)

  const latestLog: RefreshLog | null         = (logs?.[0] as RefreshLog) ?? null
  const lastSuccessfulLog: RefreshLog | null = (logs?.find(l => l.status === 'success' || l.status === 'partial') as RefreshLog) ?? null

  // Review growth: marketing_snapshots — compute delta since earliest snapshot per competitor (>=2 rows)
  const { data: snapshotRows } = await supabase
    .from('marketing_snapshots')
    .select('competitor_id, snapshot_date, google_reviews')
    .order('snapshot_date', { ascending: true })

  const snapshotsByCompetitor = new Map<string, { date: string; reviews: number | null }[]>()
  for (const s of snapshotRows ?? []) {
    const arr = snapshotsByCompetitor.get(s.competitor_id) ?? []
    arr.push({ date: s.snapshot_date, reviews: s.google_reviews })
    snapshotsByCompetitor.set(s.competitor_id, arr)
  }
  const reviewDeltaByCompetitor = new Map<string, number | null>()
  for (const [competitorId, points] of snapshotsByCompetitor.entries()) {
    const withValues = points.filter(p => p.reviews != null)
    if (withValues.length < 2) { reviewDeltaByCompetitor.set(competitorId, null); continue }
    const earliest = withValues[0]
    const latest = withValues[withValues.length - 1]
    reviewDeltaByCompetitor.set(competitorId, (latest.reviews ?? 0) - (earliest.reviews ?? 0))
  }

  // Marketing-related alerts (high/critical severity)
  const { data: alertRows } = await supabase
    .from('alerts')
    .select('id, competitor_id, alert_type, severity, title, description, created_at')
    .eq('is_dismissed', false)
    .in('severity', ['high', 'critical'])
    .order('created_at', { ascending: false })
    .limit(20)

  const MARKETING_ALERT_TYPES = ['marketing_opportunity', 'ads', 'meta_ads', 'google_ads', 'reviews', 'marketing']
  const marketingAlerts = (alertRows ?? []).filter(a =>
    MARKETING_ALERT_TYPES.some(t => (a.alert_type ?? '').toLowerCase().includes(t))
  )

  type MktRow = {
    google_reviews: number | null
    google_rating:  number | null
    google_ads:     number | null
    meta_ads:       number | null
    sf_runs:        number | null
    sf_respondents: number | null
    review_url:     string | null
    meta_ads_url:   string | null
    google_ads_url: string | null
    sf_url:         string | null
    google_ads_verified_at: string | null
    google_ads_source_url:  string | null
    google_ads_notes:       string | null
    google_ads_entered_by:  string | null
  }
  type CompRow = {
    id:         string
    name:       string
    color:      string
    is_hustle:  boolean
    competitor_marketing_data: MktRow | MktRow[] | null
  }

  const mapped: Competitor[] = ((rows ?? []) as CompRow[]).map(r => {
    const mkt = Array.isArray(r.competitor_marketing_data)
      ? r.competitor_marketing_data[0]
      : r.competitor_marketing_data

    return {
      id:             r.id,
      name:           r.name,
      color:          r.color ?? '#6366f1',
      isHustle:       r.is_hustle,
      metaAds:        mkt?.meta_ads       ?? 0,
      googleAds:      mkt?.google_ads     ?? 0,
      googleRating:   mkt?.google_rating  ?? 0,
      googleReviews:  mkt?.google_reviews ?? 0,
      sfRuns:         mkt?.sf_runs        ?? 0,
      sfRespondents:  mkt?.sf_respondents ?? 0,
      reviewUrl:      mkt?.review_url     ?? '#',
      metaAdsUrl:     mkt?.meta_ads_url   ?? '#',
      googleAdsUrl:   mkt?.google_ads_url ?? '#',
      sfUrl:          mkt?.sf_url         ?? '#',
      googleAdsVerifiedAt: mkt?.google_ads_verified_at ?? null,
      googleAdsSourceUrl:  mkt?.google_ads_source_url ?? null,
      googleAdsEnteredBy:  mkt?.google_ads_entered_by ?? null,
      reviewDelta30d: reviewDeltaByCompetitor.get(r.id) ?? null,
    }
  })

  return { competitors: mapped, latestLog, lastSuccessfulLog, marketingAlerts }
}

// ─────────────────────────────────────────────────────────────────────────────

export default async function PerformanceIntelligencePage() {
  const { competitors: RAW_DATA, latestLog, lastSuccessfulLog, marketingAlerts } = await getData()

  const COMPETITORS = computeScores(RAW_DATA.length > 0 ? RAW_DATA : [])

  const sorted_threat    = [...COMPETITORS].sort((a, b) => (b.threatScore ?? 0) - (a.threatScore ?? 0))
  const sorted_meta      = [...COMPETITORS].sort((a, b) => b.metaAds - a.metaAds)
  const sorted_reviews   = [...COMPETITORS].sort((a, b) => b.googleReviews - a.googleReviews)
  const sorted_googleAds = [...COMPETITORS].sort((a, b) => b.googleAds - a.googleAds)

  const topMetaBuyer    = sorted_meta[0]
  const topGoogleAds    = sorted_googleAds[0]
  const topReviews      = sorted_reviews[0]
  const hustle          = COMPETITORS.find(c => c.isHustle)
  const hustleThreatRank = sorted_threat.findIndex(c => c.isHustle) + 1

  const RECOMMENDATIONS = hustle ? buildRecommendation(hustle, topGoogleAds) : []

  // Growth alerts — sourced ONLY from the alerts table (high/critical, marketing-related).
  const ALERTS = marketingAlerts.map(a => ({
    severity: a.severity,
    text: a.title,
    sub: a.description ?? '',
  }))

  if (COMPETITORS.length === 0) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
          <div className="text-center space-y-3">
            <p className="text-white font-bold text-lg">No data yet</p>
            <p className="text-slate-500 text-sm">Run the SQL migration (004_marketing_data.sql) to seed competitor data, then refresh.</p>
          </div>
        </div>
      </AppLayout>
    )
  }

  const tableRows = sorted_threat.filter(c => !c.isHustle)
  const maxMeta   = sorted_meta[0].metaAds
  const maxGAds   = sorted_googleAds[0].googleAds
  const maxRev    = sorted_reviews[0].googleReviews

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Marketing Intelligence</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Who is buying demand · Google presence · Meta advertising · Meta Ads &amp; Google Reviews auto-refresh 00:25 SGT daily
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <DataSourceBadge kind="live" detail="Meta Ad Library + Google Places API, marketing-refresh cron 00:25 SGT" />
            <RefreshStatus latestLog={latestLog} lastSuccessfulLog={lastSuccessfulLog} />
          </div>
        </div>

        <div className="grid grid-cols-4 gap-4">
          <Section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold tracking-widest text-red-400 uppercase">Top Meta Ad Buyer</p>
              <DataSourceBadge kind="live" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: topMetaBuyer.color }} />
              <p className="text-sm font-bold text-white truncate">{topMetaBuyer.name}</p>
            </div>
            <p className="text-3xl font-black text-red-400 mb-0.5">{topMetaBuyer.metaAds}</p>
            <p className="text-xs text-slate-500">active Meta ads</p>
            {hustle && (
              <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                Hustle: <span className="text-white font-bold">{hustle.metaAds} ads</span> — rank <span className="text-indigo-400 font-bold">#{hustle.metaRank}</span>
              </div>
            )}
          </Section>

          <Section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold tracking-widest text-blue-400 uppercase">Top Google Advertiser</p>
              <DataSourceBadge kind="manual" asOf={topGoogleAds.googleAdsVerifiedAt} />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: topGoogleAds.color }} />
              <p className="text-sm font-bold text-white truncate">{topGoogleAds.name}</p>
            </div>
            <p className="text-3xl font-black text-blue-400 mb-0.5">~{topGoogleAds.googleAds}</p>
            <p className="text-xs text-slate-500">estimated Google ads</p>
            {hustle && (
              <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                Hustle: <span className="text-white font-bold">~{hustle.googleAds} ads</span> — rank <span className="text-indigo-400 font-bold">#{hustle.googleAdsRank}</span>
              </div>
            )}
          </Section>

          <Section>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase">Top Google Reviews</p>
              <DataSourceBadge kind="live" />
            </div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: topReviews.color }} />
              <p className="text-sm font-bold text-white truncate">{topReviews.name}</p>
            </div>
            <p className="text-3xl font-black text-yellow-400 mb-0.5">{topReviews.googleReviews.toLocaleString()}</p>
            <p className="text-xs text-slate-500">{topReviews.googleRating} ★ Google rating</p>
            {topReviews.reviewDelta30d != null && (
              <p className={`text-[11px] mt-0.5 font-mono ${topReviews.reviewDelta30d > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                {topReviews.reviewDelta30d > 0 ? '+' : ''}{topReviews.reviewDelta30d} since first snapshot
              </p>
            )}
            {hustle && (
              <div className="mt-3 pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                Hustle: <span className="text-white font-bold">{hustle.googleReviews}</span> reviews — rank <span className="text-indigo-400 font-bold">#{hustle.reviewRank}</span>
                {hustle.reviewDelta30d != null && (
                  <span className={`ml-2 font-mono ${hustle.reviewDelta30d > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                    ({hustle.reviewDelta30d > 0 ? '+' : ''}{hustle.reviewDelta30d})
                  </span>
                )}
              </div>
            )}
          </Section>

          {hustle ? (
            <Section className="border-indigo-800/50 bg-indigo-950/20">
              <p className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase mb-3">Hustle Position</p>
              <p className="text-3xl font-black text-indigo-400 mb-1">#{hustleThreatRank}</p>
              <p className="text-xs text-slate-500 mb-3">overall threat rank</p>
              <div className="space-y-1.5 text-[11px]">
                <div className="flex justify-between">
                  <span className="text-slate-500">Meta Ads</span>
                  <span className="text-white font-bold">#{hustle.metaRank} of {COMPETITORS.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Google Ads</span>
                  <span className="text-white font-bold">#{hustle.googleAdsRank} of {COMPETITORS.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Google Reviews</span>
                  <span className="text-orange-400 font-bold">#{hustle.reviewRank} of {COMPETITORS.length}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Threat Level</span>
                  <ThreatBadge level={hustle.threatLevel!} />
                </div>
              </div>
            </Section>
          ) : (
            <Section>
              <p className="text-slate-500 text-xs">Hustle SG not found in database.</p>
            </Section>
          )}
        </div>

        <Section>
          <H2 sub="Ranked by threat score. Includes all tracked competitors.">
            Competitor Performance Table
          </H2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-slate-500 font-bold tracking-widest uppercase border-b border-slate-800">
                  <th className="text-left pb-3 pr-4">Competitor</th>
                  <th className="text-right pb-3 px-4">Google Rating</th>
                  <th className="text-right pb-3 px-4">Google Reviews</th>
                  <th className="text-right pb-3 px-4">
                    <div className="flex items-center justify-end gap-1.5">
                      Google Ads
                      <DataSourceBadge kind="manual" />
                    </div>
                  </th>
                  <th className="text-right pb-3 px-4">Meta Ads</th>
                  <th className="text-right pb-3 pl-4">Threat Level</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {sorted_threat.map((c, i) => {
                  const verifiedAgeDays = c.googleAdsVerifiedAt
                    ? Math.floor((Date.now() - new Date(c.googleAdsVerifiedAt).getTime()) / 86_400_000)
                    : null
                  const overdue = verifiedAgeDays === null || verifiedAgeDays > 30
                  const breakdownTitle = c.scoreBreakdown
                    ? `Threat score ${c.threatScore} = Reviews ${c.scoreBreakdown.reviews.toFixed(1)} + Google Ads ${c.scoreBreakdown.googleAds.toFixed(1)} + Meta Ads ${c.scoreBreakdown.metaAds.toFixed(1)} + SF Respondents ${c.scoreBreakdown.sfRespondents.toFixed(1)} + SF Runs ${c.scoreBreakdown.sfRuns.toFixed(1)}`
                    : undefined
                  return (
                  <tr
                    key={c.name}
                    className={`${c.isHustle ? 'bg-indigo-950/20' : 'hover:bg-slate-800/20'} transition-colors`}
                  >
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-2.5">
                        <span className="text-slate-600 text-xs w-4 shrink-0 font-mono">{i + 1}</span>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                        <span className={`font-semibold ${c.isHustle ? 'text-indigo-300' : 'text-white'}`}>
                          {c.name}
                          {c.isHustle && <span className="ml-1.5 text-[10px] text-indigo-500 font-normal">YOU</span>}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <a href={c.reviewUrl} target="_blank" rel="noopener noreferrer" className="hover:opacity-80 transition-opacity">
                        <span className="text-yellow-400 font-bold">{c.googleRating}</span>
                        <span className="text-slate-600 text-xs"> ★</span>
                      </a>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden">
                          <div
                            className="h-full bg-yellow-500 rounded-full"
                            style={{ width: `${(c.googleReviews / maxRev) * 100}%` }}
                          />
                        </div>
                        <a
                          href={c.reviewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-white hover:text-yellow-400 font-mono text-xs w-14 text-right transition-colors underline decoration-slate-700 hover:decoration-yellow-400"
                        >
                          {c.googleReviews.toLocaleString()}
                        </a>
                        {c.reviewDelta30d != null && (
                          <span className={`text-[10px] font-mono ${c.reviewDelta30d > 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                            {c.reviewDelta30d > 0 ? '+' : ''}{c.reviewDelta30d}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${(c.googleAds / maxGAds) * 100}%` }}
                          />
                        </div>
                        <a
                          href={c.googleAdsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-300 hover:text-blue-400 font-mono text-xs w-10 text-right transition-colors underline decoration-slate-700 hover:decoration-blue-400"
                        >
                          ~{c.googleAds}
                        </a>
                        {overdue ? (
                          <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-950/60 border border-amber-800/50 text-amber-400" title={c.googleAdsVerifiedAt ? `Last verified ${verifiedAgeDays}d ago` : 'Never verified'}>
                            ⚠ overdue
                          </span>
                        ) : (
                          <span className="text-[9px] text-slate-600 font-mono" title={`Verified ${verifiedAgeDays}d ago`}>
                            {verifiedAgeDays}d
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-slate-800 rounded-full h-1 overflow-hidden">
                          <div
                            className="h-full bg-red-500 rounded-full"
                            style={{ width: `${(c.metaAds / maxMeta) * 100}%` }}
                          />
                        </div>
                        <a
                          href={c.metaAdsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-slate-300 hover:text-red-400 font-mono text-xs w-8 text-right transition-colors underline decoration-slate-700 hover:decoration-red-400"
                        >
                          {c.metaAds}
                        </a>
                      </div>
                    </td>
                    <td className="py-3 pl-4 text-right">
                      <span title={breakdownTitle}>
                        <ThreatBadge level={c.threatLevel!} />
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-slate-600 mt-3">
            Threat Score = Google Reviews 20% · Google Ads 25% · Meta Ads 25% · SF Attendees 20% · SF Runs 10%
            &nbsp;·&nbsp; Google Ads manually verified via Google Ads Transparency (⚠ overdue if &gt;30 days old) · Meta Ads live from Meta Ad Library API · Click any number to view source
          </p>

          <details className="mt-3 group">
            <summary className="cursor-pointer text-[11px] text-indigo-400 hover:text-indigo-300 font-semibold select-none list-none flex items-center gap-1">
              <span className="group-open:rotate-90 transition-transform inline-block">▸</span> How is this scored?
            </summary>
            <div className="mt-2 p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 text-[11px] text-slate-400 leading-relaxed space-y-1.5">
              <p className="text-slate-300 font-semibold">Threat Score formula (0–100, weighted sum of each metric normalised against the market maximum):</p>
              <ul className="list-disc list-inside space-y-0.5 font-mono">
                <li>Google Reviews: (reviews ÷ max reviews) × {SCORE_WEIGHTS.reviews}</li>
                <li>Google Ads: (ads ÷ max ads) × {SCORE_WEIGHTS.googleAds}</li>
                <li>Meta Ads: (ads ÷ max ads) × {SCORE_WEIGHTS.metaAds}</li>
                <li>SF Respondents: (respondents ÷ max respondents) × {SCORE_WEIGHTS.sfRespondents}</li>
                <li>SF Runs: (runs ÷ max runs) × {SCORE_WEIGHTS.sfRuns}</li>
              </ul>
              <p>Thresholds: ≥60 VERY HIGH · ≥35 HIGH · ≥18 MEDIUM · below MEDIUM = LOW. Hover any Threat Level badge above to see the per-factor contribution for that competitor.</p>
            </div>
          </details>
        </Section>

        <div className="grid grid-cols-2 gap-4">
          <Section>
            <H2 sub="Top performer in each channel">Market Leaders</H2>
            <div className="space-y-4">
              {[
                {
                  icon: '🏆',
                  label: 'Most Google Reviews',
                  winner: sorted_reviews[0],
                  value: sorted_reviews[0].googleReviews.toLocaleString(),
                  sub: `${sorted_reviews[0].googleRating} ★ · ${sorted_reviews[1]?.name} trails by ${(sorted_reviews[0].googleReviews - (sorted_reviews[1]?.googleReviews ?? 0)).toLocaleString()}`,
                  color: 'text-yellow-400',
                },
                {
                  icon: '🏆',
                  label: 'Most Meta Ads',
                  winner: sorted_meta[0],
                  value: `${sorted_meta[0].metaAds} ads`,
                  sub: sorted_meta[0].metaAds === sorted_meta[1]?.metaAds
                    ? `Tied with ${sorted_meta[1].name} · Both running ${sorted_meta[1].metaAds} active ads`
                    : `#2 ${sorted_meta[1]?.name} running ${sorted_meta[1]?.metaAds ?? 0} active ads`,
                  color: 'text-red-400',
                },
                {
                  icon: '🏆',
                  label: 'Most Google Ads',
                  winner: sorted_googleAds[0],
                  value: `~${sorted_googleAds[0].googleAds} ads`,
                  sub: `${Math.round(sorted_googleAds[0].googleAds / (sorted_googleAds[1]?.googleAds || 1))}× more than #2 ${sorted_googleAds[1]?.name} (~${sorted_googleAds[1]?.googleAds})`,
                  color: 'text-blue-400',
                },
                {
                  icon: '🏆',
                  label: 'Most SF Course Runs',
                  winner: [...COMPETITORS].sort((a, b) => b.sfRuns - a.sfRuns)[0],
                  value: `${[...COMPETITORS].sort((a, b) => b.sfRuns - a.sfRuns)[0].sfRuns} runs`,
                  sub: 'Dominates SkillsFuture scheduling availability',
                  color: 'text-orange-400',
                },
              ].map(item => (
                <div key={item.label} className="flex items-start gap-3">
                  <span className="text-base mt-0.5 shrink-0">{item.icon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-0.5">{item.label}</p>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.winner.color }} />
                      <span className="text-white font-bold text-sm">{item.winner.name}</span>
                      <span className={`font-mono font-black text-sm ${item.color}`}>{item.value}</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          {hustle ? (
            <Section className="border-indigo-800/40 bg-indigo-950/10">
              <H2 sub="Where Hustle stands — and what to do">Hustle vs Market</H2>
              <div className="space-y-3 mb-5">
                {[
                  {
                    label: 'Google Reviews',
                    hustleVal: `${hustle.googleReviews} reviews`,
                    rank: hustle.reviewRank!,
                    leaderVal: `${sorted_reviews[0].name}: ${sorted_reviews[0].googleReviews.toLocaleString()}`,
                    urgent: hustle.reviewRank! > 5,
                  },
                  {
                    label: 'Meta Ads',
                    hustleVal: `${hustle.metaAds} active`,
                    rank: hustle.metaRank!,
                    leaderVal: `${sorted_meta[0].name}: ${sorted_meta[0].metaAds}`,
                    urgent: hustle.metaRank! > 5,
                  },
                  {
                    label: 'Google Ads',
                    hustleVal: `~${hustle.googleAds} ads`,
                    rank: hustle.googleAdsRank!,
                    leaderVal: `${sorted_googleAds[0].name}: ~${sorted_googleAds[0].googleAds}`,
                    urgent: hustle.googleAdsRank! > 5,
                  },
                  {
                    label: 'SF Course Runs',
                    hustleVal: `${hustle.sfRuns} upcoming`,
                    rank: [...COMPETITORS].sort((a, b) => b.sfRuns - a.sfRuns).findIndex(c => c.isHustle) + 1,
                    leaderVal: `${[...COMPETITORS].sort((a, b) => b.sfRuns - a.sfRuns)[0].name}: ${[...COMPETITORS].sort((a, b) => b.sfRuns - a.sfRuns)[0].sfRuns}`,
                    urgent: false,
                  },
                ].map(row => (
                  <div key={row.label} className="grid grid-cols-[auto_1fr_auto] gap-3 items-center">
                    <span className="text-slate-500 text-xs w-28 shrink-0">{row.label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${row.urgent ? 'text-orange-400' : 'text-white'}`}>
                        {row.hustleVal}
                      </span>
                      <span className="text-[10px] text-slate-600 truncate">vs {row.leaderVal}</span>
                    </div>
                    <Rank n={row.rank} />
                  </div>
                ))}

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-slate-500 text-xs">Overall Threat Level</span>
                  <ThreatBadge level={hustle.threatLevel!} />
                </div>
              </div>

              <div className="bg-slate-800/40 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase">Recommended Actions</p>
                  <span className="text-[9px] font-mono text-slate-600 uppercase tracking-wide">Generated from ranking rules</span>
                </div>
                {RECOMMENDATIONS.map((r, i) => (
                  <p key={i} className="text-xs text-slate-300 leading-relaxed flex gap-2">
                    <span className="text-indigo-400 shrink-0 font-bold">{i + 1}.</span>
                    {r}
                  </p>
                ))}
              </div>
            </Section>
          ) : (
            <Section>
              <p className="text-slate-500 text-xs">Hustle SG not found in database.</p>
            </Section>
          )}
        </div>

        <Section>
          <H2 sub="Sourced from the alerts table only (high/critical, marketing-related)">Growth Alerts</H2>
          {ALERTS.length === 0 ? (
            <p className="text-xs text-slate-500 italic">No active high/critical marketing alerts right now.</p>
          ) : (
            <div className="space-y-2">
              {ALERTS.map((a, i) => {
                const styles = {
                  critical: { dot: 'bg-red-500',    badge: 'bg-red-950/60 border-red-800/60 text-red-400',       label: '🚨 CRITICAL' },
                  high:     { dot: 'bg-orange-500', badge: 'bg-orange-950/50 border-orange-800/50 text-orange-400', label: '⚠️ HIGH'     },
                  medium:   { dot: 'bg-yellow-500', badge: 'bg-yellow-950/40 border-yellow-800/40 text-yellow-400', label: '📊 MEDIUM'   },
                  low:      { dot: 'bg-slate-500',  badge: 'bg-slate-800 border-slate-700 text-slate-400',        label: '💡 LOW'      },
                }[a.severity as 'critical' | 'high' | 'medium' | 'low']

                return (
                  <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-slate-800/30 border border-slate-800/60 hover:bg-slate-800/50 transition-colors">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${styles.badge} shrink-0 mt-0.5`}>
                      {styles.label}
                    </span>
                    <div>
                      <p className="text-sm text-white font-medium leading-snug">{a.text}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{a.sub}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <div className="text-[10px] text-slate-700 flex flex-wrap gap-4 pb-2">
          <a href="https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=SG" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Meta Ads: Meta Ad Library (auto-refreshed 00:25 SGT daily)</a>
          <a href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Google Reviews: Google Places API (auto-refreshed 00:25 SGT daily)</a>
          <a href="https://adstransparency.google.com/?region=SG" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">Google Ads: Google Ads Transparency (manually verified)</a>
          <a href="https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory.html" target="_blank" rel="noopener noreferrer" className="hover:text-slate-500 transition-colors">SF Data: MySkillsFuture via Supabase</a>
          {latestLog?.completed_at && (
            <span>
              Last refresh: {new Intl.DateTimeFormat('en-SG', {
                timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: false,
              }).format(new Date(latestLog.completed_at))} SGT
            </span>
          )}
        </div>

      </div>
    </AppLayout>
  )
}
