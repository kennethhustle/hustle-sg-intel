'use client'

import { useState, useEffect, useCallback } from 'react'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Zap, RefreshCw, Loader2, History, Search, Clock, Trash2 } from 'lucide-react'
import type { InsightType, AlertSeverity, GenerationSession, InsightMetadata } from '@/lib/types'

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

const SOURCE_LABELS: Record<string, string> = {
  cron: 'Scheduled',
  manual: 'Manual',
  legacy: 'Legacy',
}

// Single source of truth for the Opportunity Engine insight-type taxonomy.
// Shared by both the Latest filter tabs and the History type dropdown so the
// two views always expose identical categories. Platform modules
// (social_insight / hiring_intel / course_intel) are intentionally excluded.
const INSIGHT_FILTERS: Array<{ value: InsightType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'threat', label: 'Threats' },
  { value: 'opportunity', label: 'Opportunities' },
  { value: 'recommendation', label: 'Recommendations' },
  { value: 'market_position', label: 'Market Position' },
  { value: 'growth_analysis', label: 'Growth Analysis' },
]

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

// ── Presentation-only executive-summary transform ───────────────────────────
// Restructures the AI's existing `body` prose into a scannable hierarchy at
// RENDER time. It does NOT change generation, categories, the model, the prompt
// or any stored data — it only splits the same text into a summary + bullets so
// insights can be read in seconds. Degrades gracefully (short bodies just show
// a summary).
const ACTION_RE = /\b(recommend|should|must|need to|launch|increase|prioriti[sz]e|invest|focus on|expand|consider|target|leverage|develop|build|create|adopt|reduce|improve|accelerate|double down|capitali[sz]e|explore|implement|establish|strengthen|maintain|monitor)\b/i
const IMPACT_RE = /\b(risk|threat|impact|revenue|market share|growth|churn|loss|losing|advantage|competitive position|could result|may lead|erod|gain|lose|outpace|fall behind|widen|narrow|exposure|upside|downside)\b/i

function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-Z0-9])/)
    .map((s) => s.trim())
    .filter(Boolean)
}

interface StructuredInsight {
  summary: string
  findings: string[]
  impact: string | null
  actions: string[]
}

function structureInsight(body: string): StructuredInsight {
  const sentences = splitSentences(body ?? '')
  if (sentences.length === 0) {
    return { summary: (body ?? '').trim(), findings: [], impact: null, actions: [] }
  }
  const summary = sentences[0]
  const rest = sentences.slice(1)

  const actions = rest.filter((s) => ACTION_RE.test(s))
  const nonAction = rest.filter((s) => !ACTION_RE.test(s))
  const impactSentences = nonAction.filter((s) => IMPACT_RE.test(s))
  const findings = nonAction.filter((s) => !IMPACT_RE.test(s))

  return {
    summary,
    findings,
    impact: impactSentences.length > 0 ? impactSentences.join(' ') : null,
    actions,
  }
}

const PRIORITY_STYLES: Record<'High' | 'Medium' | 'Low', string> = {
  High: 'bg-red-500/10 text-red-400 border-red-500/20',
  Medium: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  Low: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
}

function priorityFromSeverity(severity: AlertSeverity): 'High' | 'Medium' | 'Low' {
  if (severity === 'critical' || severity === 'high') return 'High'
  if (severity === 'medium') return 'Medium'
  return 'Low'
}

