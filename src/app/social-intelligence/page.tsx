import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { SocialBarChart } from '@/components/charts/social-bar-chart'
import { createClient } from '@/lib/supabase/server'
import { formatNumber, formatRelativeTime, getPlatformLabel, getPlatformColor } from '@/lib/utils'
import type { Platform, Tier, DataSource } from '@/lib/types'

export const revalidate = 300

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']

async function getSocialData() {
  const supabase = await createClient()

  const [rankingRes, metricsRes, competitorsRes] = await Promise.all([
    supabase.rpc('get_social_ranking'),
    supabase
      .from('social_metrics')
      .select(`*, competitors(id, name, slug, color, is_hustle, tier)`)
      .order('scraped_at', { ascending: false }),
    supabase.from('competitors').select('*').eq('active', true),
  ])

  const ranking = rankingRes.data ?? []
  const allMetrics = metricsRes.data ?? []

  // Latest metric per competitor per platform
  const latestMetrics = new Map<string, {
    followers: number | null
    data_source: DataSource
    scraped_at: string
    error_message: string | null
  }>()

  for (const m of allMetrics) {
    const key = `${m.competitor_id}:${m.platform}`
    if (!latestMetrics.has(key)) {
      latestMetrics.set(key, {
        followers: m.followers,
        data_source: m.data_source as DataSource,
        scraped_at: m.scraped_at,
        error_message: m.error_message,
      })
    }
  }

  const lastUpdated = allMetrics[0]?.scraped_at ?? null

  return {
    ranking,
    latestMetrics,
    competitors: competitorsRes.data ?? [],
    lastUpdated,
  }
}

export default async function SocialIntelligencePage() {
  const { ranking, latestMetrics, competitors, lastUpdated } = await getSocialData()

  // Per-platform ranking data
  const platformRankings = PLATFORMS.map((platform) => {
    const entries = competitors
      .map((c) => {
        const key = `${c.id}:${platform}`
        const metric = latestMetrics.get(key)
        return {
          competitor: c,
          followers: metric?.followers ?? null,
          data_source: metric?.data_source ?? null,
          scraped_at: metric?.scraped_at ?? null,
        }
      })
      .sort((a, b) => (b.followers ?? -1) - (a.followers ?? -1))

    return { platform, entries }
  })

  // Total reach bar chart
  const totalBarData = ranking.map((r: {
    competitor_name: string
    competitor_color: string
    is_hustle: boolean
    total_followers: number
  }) => ({
    name: r.competitor_name,
    followers: r.total_followers > 0 ? r.total_followers : null,
    color: r.competitor_color,
    is_hustle: r.is_hustle,
  }))

  return (
    <AppLayout title="Social Intelligence" lastUpdated={lastUpdated}>
      <div className="mb-6">
        <p className="text-slate-400 text-sm">
          Live follower counts scraped from public profiles. Data is updated daily via cron at 7am SGT.
        </p>
      </div>

      {/* Total reach overview */}
      <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 mb-6">
        <h2 className="text-sm font-semibold text-white mb-1">Total Social Reach (All Platforms)</h2>
        <p className="text-xs text-slate-500 mb-4">Aggregate follower count across Instagram, Facebook, LinkedIn, TikTok, YouTube</p>
        {totalBarData.length === 0 ? (
          <DataUnavailable label="No social data collected yet" />
        ) : (
          <SocialBarChart data={totalBarData} />
        )}
        <p className="text-[11px] text-slate-600 mt-2">
          Source: scraped · Last updated: {lastUpdated ? formatRelativeTime(lastUpdated) : 'Never'}
        </p>
      </div>

      {/* Per-platform breakdowns */}
      <div className="space-y-6">
        {platformRankings.map(({ platform, entries }) => (
          <div key={platform} className="bg-slate-900/60 border border-slate-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: getPlatformColor(platform) }}
                />
                <h3 className="text-sm font-semibold text-white">{getPlatformLabel(platform)}</h3>
              </div>
              <span className="text-xs text-slate-500">
                {entries.filter((e) => e.followers !== null).length} / {entries.length} tracked
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/50">
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 w-8">#</th>
                    <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500">Competitor</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Followers</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Source</th>
                    <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500">Last scraped</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, rank) => (
                    <tr
                      key={entry.competitor.id}
                      className={`border-b border-slate-800/30 hover:bg-slate-800/20 transition-colors ${
                        entry.competitor.is_hustle ? 'bg-indigo-500/5' : ''
                      }`}
                    >
                      <td className="px-4 py-3 text-xs text-slate-500">{rank + 1}</td>
                      <td className="px-4 py-3">
                        <CompetitorBadge
                          name={entry.competitor.name}
                          color={entry.competitor.color}
                          is_hustle={entry.competitor.is_hustle}
                          tier={entry.competitor.tier as Tier}
                          size="sm"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {entry.followers !== null ? (
                          <span className="text-sm font-semibold text-white">
                            {formatNumber(entry.followers)}
                          </span>
                        ) : (
                          <DataUnavailable inline />
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {entry.data_source ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-slate-800 text-slate-400 border border-slate-700 rounded font-medium">
                            {entry.data_source}
                          </span>
                        ) : (
                          <span className="text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-slate-500">
                        {entry.scraped_at ? formatRelativeTime(entry.scraped_at) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 p-4 bg-slate-900/40 border border-slate-800/50 rounded-lg">
        <p className="text-xs text-slate-500">
          <strong className="text-slate-400">Data integrity note:</strong> All follower counts are scraped live from public pages.
          Instagram, Facebook, LinkedIn, and TikTok frequently block automated access — counts showing DATA UNAVAILABLE indicate
          the scraper was blocked, not that the account doesn&apos;t exist. No data is ever estimated or fabricated.
        </p>
      </div>
    </AppLayout>
  )
}
