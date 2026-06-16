import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const competitorId = searchParams.get('competitor_id')
  const platform = searchParams.get('platform')

  // Get the full social ranking
  const { data: ranking, error: rankingError } = await supabase.rpc('get_social_ranking')
  if (rankingError) {
    return NextResponse.json({ error: rankingError.message }, { status: 500 })
  }

  // Get latest metrics with optional filters
  let query = supabase
    .from('social_metrics')
    .select(`
      *,
      competitors (id, name, slug, color, is_hustle, tier)
    `)
    .order('scraped_at', { ascending: false })

  if (competitorId) {
    query = query.eq('competitor_id', competitorId)
  }
  if (platform) {
    query = query.eq('platform', platform)
  }

  const { data: metrics, error: metricsError } = await query.limit(500)
  if (metricsError) {
    return NextResponse.json({ error: metricsError.message }, { status: 500 })
  }

  // Get latest per competitor per platform (deduplicated)
  const latestByCompetitorPlatform = new Map<string, typeof metrics[0]>()
  for (const metric of (metrics ?? [])) {
    const key = `${metric.competitor_id}:${metric.platform}`
    if (!latestByCompetitorPlatform.has(key)) {
      latestByCompetitorPlatform.set(key, metric)
    }
  }

  // Get previous period metrics (24h ago) for delta calculation
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  let prevQuery = supabase
    .from('social_metrics')
    .select('competitor_id, platform, followers, scraped_at')
    .lt('scraped_at', yesterday)
    .order('scraped_at', { ascending: false })

  if (competitorId) prevQuery = prevQuery.eq('competitor_id', competitorId)
  if (platform) prevQuery = prevQuery.eq('platform', platform)

  const { data: prevMetrics } = await prevQuery.limit(500)

  const prevByCompetitorPlatform = new Map<string, number | null>()
  for (const metric of (prevMetrics ?? [])) {
    const key = `${metric.competitor_id}:${metric.platform}`
    if (!prevByCompetitorPlatform.has(key)) {
      prevByCompetitorPlatform.set(key, metric.followers)
    }
  }

  // Build enriched metrics with deltas
  const enrichedMetrics = Array.from(latestByCompetitorPlatform.values()).map((m) => {
    const key = `${m.competitor_id}:${m.platform}`
    const prevFollowers = prevByCompetitorPlatform.get(key) ?? null
    const delta =
      m.followers !== null && prevFollowers !== null && prevFollowers > 0
        ? ((m.followers - prevFollowers) / prevFollowers) * 100
        : null

    return {
      ...m,
      previous_followers: prevFollowers,
      delta_percent: delta,
    }
  })

  return NextResponse.json({
    ranking: ranking ?? [],
    metrics: enrichedMetrics,
  })
}
