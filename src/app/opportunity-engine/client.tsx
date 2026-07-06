'use client'

import { useState, useEffect, useMemo } from 'react'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { DataSourceBadge } from '@/components/dashboard/data-source-badge'
import { formatRelativeTime, formatDate, getSeverityBgClass, cn } from '@/lib/utils'
import { Zap, RefreshCw, Loader2, ChevronDown, Target, Flag, Users2, Clock } from 'lucide-react'
import type { AlertSeverity } from '@/lib/types'

type InsightType =
  | 'threat'
  | 'opportunity'
  | 'defensive_action'
  | 'course_launch_idea'
  | 'seo_opportunity'
  | 'marketing_opportunity'
  | 'hiring_signal'
  | 'market_shift'
  // legacy values retained for backward compatibility with older rows
  | 'recommendation'
  | 'market_position'
  | 'growth_analysis'
  | 'social_insight'
  | 'hiring_intel'
  | 'course_intel'

type Confidence = 'low' | 'medium' | 'high'

interface Insight {
  id: string
  insight_type: InsightType
  title: string
  body: string
  severity: AlertSeverity
  confidence: Confidence | null
  evidence: string[] | null
  recommended_action: string | null
  suggested_owner: string | null
  timeframe: string | null
  related_categories: string[] | null
  data_sources: string[] | null
  competitor_ids: string[] | null
  generated_by: string
  model_version: string | null
  created_at: string
  expires_at: string | null
  opportunity_score: number | null
}

interface ScoreFactor {
  raw: number | string
  normalized: number
  weight: number
}

interface OpportunityBreakdown {
  demand: Record<string, ScoreFactor>
  competition_gap: Record<string, ScoreFactor>
  hustle_fit: Record<string, ScoreFactor>
  urgency: Record<string, ScoreFactor>
}

interface OpportunityScoreRow {
  id: string
  category: string
  title: string
  demand_score: number
  competition_gap_score: number
  hustle_fit_score: number
  urgency_score: number
  total_score: number
  breakdown: OpportunityBreakdown | null
  evidence: string[] | null
  computed_at: string
  is_current: boolean
}

const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  threat: 'Threat',
  opportunity: 'Opportunity',
  defensive_action: 'Defensive Action',
  course_launch_idea: 'Course Launch Idea',
  seo_opportunity: 'SEO Opportunity',
  marketing_opportunity: 'Marketing Opportunity',
  hiring_signal: 'Hiring Signal',
  market_shift: 'Market Shift',
  recommendation: 'Recommendation',
  market_position: 'Market Position',
  growth_analysis: 'Growth Analysis',
  social_insight: 'Social Intelligence',
  hiring_intel: 'Hiring Intelligence',
  course_intel: 'Course Intelligence',
}

const INSIGHT_TYPE_COLORS: Record<InsightType, string> = {
  threat: 'bg-red-500/10 text-red-400 border-red-500/20',
  opportunity: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  defensive_action: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  course_launch_idea: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  seo_opportunity: 'bg-lime-500/10 text-lime-400 border-lime-500/20',
  marketing_opportunity: 'bg-fuchsia-500/10 text-fuchsia-400 border-fuchsia-500/20',
  hiring_signal: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  market_shift: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  recommendation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  market_position: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  growth_analysis: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  social_insight: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  hiring_intel: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  course_intel: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
}

const CONFIDENCE_COLORS: Record<Confidence, string> = {
  low: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
  medium: 'bg-sky-500/10 text-sky-400 border-sky-500/20',
  high: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

const FILTERS: Array<{ value: InsightType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'threat', label: 'Threats' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'defensive_action', label: 'Defensive Action' },
  { value: 'course_launch_idea', label: 'Course Launch Ideas' },
  { value: 'seo_opportunity', label: 'SEO Opportunities' },
  { value: 'marketing_opportunity', label: 'Marketing Opportunities' },
  { value: 'hiring_signal', label: 'Hiring Signals' },
  { value: 'market_shift', label: 'Market Shifts' },
]

function groupByDay(insights: Insight[]): Array<{ label: string; items: Insight[] }> {
  const groups = new Map<string, Insight[]>()
  const todayStr = new Date().toDateString()
  const yesterdayStr = new Date(Date.now() - 24 * 60 * 60 * 1000).toDateString()

  for (const insight of insights) {
    const d = new Date(insight.created_at)
    const dayStr = d.toDateString()
    let label: string
    if (dayStr === todayStr) label = 'Today'
    else if (dayStr === yesterdayStr) label = 'Yesterday'
    else label = formatDate(insight.created_at)

    const existing = groups.get(label) ?? []
    existing.push(insight)
    groups.set(label, existing)
  }

  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }))
}

