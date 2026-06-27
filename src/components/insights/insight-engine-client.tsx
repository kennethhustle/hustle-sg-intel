'use client'

import { useState, useEffect, useCallback } from 'react'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Zap, RefreshCw, Loader2, History, Search, Clock } from 'lucide-react'
import type { InsightType, AlertSeverity, GenerationSession, InsightMetadata, InsightModule, SeoCategory } from '@/lib/types'

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
  metadata?: InsightMetadata | null
}

type FilterValue = InsightType | SeoCategory | 'all'
type FilterOption = { value: FilterValue; label: string }

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

// SEO presentation labels/colors keyed by metadata.seo_category — UI only; the
// underlying DB insight_type stays one of the allowed base values.
const SEO_CATEGORY_LABELS: Record<SeoCategory, string> = {
  keyword_opportunity: 'Keyword Opportunity',
  seo_threat: 'SEO Threat',
  content_opportunity: 'Content Opportunity',
  competitor_search_position: 'Competitor Position',
  recommended_landing_page: 'Landing Page',
  high_demand_topic: 'High-demand Topic',
  missing_content_category: 'Missing Content',
  search_growth: 'Search Growth',
}

const SEO_CATEGORY_COLORS: Record<SeoCategory, string> = {
  keyword_opportunity: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  seo_threat: 'bg-red-500/10 text-red-400 border-red-500/20',
  content_opportunity: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  competitor_search_position: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
  recommended_landing_page: 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20',
  high_demand_topic: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  missing_content_category: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  search_growth: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20',
}

const SOURCE_LABELS: Record<string, string> = {
  cron: 'Scheduled',
  manual: 'Manual',
  legacy: 'Legacy',
}

const STRATEGIC_FILTERS: FilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'threat', label: 'Threats' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'recommendation', label: 'Recommendations' },
  { value: 'market_position', label: 'Market Position' },
  { value: 'growth_analysis', label: 'Growth Analysis' },
]

const SEO_FILTERS: FilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'keyword_opportunity', label: 'Keyword Opportunities' },
  { value: 'seo_threat', label: 'SEO Threats' },
  { value: 'content_opportunity', label: 'Content Opportunities' },
  { value: 'competitor_search_position', label: 'Competitor Position' },
  { value: 'recommended_landing_page', label: 'Landing Pages' },
  { value: 'high_demand_topic', label: 'High-demand Topics' },
  { value: 'missing_content_category', label: 'Missing Content' },
  { value: 'search_growth', label: 'Search Growth' },
]

const MODULE_CONFIG: Record<InsightModule, { filters: FilterOption[]; subtitle: string; subNote: string }> = {
  strategic: {
    filters: STRATEGIC_FILTERS,
    subtitle: 'AI-generated strategic insights based on live competitive data. Updated daily via cron at 10am SGT.',
    subNote: 'Powered by Google Gemini 2.5 Flash · Only references verified live data',
  },
  seo: {
    filters: SEO_FILTERS,
    subtitle: 'AI-generated SEO & content intelligence from live internal data — courses, MySkillsFuture demand, hiring and audience reach. Updated daily.',
    subNote: 'Powered by Google Gemini 2.5 Flash · Evidence-based from internal data only — no external SEO API',
  },
}

