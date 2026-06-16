import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { DataUnavailable } from './data-unavailable'
import { formatNumber, formatRelativeTime, cn } from '@/lib/utils'

interface MetricCardProps {
  label: string
  value: number | null | undefined
  previousValue?: number | null
  deltaPercent?: number | null
  source?: string | null
  lastUpdated?: string | null
  format?: 'number' | 'percentage' | 'rank'
  icon?: React.ReactNode
  highlight?: boolean
  className?: string
  suffix?: string
}

export function MetricCard({
  label,
  value,
  previousValue,
  deltaPercent,
  source,
  lastUpdated,
  format = 'number',
  icon,
  highlight = false,
  className,
  suffix,
}: MetricCardProps) {
  const isUnavailable = value === null || value === undefined

  const formattedValue = isUnavailable
    ? null
    : format === 'rank'
    ? `#${value}`
    : format === 'percentage'
    ? `${value.toFixed(1)}%`
    : formatNumber(value)

  // Delta display
  const delta = deltaPercent ?? (
    value !== null && value !== undefined && previousValue !== null && previousValue !== undefined && previousValue > 0
      ? ((value - previousValue) / previousValue) * 100
      : null
  )

  return (
    <div
      className={cn(
        'bg-slate-900/60 border rounded-xl p-5 flex flex-col gap-3',
        highlight
          ? 'border-indigo-500/30 bg-indigo-500/5'
          : 'border-slate-800',
        className
      )}
    >
      {/* Label + icon */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400 font-medium">{label}</p>
        {icon && (
          <div className="text-slate-500">{icon}</div>
        )}
      </div>

      {/* Value */}
      <div className="flex items-end gap-3">
        {isUnavailable ? (
          <DataUnavailable />
        ) : (
          <span className={cn(
            'text-3xl font-bold tracking-tight',
            highlight ? 'text-indigo-300' : 'text-white'
          )}>
            {formattedValue}{suffix}
          </span>
        )}

        {/* Delta */}
        {!isUnavailable && delta !== null && (
          <div
            className={cn(
              'flex items-center gap-1 text-xs font-medium mb-1',
              delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-slate-500'
            )}
          >
            {delta > 0 ? (
              <TrendingUp className="h-3 w-3" />
            ) : delta < 0 ? (
              <TrendingDown className="h-3 w-3" />
            ) : (
              <Minus className="h-3 w-3" />
            )}
            {Math.abs(delta).toFixed(1)}%
          </div>
        )}
      </div>

      {/* Source + timestamp */}
      <div className="flex items-center gap-2 flex-wrap">
        {source && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-800 text-slate-400 border border-slate-700">
            src:{source}
          </span>
        )}
        {lastUpdated && (
          <span className="text-[11px] text-slate-600">
            {formatRelativeTime(lastUpdated)}
          </span>
        )}
      </div>
    </div>
  )
}
