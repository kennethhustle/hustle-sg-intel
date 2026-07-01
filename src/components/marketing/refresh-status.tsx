'use client'

import { useState, useTransition } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export type RefreshLog = {
  id:               string
  started_at:       string
  completed_at:     string | null
  status:           'running' | 'success' | 'failed' | 'partial'
  duration_seconds: number | null
  records_updated:  number
  error_message:    string | null
  triggered_by:     'cron' | 'manual'
}

interface Props {
  latestLog:         RefreshLog | null
  lastSuccessfulLog: RefreshLog | null
}

// ─── SGT formatting helpers ───────────────────────────────────────────────────

const SGT = 'Asia/Singapore'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SGT, day: '2-digit', month: 'short', year: 'numeric',
  }).format(new Date(iso))
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: SGT, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso)) + ' SGT'
}

/** Returns the ISO string for the NEXT 4:00 AM SGT after now. */
function nextRefreshISO(): string {
  const now = new Date()
  const todaySGT = new Intl.DateTimeFormat('en-CA', {
    timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
  const [y, m, d] = todaySGT.split('-').map(Number)
  const todayRefreshUTC = new Date(Date.UTC(y, m - 1, d, 20, 0, 0))
  const nextRefreshUTC  = now < todayRefreshUTC
    ? todayRefreshUTC
    : new Date(todayRefreshUTC.getTime() + 86_400_000)
  return nextRefreshUTC.toISOString()
}

// ─── Status chip ──────────────────────────────────────────────────────────────

function StatusChip({ status }: { status: RefreshLog['status'] | null }) {
  if (!status) return <span className="text-slate-600 text-[11px] font-mono">—</span>
  const cfg = {
    success: { dot: 'bg-emerald-400', text: 'text-emerald-400', label: 'Successful' },
    partial: { dot: 'bg-yellow-400',  text: 'text-yellow-400',  label: 'Partial'    },
    failed:  { dot: 'bg-red-400',     text: 'text-red-400',     label: 'Failed'     },
    running: { dot: 'bg-blue-400 animate-pulse', text: 'text-blue-400', label: 'Running' },
  }[status]

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
      <span className={`text-[11px] font-mono font-semibold ${cfg.text}`}>{cfg.label}</span>
    </span>
  )
}

// ─── Error log modal ──────────────────────────────────────────────────────────

function ErrorModal({ log, onClose }: { log: RefreshLog; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-slate-900 border border-red-800/60 rounded-xl p-5 w-full max-w-md mx-4 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-bold text-red-400">Error Log</span>
          <button onClick={onClose} className="text-slate-500 hover:text-white text-sm">✕</button>
        </div>
        <div className="space-y-2 text-xs font-mono text-slate-300">
          <div><span className="text-slate-500">Run ID:</span> {log.id}</div>
          <div><span className="text-slate-500">Started:</span> {fmtDate(log.started_at)} {fmtTime(log.started_at)}</div>
          <div><span className="text-slate-500">Trigger:</span> {log.triggered_by}</div>
          <div className="mt-3 p-3 bg-red-950/40 border border-red-800/40 rounded-lg text-red-300 break-all">
            {log.error_message ?? 'No error message recorded.'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function RefreshStatus({ latestLog, lastSuccessfulLog }: Props) {
  const [isPending, startTransition] = useTransition()
  const [refreshState, setRefreshState] = useState<
    'idle' | 'running' | 'done' | 'error'
  >('idle')
  const [showErrorModal, setShowErrorModal] = useState(false)
  const [localLatest, setLocalLatest]       = useState<RefreshLog | null>(latestLog)
  const [localSuccess, setLocalSuccess]     = useState<RefreshLog | null>(lastSuccessfulLog)
  const [refreshError, setRefreshError]     = useState<string | null>(null)

  const currentLog   = localLatest
  const successLog   = localSuccess
  const isFailed     = currentLog?.status === 'failed'
  const nextRefresh  = nextRefreshISO()

  function handleRefresh() {
    setRefreshState('running')
    setRefreshError(null)

    startTransition(async () => {
      try {
        const res = await fetch('/api/refresh/marketing', { method: 'POST' })
        const json = await res.json() as {
          success: boolean
          error?: string
          result?: { records_updated: number }
        }

        if (res.ok && json.success) {
          setRefreshState('done')
          const logRes = await fetch('/api/marketing/refresh-status')
          if (logRes.ok) {
            const logJson = await logRes.json() as {
              latestLog: RefreshLog | null
              lastSuccessfulLog: RefreshLog | null
            }
            setLocalLatest(logJson.latestLog)
            setLocalSuccess(logJson.lastSuccessfulLog)
          }
          setTimeout(() => window.location.reload(), 1_200)
        } else {
          setRefreshState('error')
          setRefreshError(json.error ?? 'Unknown error')
        }
      } catch (e) {
        setRefreshState('error')
        setRefreshError(e instanceof Error ? e.message : 'Network error')
      }
    })
  }

  const displayLog    = isFailed ? successLog : currentLog
  const displayStatus = isFailed ? 'failed' : currentLog?.status ?? null

  return (
    <>
      {showErrorModal && currentLog && (
        <ErrorModal log={currentLog} onClose={() => setShowErrorModal(false)} />
      )}

      <div className="flex flex-wrap items-start gap-3">
        <div className="bg-slate-900/80 border border-slate-700/60 rounded-xl px-4 py-3 min-w-[240px]">
          <div className="flex items-center gap-2 mb-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${
              displayStatus === 'success' || displayStatus === 'partial'
                ? 'bg-emerald-400 animate-pulse'
                : displayStatus === 'failed'
                  ? 'bg-red-400'
                  : 'bg-slate-600'
            }`} />
            <span className="text-[10px] font-mono font-bold tracking-widest text-slate-400">
              {displayStatus === 'success' || displayStatus === 'partial' ? 'LIVE' : 'STATUS'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px]">
            <div>
              <p className="text-slate-500 font-mono mb-0.5">Last Updated</p>
              <p className="text-white font-mono font-semibold">
                {fmtDate(displayLog?.completed_at ?? displayLog?.started_at ?? null)}
              </p>
              <p className="text-slate-400 font-mono">
                {fmtTime(displayLog?.completed_at ?? displayLog?.started_at ?? null)}
              </p>
            </div>
            <div>
              <p className="text-slate-500 font-mono mb-0.5">Next Refresh</p>
              <p className="text-white font-mono font-semibold">{fmtDate(nextRefresh)}</p>
              <p className="text-slate-400 font-mono">{fmtTime(nextRefresh)}</p>
            </div>
            <div className="col-span-2 mt-0.5 flex items-center gap-3">
              <div>
                <p className="text-slate-500 font-mono mb-0.5">Status</p>
                <StatusChip status={displayStatus} />
              </div>
              {isFailed && successLog && (
                <div>
                  <p className="text-slate-500 font-mono mb-0.5">Last Successful</p>
                  <p className="text-slate-300 font-mono text-[10px]">
                    {fmtDate(successLog.completed_at)} {fmtTime(successLog.completed_at)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {isFailed && (
            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-800">
              <button
                onClick={handleRefresh}
                disabled={isPending || refreshState === 'running'}
                className="px-2 py-1 rounded text-[10px] font-mono bg-red-950/50 border border-red-800/60
                           text-red-400 hover:bg-red-900/50 transition-all disabled:opacity-50"
              >
                Retry
              </button>
              {currentLog && (
                <button
                  onClick={() => setShowErrorModal(true)}
                  className="px-2 py-1 rounded text-[10px] font-mono bg-slate-800/60 border border-slate-700
                             text-slate-400 hover:text-white transition-all"
                >
                  View Error Log
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            onClick={handleRefresh}
            disabled={isPending || refreshState === 'running'}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-[11px] font-mono
              font-semibold transition-all select-none
              ${refreshState === 'running' || isPending
                ? 'bg-blue-950/40 border-blue-700/50 text-blue-400 cursor-wait'
                : refreshState === 'done'
                  ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-400'
                  : refreshState === 'error'
                    ? 'bg-red-950/40 border-red-700/50 text-red-400'
                    : 'bg-slate-800/60 border-slate-700 text-slate-300 hover:text-white hover:border-slate-500'
              }`}
          >
            {refreshState === 'running' || isPending ? (
              <>
                <span className="w-2.5 h-2.5 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
                Refreshing…
              </>
            ) : refreshState === 'done' ? (
              <>✓ Completed</>
            ) : refreshState === 'error' ? (
              <>✕ Failed</>
            ) : (
              <>↺ Refresh Now</>
            )}
          </button>
          {refreshState === 'error' && refreshError && (
            <p className="text-[10px] text-red-400 font-mono max-w-[180px] leading-tight">
              {refreshError}
            </p>
          )}
        </div>
      </div>
    </>
  )
}