function InsightCard({ insight }: { insight: Insight }) {
  const structured = structureInsight(insight.body)
  const priority = priorityFromSeverity(insight.severity)
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 flex flex-col gap-3">
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

      {/* Executive summary (presentation-only restructure of insight.body) */}
      <div className="flex flex-col gap-3 flex-1">
        {structured.summary && (
          <p className="text-xs text-slate-300 leading-relaxed">{structured.summary}</p>
        )}

        {structured.findings.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Key Findings
            </div>
            <ul className="space-y-1">
              {structured.findings.map((f, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-400 leading-relaxed">
                  <span className="text-indigo-400 mt-px shrink-0">&bull;</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {structured.impact && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Business Impact
            </div>
            <p className="text-xs text-slate-400 leading-relaxed">{structured.impact}</p>
          </div>
        )}

        {structured.actions.length > 0 && (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 mb-1">
              Recommended Action
            </div>
            <ul className="space-y-1">
              {structured.actions.map((a, i) => (
                <li key={i} className="flex gap-2 text-xs text-slate-300 leading-relaxed">
                  <span className="text-emerald-400 mt-px shrink-0">&rsaquo;</span>
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Priority
          </span>
          <span
            className={cn(
              'inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border',
              PRIORITY_STYLES[priority]
            )}
          >
            {priority}
          </span>
        </div>
      </div>

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

export function OpportunityEngineClient() {
  const [view, setView] = useState<'latest' | 'history'>('latest')

  // Latest generation
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeFilter, setActiveFilter] = useState<InsightType | 'all'>('all')

  // History
  const [sessions, setSessions] = useState<GenerationSession[]>([])
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sessionInsights, setSessionInsights] = useState<Insight[]>([])
  const [sessionInsightsLoading, setSessionInsightsLoading] = useState(false)
  const [deletingSession, setDeletingSession] = useState<string | null>(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [historyType, setHistoryType] = useState<InsightType | 'all'>('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    void fetchInsights()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function fetchInsights() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/insights?scope=latest')
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
      const res = await fetch('/api/insights/sessions')
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
  }, [selectedSession])

  async function selectSession(sessionId: string) {
    setSelectedSession(sessionId)
    setSessionInsightsLoading(true)
    try {
      const res = await fetch(`/api/insights?session=${encodeURIComponent(sessionId)}`)
      const data = await res.json()
      setSessionInsights(data.data ?? [])
    } catch {
      setSessionInsights([])
    } finally {
      setSessionInsightsLoading(false)
    }
  }

  async function deleteSession(session: GenerationSession) {
    if (
      !window.confirm(
        `Delete this generation from ${formatTimestamp(session.generated_at)} and all ${session.insight_count} insights? This cannot be undone.`
      )
    ) {
      return
    }
    setDeletingSession(session.session_id)
    setError(null)
    try {
      const res = await fetch(
        `/api/insights?session=${encodeURIComponent(session.session_id)}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Failed to delete history')
        return
      }
      // Refresh the list immediately, then fix up the selection.
      const remaining = sessions.filter((s) => s.session_id !== session.session_id)
      setSessions(remaining)
      if (selectedSession === session.session_id) {
        if (remaining.length > 0) {
          void selectSession(remaining[0].session_id)
        } else {
          setSelectedSession(null)
          setSessionInsights([])
        }
      }
    } catch {
      setError('Failed to delete history')
    } finally {
      setDeletingSession(null)
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
      const res = await fetch('/api/insights', { method: 'POST' })
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

  const filters = INSIGHT_FILTERS

  const filtered = activeFilter === 'all'
    ? insights
    : insights.filter((i) => i.insight_type === activeFilter)

  const latestMeta = insights[0]?.metadata ?? null

  const visibleSessions = sessions.filter((s) => {
    const day = s.generated_at.slice(0, 10)
    if (dateFrom && day < dateFrom) return false
    if (dateTo && day > dateTo) return false
    return true
  })

  const searchLower = search.trim().toLowerCase()
  const filteredSessionInsights = sessionInsights.filter((i) => {
    if (historyType !== 'all' && i.insight_type !== historyType) return false
    if (searchLower && !`${i.title} ${i.body}`.toLowerCase().includes(searchLower)) return false
    return true
  })

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <p className="text-slate-400 text-sm">
            AI-generated strategic insights based on live competitive data. Updated daily via cron at 10am SGT.
          </p>
          <p className="text-xs text-slate-600 mt-1">
            Powered by Google Gemini 2.5 Flash &middot; Only references verified live data
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
                  <div key={s.session_id} className="relative">
                    <button
                      onClick={() => selectSession(s.session_id)}
                      className={cn(
                        'w-full text-left rounded-xl border p-3 pr-9 transition-colors',
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
                    <button
                      onClick={(e) => { e.stopPropagation(); void deleteSession(s) }}
                      disabled={deletingSession === s.session_id}
                      title="Delete this generation"
                      aria-label="Delete this generation"
                      className="absolute bottom-2 right-2 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {deletingSession === s.session_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                  </div>
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
                onChange={(e) => setHistoryType(e.target.value as InsightType | 'all')}
                className="bg-slate-800/60 border border-slate-700/60 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500/50"
              >
                <option value="all">All types</option>
                {INSIGHT_FILTERS.filter((f) => f.value !== 'all').map((f) => (
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