function ScoreBar({ label, value, colorClass }: { label: string; value: number; colorClass: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[10px] text-slate-500 mb-1">
        <span>{label}</span>
        <span className="text-slate-400 font-medium">{value.toFixed(1)}</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className={cn('h-full rounded-full', colorClass)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  )
}

function BreakdownSection({ title, factors }: { title: string; factors: Record<string, ScoreFactor> }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">{title}</p>
      <ul className="space-y-1">
        {Object.entries(factors).map(([key, f]) => (
          <li key={key} className="text-[11px] text-slate-400 flex items-center justify-between gap-2">
            <span className="capitalize">{key.replace(/_/g, ' ')}</span>
            <span className="text-slate-500 shrink-0">
              {typeof f.raw === 'number' ? f.raw.toLocaleString() : f.raw} &rarr; {f.normalized.toFixed(1)} (w={f.weight})
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function OpportunityScoreCard({ score }: { score: OpportunityScoreRow }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-white leading-snug">{score.category}</h3>
        <div className="text-right shrink-0">
          <div className="text-2xl font-bold text-indigo-400 leading-none">{score.total_score.toFixed(1)}</div>
          <div className="text-[9px] text-slate-600 uppercase tracking-wider">Total Score</div>
        </div>
      </div>

      <div className="space-y-2">
        <ScoreBar label="Demand" value={score.demand_score} colorClass="bg-emerald-500" />
        <ScoreBar label="Competition Gap" value={score.competition_gap_score} colorClass="bg-sky-500" />
        <ScoreBar label="Hustle Fit" value={score.hustle_fit_score} colorClass="bg-violet-500" />
        <ScoreBar label="Urgency" value={score.urgency_score} colorClass="bg-amber-500" />
      </div>

      <button
        onClick={() => setExpanded((e) => !e)}
        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-300 transition-colors pt-1 border-t border-slate-800/60"
      >
        <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} />
        Why this score?
      </button>

      {expanded && (
        <div className="space-y-3 pt-1">
          {score.breakdown && (
            <div className="space-y-2">
              <BreakdownSection title="Demand" factors={score.breakdown.demand} />
              <BreakdownSection title="Competition Gap" factors={score.breakdown.competition_gap} />
              <BreakdownSection title="Hustle Fit" factors={score.breakdown.hustle_fit} />
              <BreakdownSection title="Urgency" factors={score.breakdown.urgency} />
            </div>
          )}
          {score.evidence && score.evidence.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1">Evidence</p>
              <ul className="space-y-1 list-disc list-inside">
                {score.evidence.map((e, i) => (
                  <li key={i} className="text-[11px] text-slate-400">{e}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function OpportunityEngineClient() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [scores, setScores] = useState<OpportunityScoreRow[]>([])
  const [loading, setLoading] = useState(true)
  const [scoresLoading, setScoresLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<InsightType | 'all'>('all')

  useEffect(() => {
    void fetchInsights()
    void fetchScores()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchInsights() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/insights?limit=30')
      const data = await res.json()
      setInsights(data.data ?? [])
    } catch {
      setError('Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  async function fetchScores() {
    setScoresLoading(true)
    try {
      const res = await fetch('/api/opportunities')
      const data = await res.json()
      setScores(data.data ?? [])
    } catch {
      // non-fatal — insights section still works without scores
    } finally {
      setScoresLoading(false)
    }
  }

  async function regenerateInsights() {
    setRegenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/insights', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to regenerate insights')
      } else {
        await fetchInsights()
        await fetchScores()
      }
    } catch {
      setError('Failed to regenerate insights')
    } finally {
      setRegenerating(false)
    }
  }

  const filtered = activeFilter === 'all' ? insights : insights.filter((i) => i.insight_type === activeFilter)
  const grouped = useMemo(() => groupByDay(filtered), [filtered])

  const latestInsightCreatedAt = insights[0]?.created_at ?? null

  return (
    <div>
      {/* Opportunity Scores section */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-white">Opportunity Scores</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Rule-based demand / competition-gap / fit / urgency scoring per course category
            </p>
          </div>
          <DataSourceBadge kind="cached" asOf={scores[0]?.computed_at} detail="Computed by the opportunity scoring engine" />
        </div>

        {scoresLoading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
          </div>
        ) : scores.length === 0 ? (
          <DataUnavailable label="Run the AI cron or click Regenerate below to compute opportunity scores" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {scores.map((score) => (
              <OpportunityScoreCard key={score.id} score={score} />
            ))}
          </div>
        )}
      </div>

      {/* Insights section */}
      <div className="flex items-start justify-between gap-4 mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-sm font-semibold text-white">Strategic Insights</h2>
            <DataSourceBadge kind="ai" asOf={latestInsightCreatedAt} detail="Generated by Claude from live competitive data" />
          </div>
          <p className="text-slate-400 text-sm">
            AI-generated strategic insights based on live competitive data. Updated daily via cron at 10am SGT.
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Insights persist for 7 days &middot; Only references verified live data
          </p>
        </div>
        <button
          onClick={regenerateInsights}
          disabled={regenerating}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm rounded-lg font-medium transition-colors shrink-0"
        >
          {regenerating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          {regenerating ? 'Generating...' : 'Regenerate Insights'}
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex flex-wrap gap-2 mb-6">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setActiveFilter(f.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
              activeFilter === f.value
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
            )}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className="ml-1.5 text-slate-500">
                ({insights.filter((i) => i.insight_type === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Zap className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">No insights yet</p>
          <p className="text-xs text-slate-600 mt-1">
            Click &quot;Regenerate Insights&quot; to generate AI insights from current data
          </p>
          {insights.length === 0 && !loading && (
            <div className="mt-4">
              <DataUnavailable label="Run the AI cron or click Regenerate above" />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-8">
          {grouped.map((group) => (
            <div key={group.label}>
              <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                {group.label}
              </h3>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {group.items.map((insight) => (
                  <div
                    key={insight.id}
                    className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col gap-3"
                  >
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
                            INSIGHT_TYPE_COLORS[insight.insight_type] ?? 'bg-slate-800 text-slate-400 border-slate-700'
                          )}
                        >
                          {INSIGHT_TYPE_LABELS[insight.insight_type] ?? insight.insight_type}
                        </span>
                        <span
                          className={cn(
                            'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
                            getSeverityBgClass(insight.severity)
                          )}
                        >
                          {insight.severity}
                        </span>
                        {insight.confidence && (
                          <span
                            className={cn(
                              'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
                              CONFIDENCE_COLORS[insight.confidence]
                            )}
                            title="Confidence in this insight's data quality"
                          >
                            {insight.confidence} confidence
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-600 shrink-0">
                        {formatRelativeTime(insight.created_at)}
                      </span>
                    </div>

                    {/* Title */}
                    <h3 className="text-sm font-semibold text-white leading-snug">
                      {insight.title}
                    </h3>

                    {/* Body */}
                    <p className="text-xs text-slate-400 leading-relaxed">
                      {insight.body}
                    </p>

                    {/* Evidence */}
                    {insight.evidence && insight.evidence.length > 0 && (
                      <ul className="space-y-1 list-disc list-inside">
                        {insight.evidence.map((e, i) => (
                          <li key={i} className="text-[11px] text-slate-500">{e}</li>
                        ))}
                      </ul>
                    )}

                    {/* Recommended action */}
                    {insight.recommended_action && (
                      <div className="flex items-start gap-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg p-2.5">
                        <Target className="h-3.5 w-3.5 text-indigo-400 shrink-0 mt-0.5" />
                        <p className="text-[11px] text-indigo-200 leading-relaxed">
                          {insight.recommended_action}
                        </p>
                      </div>
                    )}

                    {/* Chips: owner, timeframe */}
                    {(insight.suggested_owner || insight.timeframe) && (
                      <div className="flex flex-wrap items-center gap-2">
                        {insight.suggested_owner && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                            <Users2 className="h-3 w-3" />
                            {insight.suggested_owner}
                          </span>
                        )}
                        {insight.timeframe && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                            <Clock className="h-3 w-3" />
                            {insight.timeframe}
                          </span>
                        )}
                        {insight.opportunity_score !== null && insight.opportunity_score !== undefined && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                            <Flag className="h-3 w-3" />
                            Opportunity score {insight.opportunity_score.toFixed(1)}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Related categories */}
                    {insight.related_categories && insight.related_categories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {insight.related_categories.map((cat) => (
                          <span
                            key={cat}
                            className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-slate-800/60 text-slate-400 border border-slate-700/60"
                          >
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Footer */}
                    <div className="flex items-center justify-between pt-2 border-t border-slate-800/60">
                      <div className="flex items-center gap-1.5">
                        <Zap className="h-3 w-3 text-indigo-400" />
                        <span className="text-[10px] text-slate-600">
                          {insight.model_version ?? 'claude'}
                        </span>
                      </div>
                      {insight.expires_at && (
                        <span className="text-[10px] text-slate-600">
                          Expires {formatRelativeTime(insight.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
