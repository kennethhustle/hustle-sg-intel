import { AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface DataUnavailableProps {
  label?: string
  className?: string
  inline?: boolean
}

export function DataUnavailable({ label, className, inline = false }: DataUnavailableProps) {
  if (inline) {
    return (
      <span
        className={cn(
          'inline-flex items-center gap-1 font-mono text-xs text-yellow-500/80',
          className
        )}
        title={label ? `DATA UNAVAILABLE — ${label}` : 'DATA UNAVAILABLE'}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        N/A
      </span>
    )
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 text-yellow-500/80',
        className
      )}
    >
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span className="font-mono text-xs">
        DATA UNAVAILABLE{label ? ` — ${label}` : ''}
      </span>
    </div>
  )
}
