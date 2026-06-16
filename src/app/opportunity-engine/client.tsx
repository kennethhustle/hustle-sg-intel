'use client'

import { useState, useEffect } from 'react'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Zap, RefreshCw, Loader2 } from 'lucide-react'
import type { InsightType, AlertSeverity } from '@/lib/types'

interface Insight {
  id: string
  insight_type: InsightType
  title: string
  body: string
  severity: AlertSeverity
  competitor_ids: string[] | null
  generated_by: string
  model_version: string | null
  created_at: string
  expires_at: string | null
}

const INSIGHT_TYPE_LABELS: Record<InsightType, string> = {
  threat: 'Threat',
  opportunity: 'Opportunity',
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
  recommendation: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  market_position: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  growth_analysis: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  social_insight: 'bg-pink-500/10 text-pink-400 border-pink-500/20',
  hiring_intel: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
  course_intel: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
}

export function OpportunityEngineClient() {
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<InsightType | 'all'>('all')

  useEffect(() => {
    void fetchInsights()
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
      }
    } catch {
      setError('Failed to regenerate insights')
    } finally {
      setRegenerating(false)
    }
  }

  const filters: Array<{ value: InsightType | 'all'; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'threat', label: 'Threats' },
    { value: 'opportunity', label: 'Opportunities' },
    { value: 'recommendation', label: 'Recommendations' },
    { value: 'market_position', label: 'Market Position' },
    { value: 'growth_analysis', label: 'Growth Analysis' },
  ]

  const filtered = activeFilter === 'all'
    ? insights
    : insights.filter((i) => i.insight_type === activeFilter)

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-slate-400 text-sm">
            AI-generated strategic insights based on live competitive data. Updated daily via cron at 10am SGT.
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Powered by Claude 3.5 Sonnet &middot; Only references verified live data
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
        {filters.map((f) => (
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
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {filtered.map((insight) => (
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
              <p className="text-xs text-slate-400 leading-relaxed flex-1">
                {insight.body}
              </p>

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
      )}
    </div>
  )
}
