/**
 * Search Intelligence — Market Demand Intelligence Dashboard
 *
 * MANUAL SEO SNAPSHOT. Data is loaded from seo_keywords / seo_rankings /
 * seo_snapshot_meta (see supabase/migrations/008_seo_intelligence.sql and
 * 009_seed_seo_snapshot.sql). There is no automated rank-tracking API
 * connected — this is a human-verified point-in-time snapshot that must be
 * periodically re-verified (see "Next review due" in the header banner).
 */

import type { ReactNode } from 'react'
import { AppLayout } from '@/components/layout/app-layout'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 300

// ─── Types ───────────────────────────────────────────────────────────────────
type Competition = 'HIGH' | 'MEDIUM' | 'LOW'
type HustlePos   = 'Ranking' | 'Absent' | 'Ad only'
type Severity    = 'critical' | 'high' | 'medium'

interface RankingRow {
  keyword_id: string
  competitor_id: string | null
  competitor_name: string | null
  position: number | null
  is_ad: boolean
  checked_at: string
}

interface KeywordRow {
  id: string
  keyword: string
  category: string | null
  source_url: string | null
  notes: string | null
}

interface CompetitorRow {
  id: string
  name: string
  color: string
  is_hustle: boolean
}

// ─── Data layer ───────────────────────────────────────────────────────────────
async function getData() {
  const supabase = await createClient()

  const [kwRes, rankRes, metaRes, compRes] = await Promise.all([
    supabase.from('seo_keywords').select('id, keyword, category, source_url, notes').eq('active', true).order('keyword'),
    supabase.from('seo_rankings').select('keyword_id, competitor_id, competitor_name, position, is_ad, checked_at'),
    supabase.from('seo_snapshot_meta').select('verified_at, verified_by, method, next_review_at, notes').order('verified_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('competitors').select('id, name, color, is_hustle').eq('active', true),
  ])

  const keywords: KeywordRow[] = kwRes.data ?? []
  const rankings: RankingRow[] = rankRes.data ?? []
  const meta = metaRes.data ?? null
  const competitors: CompetitorRow[] = compRes.data ?? []

  const compById = new Map(competitors.map(c => [c.id, c]))
  const hustle = competitors.find(c => c.is_hustle) ?? null

  const rankingsByKeyword = new Map<string, RankingRow[]>()
  for (const r of rankings) {
    const arr = rankingsByKeyword.get(r.keyword_id) ?? []
    arr.push(r)
    rankingsByKeyword.set(r.keyword_id, arr)
  }

  // ── Per-keyword derived view ────────────────────────────────────────────────
  const keywordViews = keywords.map(kw => {
    const rows = (rankingsByKeyword.get(kw.id) ?? []).slice().sort((a, b) => {
      if (a.is_ad !== b.is_ad) return a.is_ad ? 1 : -1
      return (a.position ?? 999) - (b.position ?? 999)
    })
    const results = rows.map(r => {
      const comp = r.competitor_id ? compById.get(r.competitor_id) : null
      return {
        name: comp?.name ?? r.competitor_name ?? 'Unknown',
        color: comp?.color ?? '#64748b',
        position: r.position,
        isAd: r.is_ad,
        isHustle: comp?.is_hustle ?? false,
      }
    })
    const hustlePresent = results.some(r => r.isHustle)
    const hasOrganic = rows.some(r => !r.is_ad)
    return { ...kw, results, hustlePresent, hasOrganic }
  })

  // ── Category leaders: best (lowest) organic position per category ──────────
  const categoryMap = new Map<string, { keyword: KeywordRow; results: typeof keywordViews[number]['results']; hasOrganic: boolean }[]>()
  for (const kv of keywordViews) {
    const cat = kv.category ?? 'Other'
    const arr = categoryMap.get(cat) ?? []
    arr.push({ keyword: kv, results: kv.results, hasOrganic: kv.hasOrganic })
    categoryMap.set(cat, arr)
  }

  const categories = Array.from(categoryMap.entries()).map(([name, kws]) => {
    let best: { name: string; color: string; position: number } | null = null
    let hustleStatus: HustlePos = 'Absent'
    for (const { results } of kws) {
      for (const r of results) {
        if (r.isHustle) {
          if (r.isAd) hustleStatus = hustleStatus === 'Ranking' ? hustleStatus : 'Ad only'
          if (!r.isAd && r.position) hustleStatus = 'Ranking'
        }
        if (!r.isAd && r.position != null) {
          if (!best || r.position < best.position) best = { name: r.name, color: r.color, position: r.position }
        }
      }
    }
    const organicCount = kws.reduce((s, k) => s + k.results.filter(r => !r.isAd && r.position != null).length, 0)
    const competition: Competition = organicCount >= 5 ? 'HIGH' : organicCount >= 2 ? 'MEDIUM' : 'LOW'
    return {
      name,
      topPrivateProvider: best?.name ?? 'None (tracked)',
      topColor: best?.color ?? '#475569',
      hustleStatus,
      competition,
      keywordCount: kws.length,
    }
  })

  // ── Hustle absence: keywords where no ranking joins to is_hustle competitor ─
  const hustleAbsentKeywords = keywordViews.filter(kv => !kv.hustlePresent)

  // ── Uncontested opportunities: keywords with zero organic rankings ─────────
  const opportunities = keywordViews.filter(kv => !kv.hasOrganic)

  // ── Threats: competitors with the most top-3 positions across rankings ─────
  const top3Counts = new Map<string, { name: string; color: string; count: number; keywords: { term: string; position: number | null; isAd: boolean; sourceUrl: string | null }[] }>()
  for (const kv of keywordViews) {
    for (const r of kv.results) {
      if (r.isHustle) continue
      const key = r.name
      const entry = top3Counts.get(key) ?? { name: r.name, color: r.color, count: 0, keywords: [] }
      if (!r.isAd && r.position != null && r.position <= 3) entry.count += 1
      if (!r.isAd && r.position != null) {
        entry.keywords.push({ term: kv.keyword, position: r.position, isAd: false, sourceUrl: kv.source_url })
      } else if (r.isAd) {
        entry.keywords.push({ term: kv.keyword, position: null, isAd: true, sourceUrl: kv.source_url })
      }
      top3Counts.set(key, entry)
    }
  }
  const threats = Array.from(top3Counts.values())
    .filter(t => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map(t => ({
      ...t,
      severity: (t.count >= 3 ? 'critical' : t.count >= 2 ? 'high' : 'medium') as Severity,
    }))

  return {
    keywordViews, categories, hustleAbsentKeywords, opportunities, threats,
    meta, hustle, keywordsTracked: keywords.length,
  }
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
const COMP_STYLE: Record<Competition, { badge: string; label: string }> = {
  HIGH:   { badge: 'bg-red-950/60 text-red-400 border-red-800/50',          label: 'HIGH'   },
  MEDIUM: { badge: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/40', label: 'MED'    },
  LOW:    { badge: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40', label: 'LOW' },
}

const SEV_STYLE: Record<Severity, { border: string; labelClass: string; label: string }> = {
  critical: { border: 'border-red-800/50',    labelClass: 'text-red-400',    label: '🚨 CRITICAL' },
  high:     { border: 'border-orange-800/40', labelClass: 'text-orange-400', label: '⚠️ HIGH'     },
  medium:   { border: 'border-yellow-800/40', labelClass: 'text-yellow-400', label: '📊 MEDIUM'   },
}

const POS_STYLE: Record<HustlePos, { badge: string; dot: string }> = {
  'Ranking':  { badge: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50', dot: 'bg-emerald-500' },
  'Ad only':  { badge: 'bg-blue-950/60 text-blue-400 border-blue-800/50',          dot: 'bg-blue-500'    },
  'Absent':   { badge: 'bg-slate-800 text-slate-500 border-slate-700',             dot: 'bg-slate-600'   },
}

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

function RankBadge({ position, isAd }: { position: number | null; isAd?: boolean }) {
  if (isAd) return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-800/40 text-blue-400">AD</span>
  if (position == null) return <span className="text-slate-700 text-xs">—</span>
  const c = position <= 3 ? 'text-yellow-400' : position <= 5 ? 'text-white' : 'text-slate-400'
  return <span className={`font-mono font-bold text-xs ${c}`}>#{position}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
export default async function SearchIntelligencePage() {
  const {
    keywordViews, categories, hustleAbsentKeywords, opportunities, threats,
    meta, hustle, keywordsTracked,
  } = await getData()

  if (keywordsTracked === 0) {
    return (
      <AppLayout>
        <div className="min-h-screen bg-slate-950 text-white p-6 flex items-center justify-center">
          <div className="text-center space-y-3 max-w-md">
            <p className="text-white font-bold text-lg">No SEO snapshot data yet</p>
            <p className="text-slate-500 text-sm">
              Apply <code className="text-slate-300">supabase/migrations/009_seed_seo_snapshot.sql</code> to
              seed the SEO keyword/ranking tables, then refresh this page.
            </p>
          </div>
        </div>
      </AppLayout>
    )
  }

  const now = Date.now()
  const nextReviewAt = meta?.next_review_at ? new Date(meta.next_review_at) : null
  const daysUntilReview = nextReviewAt ? Math.ceil((nextReviewAt.getTime() - now) / 86_400_000) : null
  const reviewOverdue = daysUntilReview !== null && daysUntilReview < 0
  const reviewSoon = daysUntilReview !== null && daysUntilReview >= 0 && daysUntilReview <= 7

  const verifiedDateLabel = meta?.verified_at
    ? new Date(meta.verified_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'unknown date'
  const nextReviewLabel = meta?.next_review_at
    ? new Date(meta.next_review_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : 'not scheduled'

  const highOpportunities = opportunities.length
  const strongestCompetitor = threats[0]?.name ?? '—'

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Search Intelligence</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Rankings verified via live Google Search (Singapore, personalisation off) · Click any keyword to view source
            </p>
          </div>
          <DataSourceBadge
            kind="static"
            asOf={meta?.verified_at}
            detail={`Manually verified by ${meta?.verified_by ?? 'team'}`}
          />
        </div>

        {/* ── Honesty Banner ── */}
        <div className={`rounded-xl border p-4 flex items-start gap-3 ${
          reviewOverdue ? 'border-red-800/60 bg-red-950/20' : reviewSoon ? 'border-amber-800/60 bg-amber-950/20' : 'border-orange-800/50 bg-orange-950/10'
        }`}>
          <span className="text-xl shrink-0">📌</span>
          <div className="flex-1">
            <p className={`text-sm font-bold ${reviewOverdue ? 'text-red-300' : reviewSoon ? 'text-amber-300' : 'text-orange-300'}`}>
              MANUAL SEO SNAPSHOT — Automated rank tracking not yet connected
            </p>
            <p className="text-xs text-slate-400 mt-1">
              Last manually verified {verifiedDateLabel} by {meta?.verified_by ?? 'team'} · Method: {meta?.method ?? 'Manual Google Search'}
            </p>
            <p className={`text-xs mt-0.5 font-semibold ${reviewOverdue ? 'text-red-400' : reviewSoon ? 'text-amber-400' : 'text-slate-500'}`}>
              {reviewOverdue
                ? `Next review was due ${nextReviewLabel} — OVERDUE, please re-verify`
                : `Next review due ${nextReviewLabel}${reviewSoon ? ' — due soon' : ''}`}
            </p>
          </div>
        </div>

        {/* ── Critical Alert ── */}
        {hustleAbsentKeywords.length > 0 && (
          <div className="rounded-xl border border-red-800/60 bg-red-950/20 p-4 flex items-start gap-3">
            <span className="text-xl shrink-0">🚨</span>
            <div>
              <p className="text-sm font-bold text-red-300">
                {hustle?.name ?? 'Hustle SG'} has zero top-10 organic rankings across {hustleAbsentKeywords.length} of {keywordsTracked} verified keywords
              </p>
              <p className="text-xs text-red-400/80 mt-0.5">
                This means search traffic for these terms currently relies on paid ads and brand awareness. SEO investment is a business-critical priority.
              </p>
            </div>
          </div>
        )}

        {/* ── KPIs ── */}
        <div className="grid grid-cols-4 gap-4">
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase mb-2">Keywords Verified</p>
            <p className="text-3xl font-black text-white">{keywordsTracked}</p>
            <p className="text-xs text-slate-500 mt-1">via live Google Search</p>
          </Section>
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-red-400 uppercase mb-2">Hustle Not Ranking</p>
            <p className="text-3xl font-black text-red-400">{hustleAbsentKeywords.length}/{keywordsTracked}</p>
            <p className="text-xs text-slate-500 mt-1">keywords with zero Hustle presence</p>
          </Section>
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase mb-2">Strongest Competitor</p>
            <p className="text-lg font-black text-yellow-400 mt-1 truncate">{strongestCompetitor}</p>
            <p className="text-xs text-slate-500 mt-1">most top-3 organic spots among tracked</p>
          </Section>
          <Section className="border-emerald-800/40 bg-emerald-950/10">
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mb-2">Uncontested Gaps</p>
            <p className="text-3xl font-black text-emerald-400">{highOpportunities}</p>
            <p className="text-xs text-slate-500 mt-1">keywords with zero organic occupant</p>
          </Section>
        </div>

        {/* ── Section 1: Category Leaders (derived) ── */}
        <Section>
          <H2 sub="Top-ranked private training provider per category — derived from seo_rankings">Category Leaders</H2>
          <div className="grid grid-cols-4 gap-3">
            {categories.map(cat => {
              const cs = COMP_STYLE[cat.competition]
              const ps = POS_STYLE[cat.hustleStatus]
              return (
                <div key={cat.name} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50">
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-sm font-bold text-white">{cat.name}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${cs.badge}`}>{cs.label}</span>
                  </div>
                  <div className="mb-2">
                    <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Top Ranked Provider</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.topColor }} />
                      <span className="text-xs font-semibold text-white">{cat.topPrivateProvider}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed mb-2">{cat.keywordCount} keyword{cat.keywordCount === 1 ? '' : 's'} tracked</p>
                  <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                    <span className="text-[9px] text-slate-500">Hustle</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${ps.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ps.dot}`} />
                      {cat.hustleStatus}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Section 2: Verified Keyword Rankings ── */}
        <Section>
          <H2 sub="Manually verified Google Search rankings — click any keyword to open the source search result">Verified Keyword Rankings</H2>
          <div className="space-y-0 divide-y divide-slate-800/60">
            {keywordViews.map((kw) => (
              <div key={kw.id} className="py-3 grid grid-cols-[1fr_2fr] gap-4 items-start">
                <div>
                  {kw.source_url ? (
                    <a
                      href={kw.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400"
                    >
                      {kw.keyword}
                    </a>
                  ) : (
                    <span className="text-sm font-semibold text-white">{kw.keyword}</span>
                  )}
                  <span className="ml-2 text-[10px] text-slate-500">{kw.category ?? 'Uncategorised'}</span>
                  {kw.notes && <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{kw.notes}</p>}
                </div>

                <div className="flex flex-col gap-1.5">
                  {kw.results.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
                      <span className="text-[11px] text-slate-500 italic">No tracked competitors in top 10</span>
                    </div>
                  ) : (
                    kw.results.map((r, i) => (
                      <div key={i} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border ${r.isAd ? 'bg-blue-950/10 border-blue-800/30' : r.isHustle ? 'bg-indigo-950/20 border-indigo-800/30' : 'bg-slate-800/40 border-slate-700/50'}`}>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`text-xs font-semibold flex-1 ${r.isHustle ? 'text-indigo-300' : 'text-white'}`}>{r.name}</span>
                        <RankBadge position={r.position} isAd={r.isAd} />
                      </div>
                    ))
                  )}
                  {!kw.hustlePresent && (
                    <div className="flex items-center gap-2 px-3 py-1 rounded bg-slate-800/30 border border-slate-700/30">
                      <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                      <span className="text-[10px] text-slate-600 italic">{hustle?.name ?? 'Hustle SG'} — not ranking</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 3: Opportunities + Threats ── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Opportunities */}
          <Section className="border-emerald-800/40 bg-emerald-950/5">
            <H2 sub="Keywords with zero organic occupant — verified via Google Search">
              🟢 Uncontested Opportunities
            </H2>
            <div className="space-y-2">
              {opportunities.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No uncontested keywords in the current snapshot.</p>
              ) : (
                opportunities.map((opp) => (
                  <div key={opp.id} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:border-emerald-800/40 transition-colors">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      {opp.source_url ? (
                        <a
                          href={opp.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-semibold text-white hover:text-emerald-400 transition-colors underline decoration-slate-700 hover:decoration-emerald-400"
                        >
                          {opp.keyword}
                        </a>
                      ) : (
                        <span className="text-sm font-semibold text-white">{opp.keyword}</span>
                      )}
                      <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border bg-emerald-950/60 text-emerald-400 border-emerald-800/50">
                        UNCONTESTED
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-500 mb-1">{opp.category ?? 'Uncategorised'}</p>
                    {opp.notes && <p className="text-[11px] text-slate-400 leading-relaxed">{opp.notes}</p>}
                  </div>
                ))
              )}
            </div>
          </Section>

          {/* Threats */}
          <Section>
            <H2 sub="Competitors with the most verified top-3 organic positions">
              🚨 Verified Search Threats
            </H2>
            <div className="space-y-3">
              {threats.length === 0 ? (
                <p className="text-xs text-slate-500 italic">No competitor holds multiple top-3 positions in the current snapshot.</p>
              ) : (
                threats.map((threat) => {
                  const ss = SEV_STYLE[threat.severity]
                  return (
                    <div key={threat.name} className={`p-3 rounded-lg bg-slate-800/40 border ${ss.border}`}>
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: threat.color }} />
                        <span className="text-sm font-bold text-white">{threat.name}</span>
                        <span className={`text-[9px] font-bold ml-auto ${ss.labelClass}`}>{ss.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {threat.keywords.map((kw, i) => (
                          kw.sourceUrl ? (
                            <a
                              key={`${kw.term}-${i}`}
                              href={kw.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 hover:border-slate-500 transition-colors"
                            >
                              <span className="text-[10px] text-slate-300">{kw.term}</span>
                              {kw.isAd
                                ? <span className="text-[9px] text-blue-400 font-bold">AD</span>
                                : kw.position != null && <span className={`font-mono text-[10px] font-bold ${kw.position <= 3 ? 'text-yellow-400' : 'text-slate-400'}`}>#{kw.position}</span>}
                            </a>
                          ) : (
                            <span key={`${kw.term}-${i}`} className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/50">
                              <span className="text-[10px] text-slate-300">{kw.term}</span>
                            </span>
                          )
                        ))}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-relaxed">
                        {threat.name} holds {threat.count} top-3 organic position{threat.count === 1 ? '' : 's'} among tracked keywords.
                      </p>
                    </div>
                  )
                })
              )}
            </div>
          </Section>
        </div>

        {/* ── Footer ── */}
        <div className="text-[10px] text-slate-700 flex flex-wrap gap-4 pb-2">
          <span>All rankings verified via Google Search (gl=sg, pws=0, hl=en) · last snapshot {verifiedDateLabel}</span>
          <span>·</span>
          <span>Organic positions only — paid ads noted separately</span>
          <span>·</span>
          <span>Click any keyword to open the source Google Search</span>
        </div>

      </div>
    </AppLayout>
  )
}