function formatDuration(ms: number | null): string {
  if (ms === null || ms === undefined) return '—'
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-SG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function InsightCard({ insight }: { insight: Insight }) {
  // SEO insights store a base insight_type for the DB but carry their real
  // category in metadata.seo_category — prefer that for the badge.
  const seoCategory = insight.metadata?.seo_category
  const badgeLabel = seoCategory
    ? SEO_CATEGORY_LABELS[seoCategory]
    : INSIGHT_TYPE_LABELS[insight.insight_type] ?? insight.insight_type
  const badgeColor = seoCategory
    ? SEO_CATEGORY_COLORS[seoCategory]
    : INSIGHT_TYPE_COLORS[insight.insight_type] ?? 'bg-slate-800 text-slate-400 border-slate-700'
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
              badgeColor
            )}
          >
            {badgeLabel}
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
            {insight.model_version ?? 'gemini'}
          </span>
        </div>
        {insight.expires_at && (
          <span className="text-[10px] text-slate-600">
            Expires {formatRelativeTime(insight.expires_at)}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * Reusable AI insight surface (Latest / History / Regenerate). Scoped by the
 * `module` prop so each surface only ever reads and writes its own insights via
 * the shared /api/insights endpoints. Opportunity Engine keeps its own client;
 * this component powers the embedded "AI SEO Insights" section.
 */
export function InsightEngineClient({ module = 'seo' }: { module?: InsightModule }) {
  const config = MODULE_CONFIG[module]
  const filters = config.filters

  const [view, setView] = useState<'latest' | 'history'>('latest')

  // Latest generation
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<FilterValue>('all')

  // The field a filter compares against: SEO insights filter by their
  // metadata.seo_category, strategic insights by their insight_type.
  const keyOf = useCallback(
    (i: Insight): FilterValue | null =>
      module === 'seo' ? i.metadata?.seo_category ?? null : i.insight_type,
    [module]
  )

  // History
  const [sessions, setSessions] = useState<GenerationSession[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionInsights, setSessionInsights] = useState<Insight[]>([])
  const [sessionInsightsLoading, setSessionInsightsLoading] = useState(false)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [historyType, setHistoryType] = useState<FilterValue>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    void fetchInsights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module])

  async function fetchInsights() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/insights?scope=latest&module=${module}`)
      const data = await res.json()
      setInsights(data.data ?? [])
    } catch {
      setError('Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch(`/api/insights/sessions?module=${module}`)
      const data = await res.json()
      const list: GenerationSession[] = data.data ?? []
      setSessions(list)
      setSessionsLoaded(true)
      if (list.length > 0 && !selectedSession) {
        void selectSession(list[0].session_id)
      }
    } catch {
      setError('Failed to load history')
    } finally {
      setSessionsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSession, module])

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId)
    setSessionInsightsLoading(true)
    try {
      const res = await fetch(`/api/insights?session=${encodeURIComponent(sessionId)}&module=${module}`)
      const data = await res.json()
      setSessionInsights(data.data ?? [])
    } catch {
      setSessionInsights([])
    } finally {
      setSessionInsightsLoading(false)
    }
  }

  function openHistory() {
    setView('history')
    if (!sessionsLoaded) void fetchSessions()
  }

  async function regenerateInsights() {
    setRegenerating(true)
    setError(null)
    try {
      const res = await fetch(`/api/insights?module=${module}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to regenerate insights')
      } else {
        await fetchInsights()
        // History is now stale — refresh it on next open.
        setSessionsLoaded(false)
        setSelectedSession(null)
      }
    } catch {
      setError('Failed to regenerate insights')
    } finally {
      setRegenerating(false)
    }
  }

  const filtered = activeFilter === 'all'
    ? insights
    : insights.filter((i) => keyOf(i) === activeFilter)

  const latestMeta = insights[0]?.metadata ?? null

  const visibleSessions = sessions.filter((s) => {
    const day = s.generated_at.slice(0, 10)
    if (dateFrom && day < dateFrom) return false
    if (dateTo && day > dateTo) return false
    return true
  })

  const searchLower = search.trim().toLowerCase()
  const filteredSessionInsights = sessionInsights.filter((i) => {
    if (historyType !== 'all' && keyOf(i) !== historyType) return false
    if (searchLower && !`${i.title} ${i.body}`.toLowerCase().includes(searchLower)) return false
    return true
  })

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-slate-400 text-sm">
            {config.subtitle}
          </p>
          <p className="text-xs text-slate-600 mt-1">
            {config.subNote}
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

      {/* View tabs */}
      <div className="flex items-center gap-1 mb-6 border-b border-slate-800">
        <button
          onClick={() => setView('latest')}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            view === 'latest'
              ? 'text-indigo-300 border-indigo-400'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          )}
        >
          <Zap className="h-4 w-4" />
          Latest
        </button>
        <button
          onClick={openHistory}
          className={cn(
            'flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            view === 'history'
              ? 'text-indigo-300 border-indigo-400'
              : 'text-slate-500 border-transparent hover:text-slate-300'
          )}
        >
          <History className="h-4 w-4" />
          History
          {sessions.length > 0 && (
            <span className="ml-1 text-xs text-slate-500">({sessions.length})</span>
          )}
        </button>
      </div>

      {view === 'latest' ? (
        <>
          {/* Latest generation meta */}
          {latestMeta && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-4 text-[11px] text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Generated {formatRelativeTime(latestMeta.generated_at)}
              </span>
              <span>{latestMeta.model ?? 'gemini'}</span>
              <span>{formatDuration(latestMeta.duration_ms)}</span>
              <span>{SOURCE_LABELS[latestMeta.source] ?? latestMeta.source}</span>
              <span>{insights.length} insights</span>
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
                    ({insights.filter((i) => keyOf(i) === f.value).length})
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
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Session list */}
          <div className="lg:col-span-1">
            <div className="flex flex-col gap-2 mb-4">
              <label className="text-[11px] text-slate-500 uppercase tracking-wide">Filter by date</label>
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="date-input-accent flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
                />
                <span className="text-slate-600 text-xs">to</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="date-input-accent flex-1 bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              {(dateFrom || dateTo) && (
                <button
                  onClick={() => { setDateFrom(''); setDateTo('') }}
                  className="self-start text-[11px] text-indigo-400 hover:text-indigo-300"
                >
                  Clear dates
                </button>
              )}
            </div>

            {sessionsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : visibleSessions.length === 0 ? (
              <div className="py-12 text-center">
                <History className="h-10 w-10 mx-auto mb-3 text-slate-700" />
                <p className="text-sm text-slate-500">No generations found</p>
                <p className="text-xs text-slate-600 mt-1">
                  {sessions.length === 0 ? 'No history yet' : 'Try adjusting the date filter'}
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-2 max-h-[70vh] overflow-y-auto pr-1">
                {visibleSessions.map((s) => (
                  <button
                    key={s.session_id}
                    onClick={() => selectSession(s.session_id)}
                    className={cn(
                      'text-left rounded-xl border p-3 transition-colors',
                      selectedSession === s.session_id
                        ? 'bg-indigo-500/10 border-indigo-500/40'
                        : 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-semibold text-white">
                        {formatTimestamp(s.generated_at)}
                      </span>
                      <span
                        className={cn(
                          'px-1.5 py-0.5 rounded text-[9px] font-medium border',
                          s.source === 'cron'
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                            : s.source === 'manual'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-slate-700/40 text-slate-400 border-slate-600/40'
                        )}
                      >
                        {SOURCE_LABELS[s.source] ?? s.source}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
                      <span>{s.insight_count} insights</span>
                      <span>&middot;</span>
                      <span>{s.model ?? 'gemini'}</span>
                      <span>&middot;</span>
                      <span>{formatDuration(s.duration_ms)}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Selected session insights */}
          <div className="lg:col-span-2">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search insights..."
                  className="w-full bg-slate-800/60 border border-slate-700/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50"
                />
              </div>
              <select
                value={historyType}
                onChange={(e) => setHistoryType(e.target.value as FilterValue)}
                className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
              >
                <option value="all">All types</option>
                {filters.filter((f) => f.value !== 'all').map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
            </div>

            {!selectedSession ? (
              <div className="py-16 text-center text-slate-500">
                <p className="text-sm">Select a generation to view its insights</p>
              </div>
            ) : sessionInsightsLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
              </div>
            ) : filteredSessionInsights.length === 0 ? (
              <div className="py-16 text-center text-slate-500">
                <Zap className="h-10 w-10 mx-auto mb-3 opacity-20" />
                <p className="text-sm">No matching insights</p>
                <p className="text-xs text-slate-600 mt-1">Adjust the type filter or search</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                {filteredSessionInsights.map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
