import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateStrategicInsights } from '@/lib/services/ai/claude'
import type { SocialRankingEntry, Competitor, Platform, SocialMetric } from '@/lib/types'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const insightType = searchParams.get('type')
  const limit = parseInt(searchParams.get('limit') ?? '20', 10)

  let query = supabase
    .from('strategic_insights')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (insightType) {
    query = query.eq('insight_type', insightType)
  }

  // Optionally filter out expired insights
  const includeExpired = searchParams.get('include_expired') === 'true'
  if (!includeExpired) {
    query = query.or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
  }

  const { data: insights, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: insights ?? [] })
}

export async function POST(request: NextRequest) {
  // Check if user is admin
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userData || !['admin', 'analyst'].includes(userData.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const serviceSupabase = await createServiceClient()

  try {
    // Gather intelligence data
    const { data: rankingData } = await serviceSupabase.rpc('get_social_ranking')
    const { data: recentJobs } = await serviceSupabase
      .from('job_postings')
      .select('*')
      .eq('is_active', true)
      .order('scraped_at', { ascending: false })
      .limit(50)

    const { data: courseCounts } = await serviceSupabase
      .from('course_catalog')
      .select('competitor_id, competitors(name)')
      .eq('is_active', true)

    const { data: recentAlerts } = await serviceSupabase
      .from('alerts')
      .select('title, description')
      .order('created_at', { ascending: false })
      .limit(20)

    // Build course count map
    const courseCountMap: Record<string, number> = {}
    for (const row of (courseCounts ?? [])) {
      const compRaw = row.competitors
      const name = (Array.isArray(compRaw) ? compRaw[0] : compRaw)?.name ?? row.competitor_id
      courseCountMap[name] = (courseCountMap[name] ?? 0) + 1
    }

    // Build social ranking entries
    const { data: competitors } = await serviceSupabase
      .from('competitors')
      .select('*')
      .eq('active', true)

    const rankingEntries: SocialRankingEntry[] = (rankingData ?? []).map((row: {
      competitor_id: string
      competitor_name: string
      competitor_slug: string
      competitor_color: string
      is_hustle: boolean
      tier: string
      instagram_followers: number | null
      facebook_followers: number | null
      linkedin_followers: number | null
      tiktok_followers: number | null
      youtube_followers: number | null
      total_followers: number
      rank: number
    }) => {
      const competitor = (competitors ?? []).find((c: Competitor) => c.id === row.competitor_id) ?? {
        id: row.competitor_id,
        name: row.competitor_name,
        slug: row.competitor_slug,
        color: row.competitor_color,
        is_hustle: row.is_hustle,
        tier: row.tier as Competitor['tier'],
        website: '',
        active: true,
        created_at: '',
        updated_at: '',
      }

      const metrics: Partial<Record<Platform, SocialMetric | null>> = {
        instagram: row.instagram_followers !== null ? { followers: row.instagram_followers } as unknown as SocialMetric : null,
        facebook: row.facebook_followers !== null ? { followers: row.facebook_followers } as unknown as SocialMetric : null,
        linkedin: row.linkedin_followers !== null ? { followers: row.linkedin_followers } as unknown as SocialMetric : null,
        tiktok: row.tiktok_followers !== null ? { followers: row.tiktok_followers } as unknown as SocialMetric : null,
        youtube: row.youtube_followers !== null ? { followers: row.youtube_followers } as unknown as SocialMetric : null,
      }

      return {
        competitor,
        metrics,
        total_followers: row.total_followers,
        rank: row.rank,
      }
    })

    const insights = await generateStrategicInsights({
      socialRanking: rankingEntries,
      recentJobs: recentJobs ?? [],
      courseCount: courseCountMap,
      alerts: (recentAlerts ?? []).map((a: { title: string; description: string | null }) => `${a.title}: ${a.description ?? ''}`),
    })

    // Insert insights into DB
    const { data: inserted, error: insertError } = await serviceSupabase
      .from('strategic_insights')
      .insert(insights)
      .select()

    if (insertError) {
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ data: inserted, count: inserted?.length ?? 0 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    )
  }
}
