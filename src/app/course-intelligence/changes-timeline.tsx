'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { CourseChangeRow } from './types'

const SGT = 'Asia/Singapore'

const CHANGE_META: Record<string, { label: string; icon: string; cls: string }> = {
  new_course: { label: 'New course', icon: '✦', cls: 'text-emerald-400' },
  removed_course: { label: 'Course removed', icon: '✕', cls: 'text-red-400' },
  run_count_increase: { label: 'Runs ▲', icon: '▲', cls: 'text-emerald-400' },
  run_count_decrease: { label: 'Runs ▼', icon: '▼', cls: 'text-red-400' },
  fee_change: { label: 'Fee change', icon: '$', cls: 'text-amber-400' },
  rating_change: { label: 'Rating change', icon: '★', cls: 'text-amber-400' },
  respondent_count_change: { label: 'Respondents change', icon: '◈', cls: 'text-sky-400' },
  new_provider: { label: 'New provider', icon: '⬤', cls: 'text-indigo-400' },
  provider_growth: { label: 'Provider growth', icon: '↗', cls: 'text-indigo-400' },
}
const DEFAULT_META = { label: 'Update', icon: '•', cls: 'text-slate-400' }

function fmtVal(v: number | null, changeType: string): string {
  if (v == null) return '—'
  if (changeType === 'fee_change') return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  return String(v)
}

function describe(row: CourseChangeRow): string {
  const meta = CHANGE_META[row.change_type] ?? DEFAULT_META
  switch (row.change_type) {
    case 'new_course':
      return 'New course'
    case 'removed_course':
      return 'Course removed'
    case 'run_count_increase':
    case 'run_count_decrease': {
      const pct = row.change_percentage != null ? ` (${row.change_percentage > 0 ? '+' : ''}${row.change_percentage.toFixed(0)}%)` : ''
      return `Runs ${row.change_type === 'run_count_increase' ? '▲' : '▼'} ${fmtVal(row.old_value, row.change_type)}→${fmtVal(row.new_value, row.change_type)}${pct}`
    }
    case 'fee_change': {
      const dir = (row.change_amount ?? 0) >= 0 ? '▲' : '▼'
      return `Fee ${dir} ${fmtVal(row.old_value, row.change_type)}→${fmtVal(row.new_value, row.change_type)}`
    }
    case 'rating_change':
      return `Rating ${fmtVal(row.old_value, row.change_type)}→${fmtVal(row.new_value, row.change_type)}`
    case 'respondent_count_change':
      return `Respondents ${fmtVal(row.old_value, row.change_type)}→${fmtVal(row.new_value, row.change_type)}`
    case 'new_provider':
      return 'New provider detected'
    case 'provider_growth':
      return 'Provider growth'
    default:
      return meta.label
  }
}

function dayKey(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: SGT, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dISO = dayFmt.format(d)
  const nowISO = dayFmt.format(now)
  const yesterdayISO = dayFmt.format(new Date(now.getTime() - 86_400_000))
  if (dISO === nowISO) return 'Today'
  if (dISO === yesterdayISO) return 'Yesterday'
  return d.toLocaleDateString('en-SG', { timeZone: SGT, day: 'numeric', month: 'short', year: 'numeric' })
}

export function ChangesTimeline({ changes }: { changes: CourseChangeRow[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, CourseChangeRow[]>()
    for (const c of changes) {
      const key = dayKey(c.detected_at)
      const arr = map.get(key) ?? []
      arr.push(c)
      map.set(key, arr)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [changes])

  if (changes.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/60 p-6 text-center text-sm text-slate-500">
        No data yet — populates after the next nightly refresh.
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-slate-800/60 overflow-hidden">
      {grouped.map(([key, rows]) => (
        <div key={key} className="border-b border-slate-800/40 last:border-0">
          <div className="px-4 py-2 bg-slate-900/60 text-[10px] font-mono text-slate-500 tracking-widest uppercase">
            {dayLabel(rows[0].detected_at)} · {rows.length} change{rows.length === 1 ? '' : 's'}
          </div>
          <div className="divide-y divide-slate-800/30">
            {rows.map((c) => {
              const meta = CHANGE_META[c.change_type] ?? DEFAULT_META
              return (
                <div key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className={cn('shrink-0 font-mono text-sm w-4 text-center', meta.cls)}>{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={cn('text-xs font-medium', meta.cls)}>{describe(c)}</span>
                      {c.category && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800/60 border border-slate-700/50 text-slate-400">
                          {c.category}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                      {c.course_title ?? '—'} <span className="text-slate-600">· {c.provider_name ?? 'Unknown provider'}</span>
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
