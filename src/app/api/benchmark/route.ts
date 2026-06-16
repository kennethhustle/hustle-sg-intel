import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import type { Platform, BenchmarkRow, DataSource } from '@/lib/types'

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']

export async function GET() {
  const supabase = await createClient()

  // Get all active competitors
  const { data: competitors, error: competitorsError } = await supabase
    .from('competitors')
    .select('*')
    .eq('active', true)
    .order('name')

  if (competitorsError || !competitors) {
    return NextResponse.json({ error: competitorsError?.message }, { status: 500 })
  }

  // Get latest metrics for all competitors and platforms
  const { data: allMetrics, error: metricsError } = await supabase
    .from('social_metrics')
    .select('*')
    .order('scraped_at', { ascending: false })

  if (metricsError) {
    return NextResponse.json({ error: metricsError.message }, { status: 500 })
  }

  // Build a map: competitor_id -> platform -> latest metric
  const metricMap = new Map<string, Map<Platform, {
    followers: number | null
    data_source: DataSource
    scraped_at: string
    error_message: string | null
  }>>()

  for (const metric of (allMetrics ?? [])) {
    if (!metricMap.has(metric.competitor_id)) {
      metricMap.set(metric.competitor_id, new Map())
    }
    const platformMap = metricMap.get(metric.competitor_id)!
    // Only keep the latest (already ordered by scraped_at DESC)
    if (!platformMap.has(metric.platform as Platform)) {
      platformMap.set(metric.platform as Platform, {
        followers: metric.followers,
        data_source: metric.data_source as DataSource,
        scraped_at: metric.scraped_at,
        error_message: metric.error_message,
      })
    }
  }

  // Build benchmark rows
  const rows: BenchmarkRow[] = competitors.map((competitor) => {
    const platformMap = metricMap.get(competitor.id) ?? new Map()

    const instagram = platformMap.get('instagram')?.followers ?? null
    const facebook = platformMap.get('facebook')?.followers ?? null
    const linkedin = platformMap.get('linkedin')?.followers ?? null
    const tiktok = platformMap.get('tiktok')?.followers ?? null
    const youtube = platformMap.get('youtube')?.followers ?? null

    const total = [instagram, facebook, linkedin, tiktok, youtube]
      .filter((v): v is number => v !== null)
      .reduce((sum, v) => sum + v, 0)

    const lastUpdated =
      PLATFORMS.map((p) => platformMap.get(p)?.scraped_at)
        .filter((v): v is string => v !== null)
        .sort()
        .pop() ?? null

    const dataSources: Partial<Record<Platform, DataSource>> = {}
    for (const platform of PLATFORMS) {
      const m = platformMap.get(platform)
      if (m) dataSources[platform] = m.data_source
    }

    return {
      competitor,
      instagram,
      facebook,
      linkedin,
      tiktok,
      youtube,
      total,
      last_updated: lastUpdated,
      data_sources: dataSources,
    }
  })

  // Sort by total followers descending
  rows.sort((a, b) => b.total - a.total)

  // Platform summaries
  const platformSummaries = PLATFORMS.map((platform) => {
    const values = rows
      .map((r) => r[platform])
      .filter((v): v is number => v !== null)
    const total = values.reduce((sum, v) => sum + v, 0)
    const available = values.length
    return {
      platform,
      total_followers: total,
      available_competitors: available,
      unavailable_competitors: competitors.length - available,
    }
  })

  return NextResponse.json({
    data: rows,
    platform_summaries: platformSummaries,
    last_updated: new Date().toISOString(),
  })
}
