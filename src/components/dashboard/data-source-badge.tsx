/**
 * DataSourceBadge — uniform data-honesty label used across all modules.
 * Every metric should declare where it came from and how fresh it is.
 */
import { cn } from '@/lib/utils'

export type DataSourceKind =
  | 'live'        // refreshed automatically from an API in the nightly cron
  | 'cached'      // read from Supabase cache (cron-refreshed)
  | 'manual'      // manually entered / verified by a human
  | 'static'      // one-off snapshot; will not update automatically
  | 'ai'          // AI-generated insight
  | 'unavailable' // source blocked or not connected

const STYLES: Record<DataSourceKind, { label: string; cls: string }> = {
  live:        { label: 'LIVE REFRESHED', cls: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  cached:      { label: 'CACHED',         cls: 'bg-sky-500/10 text-sky-400 border-sky-500/30' },
  manual:      { label: 'MANUAL DATA',    cls: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  static:      { label: 'STATIC SNAPSHOT',cls: 'bg-orange-500/10 text-orange-400 border-orange-500/30' },
  ai:          { label: 'AI-GENERATED',   cls: 'bg-violet-500/10 text-violet-400 border-violet-500/30' },
  unavailable: { label: 'DATA UNAVAILABLE', cls: 'bg-yellow-500/10 text-yellow-500 border-yellow-500/30' },
}

export function DataSourceBadge({
  kind,
  asOf,
  detail,
  className,
}: {
  kind: DataSourceKind
  /** ISO timestamp or date string shown as "as of …" */
  asOf?: string | null
  /** Extra context, e.g. "verified by Kenneth" or "Meta Ad Library API" */
  detail?: string
  className?: string
}) {
  const s = STYLES[kind]
  const asOfText = asOf
    ? new Date(asOf).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
    : null

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase whitespace-nowrap',
        s.cls,
        className
      )}
      title={detail}
    >
      {s.label}
      {asOfText && <span className="font-normal normal-case opacity-75">· {asOfText}</span>}
    </span>
  )
}
