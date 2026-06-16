import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { createClient } from '@/lib/supabase/server'
import { formatNumber, formatRelativeTime } from '@/lib/utils'
import { ExternalLink } from 'lucide-react'
import type { Platform, Tier, DataSource } from '@/lib/types'

export const revalidate = 300

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']
const PLATFORM_LABELS: Record<Platform, string> = {
  instagram: 'IG',
  facebook: 'FB',
  linkedin: 'LI',
  tiktok: 'TT',
  youtube: 'YT',
}

async function getCompetitorsData() {
  const supabase = await createClient()

  const { data: competitors } = await supabase
    .from('competitors')
    .select(`*, social_profiles(*)`)
    .eq('active', true)
    .order('name')

  const { data: allMetrics } = await supabase
    .from('social_metrics')
    .select('*')
    .order('scraped_at', { ascending: false })

  // Build metrics map: competitor_id -> platform -> latest metric
  const metricMap = new Map<string, Map<Platform, {
    followers: number | null
    data_source: DataSource
    scraped_at: string
  }>>()

  for (const m of (allMetrics ?? [])) {
    if (!metricMap.has(m.competitor_id)) {
      metricMap.set(m.competitor_id, new Map())
    }
    const pm = metricMap.get(m.competitor_id)!
    if (!pm.has(m.platform as Platform)) {
      pm.set(m.platform as Platform, {
        followers: m.followers,
        data_source: m.data_source as DataSource,
        scraped_at: m.scraped_at,
      })
    }
  }

  const lastUpdated = allMetrics?.[0]?.scraped_at ?? null

  return { competitors: competitors ?? [], metricMap, lastUpdated }
}

export default async function CompetitorsPage() {
  const { competitors, metricMap, lastUpdated } = await getCompetitorsData()

  // Sort by total followers descending
  const sorted = [...competitors].sort((a, b) => {
    const aMetrics = metricMap.get(a.id)
    const bMetrics = metricMap.get(b.id)
    const aTotal = aMetrics
      ? Array.from(aMetrics.values()).reduce((sum, m) => sum + (m.followers ?? 0), 0)
      : 0
    const bTotal = bMetrics
      ? Array.from(bMetrics.values()).reduce((sum, m) => sum + (m.followers ?? 0), 0)
      : 0
    return bTotal - aTotal
  })

  return (
    <AppLayout title="Competitors" lastUpdated={lastUpdated}>
      <div className="mb-6">
        <p className="text-slate-400 text-sm">
          Full competitor matrix with latest social metrics across all platforms.
          All figures are live-scraped — unavailable data is shown as DATA UNAVAILABLE.
        </p>
      </div>

      {/* Table */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider w-6">#</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Competitor</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Tier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Website</th>
                {PLATFORMS.map((p) => (
                  <th key={p} className="text-right px-3 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    {PLATFORM_LABELS[p]}
                  </th>
                ))}
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Total</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-400 uppercase tracking-wider">Updated</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((competitor, idx) => {
                const pm = metricMap.get(competitor.id)
                const platformMetrics = PLATFORMS.map((p) => pm?.get(p) ?? null)
                const total = platformMetrics.reduce(
                  (sum, m) => sum + (m?.followers ?? 0),
                  0
                )
                const lastPlatformUpdate = platformMetrics
                  .filter((m): m is NonNullable<typeof m> => m !== null)
                  .sort((a, b) => new Date(b.scraped_at).getTime() - new Date(a.scraped_at).getTime())
                  [0]?.scraped_at ?? null

                return (
                  <tr
                    key={competitor.id}
                    className={`border-b border-slate-800/60 hover:bg-slate-800/30 transition-colors ${
                      competitor.is_hustle ? 'bg-indigo-500/5' : ''
                    }`}
                  >
                    <td className="px-4 py-3.5 text-slate-500 text-xs">{idx + 1}</td>
                    <td className="px-4 py-3.5">
                      <CompetitorBadge
                        name={competitor.name}
                        color={competitor.color}
                        is_hustle={competitor.is_hustle}
                        tier={competitor.tier as Tier}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`text-xs px-2 py-0.5 rounded border font-medium ${
                        competitor.tier === 'High'
                          ? 'bg-red-500/10 text-red-400 border-red-500/20'
                          : competitor.tier === 'Mid'
                          ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                          : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                      }`}>
                        {competitor.tier}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <a
                        href={`https://${competitor.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-400 transition-colors"
                      >
                        {competitor.website}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                    {platformMetrics.map((metric, pIdx) => (
                      <td key={PLATFORMS[pIdx]} className="px-3 py-3.5 text-right">
                        {metric?.followers !== null && metric?.followers !== undefined ? (
                          <span className="text-sm text-white font-medium">
                            {formatNumber(metric.followers)}
                          </span>
                        ) : (
                          <DataUnavailable inline />
                        )}
                      </td>
                    ))}
                    <td className="px-4 py-3.5 text-right">
                      {total > 0 ? (
                        <span className="text-sm font-bold text-white">
                          {formatNumber(total)}
                        </span>
                      ) : (
                        <DataUnavailable inline />
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right text-xs text-slate-500">
                      {lastPlatformUpdate ? formatRelativeTime(lastPlatformUpdate) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-600 mt-4">
        Data source: scraped · All followers counts are live-scraped from public pages · Unavailable = platform blocked scraping or no data yet
      </p>
    </AppLayout>
  )
}
