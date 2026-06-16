import { cn } from '@/lib/utils'
import type { Tier } from '@/lib/types'

interface CompetitorBadgeProps {
  name: string
  color?: string
  tier?: Tier
  is_hustle?: boolean
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const tierStyles: Record<Tier, string> = {
  High: 'bg-red-500/10 text-red-400 border-red-500/20',
  Mid: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  Low: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
}

export function CompetitorBadge({
  name,
  color = '#6366f1',
  tier,
  is_hustle = false,
  size = 'md',
  className,
}: CompetitorBadgeProps) {
  const sizeClasses = {
    sm: 'text-[11px] px-2 py-0.5 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-2',
    lg: 'text-sm px-3 py-1.5 gap-2.5',
  }

  const dotSize = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium border',
        sizeClasses[size],
        is_hustle
          ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25'
          : 'bg-slate-800/60 text-slate-300 border-slate-700/60',
        className
      )}
    >
      <span
        className={cn('rounded-full shrink-0', dotSize[size])}
        style={{ backgroundColor: color }}
      />
      {name}
      {is_hustle && (
        <span className="text-[9px] font-bold uppercase tracking-wider text-indigo-400/80 ml-0.5">
          US
        </span>
      )}
      {tier && !is_hustle && (
        <span
          className={cn(
            'inline-flex items-center px-1 py-px rounded text-[9px] font-semibold uppercase tracking-wider border ml-0.5',
            tierStyles[tier]
          )}
        >
          {tier}
        </span>
      )}
    </span>
  )
}
