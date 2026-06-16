'use client'

import { useState, useEffect } from 'react'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Bell, CheckCheck, Trash2, Loader2 } from 'lucide-react'
import type { AlertSeverity } from '@/lib/types'

interface AlertItem {
  id: string
  alert_type: string
  severity: AlertSeverity
  title: string
  description: string | null
  is_read: boolean
  is_dismissed: boolean
  created_at: string
  metadata: Record<string, unknown> | null
  competitors: {
    id: string
    name: string
    slug: string
    color: string
    is_hustle: boolean
  } | null
}

const SEVERITY_FILTERS: Array<{ value: AlertSeverity | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
]

export function AlertsClient() {
  const [alerts, setAlerts] = useState<AlertItem[]>([])
  const [loading, setLoading] = useState(true)
  const [severityFilter, setSeverityFilter] = useState<AlertSeverity | 'all'>('all')
  const [showReadAlerts, setShowReadAlerts] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchAlerts()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severityFilter, showReadAlerts])

  async function fetchAlerts() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ limit: '100' })
      if (!showReadAlerts) params.set('unread', 'true')
      if (severityFilter !== 'all') params.set('severity', severityFilter)
      const res = await fetch(`/api/alerts?${params}`)
      const data = await res.json()
      setAlerts(data.data ?? [])
    } catch {
      setError('Failed to load alerts')
    } finally {
      setLoading(false)
    }
  }

  async function markAsRead(id: string) {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_read: true }),
    })
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)))
  }

  async function dismissAlert(id: string) {
    await fetch('/api/alerts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_dismissed: true }),
    })
    setAlerts((prev) => prev.filter((a) => a.id !== id))
  }

  async function markAllRead() {
    setMarkingAll(true)
    const unreadIds = alerts.filter((a) => !a.is_read).map((a) => a.id)
    if (unreadIds.length > 0) {
      await fetch('/api/alerts', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: unreadIds, is_read: true }),
      })
      setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })))
    }
    setMarkingAll(false)
  }

  const unreadCount = alerts.filter((a) => !a.is_read).length

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="flex items-center gap-2">
          {SEVERITY_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setSeverityFilter(f.value)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border',
                severityFilter === f.value
                  ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30'
                  : 'bg-slate-800/60 text-slate-400 border-slate-700/60 hover:text-slate-200'
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showReadAlerts}
              onChange={(e) => setShowReadAlerts(e.target.checked)}
              className="rounded border-slate-700 bg-slate-800 text-indigo-500"
            />
            Show read alerts
          </label>

          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              disabled={markingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg border border-slate-700 transition-colors"
            >
              {markingAll ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <CheckCheck className="h-3.5 w-3.5" />
              )}
              Mark all read ({unreadCount})
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
          <Bell className="h-12 w-12 mb-3 opacity-20" />
          <p className="text-sm">No alerts</p>
          <p className="text-xs text-slate-600 mt-1">
            Alerts are generated automatically when significant changes are detected
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={cn(
                'flex gap-4 p-4 rounded-xl border transition-colors',
                alert.is_read
                  ? 'bg-slate-900/40 border-slate-800/60'
                  : 'bg-slate-900/70 border-slate-700/80'
              )}
            >
              {/* Severity stripe */}
              <div
                className={cn(
                  'w-1 rounded-full shrink-0 self-stretch',
                  alert.severity === 'critical'
                    ? 'bg-red-500'
                    : alert.severity === 'high'
                    ? 'bg-orange-500'
                    : alert.severity === 'medium'
                    ? 'bg-blue-500'
                    : 'bg-slate-600'
                )}
              />

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                        getSeverityBgClass(alert.severity)
                      )}
                    >
                      {alert.severity}
                    </span>
                    {alert.competitors && (
                      <CompetitorBadge
                        name={alert.competitors.name}
                        color={alert.competitors.color}
                        is_hustle={alert.competitors.is_hustle}
                        size="sm"
                      />
                    )}
                    {!alert.is_read && (
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                    )}
                  </div>
                  <span className="text-[11px] text-slate-600 shrink-0">
                    {formatRelativeTime(alert.created_at)}
                  </span>
                </div>

                <p
                  className={cn(
                    'text-sm mt-1.5 leading-snug',
                    alert.is_read ? 'text-slate-400' : 'text-white'
                  )}
                >
                  {alert.title}
                </p>

                {alert.description && (
                  <p className="text-xs text-slate-500 mt-1">{alert.description}</p>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 mt-2.5">
                  {!alert.is_read && (
                    <button
                      onClick={() => markAsRead(alert.id)}
                      className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1 transition-colors"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      Mark read
                    </button>
                  )}
                  <button
                    onClick={() => dismissAlert(alert.id)}
                    className="text-xs text-slate-600 hover:text-red-400 flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
