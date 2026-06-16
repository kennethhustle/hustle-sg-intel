import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateStrategicInsights } from '@/lib/services/ai/claude'
import type { SocialRankingEntry, Competitor, Platform, SocialMetric } from '@/lib/types'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    const supabase = await createServiceClient()

    // Gather all intelligence data
    const { data: rankingData } = await supabase.rpc('get_social_ranking')

    const { data: competitors } = await supabase
      .from('competitors')
      .select('*')
      .eq('active', true)

    const { data: recentJobs } = await supabase
      .from('job_postings')
      .select('*')
      .eq('is_active', true)
      .order('scraped_at', { ascending: false })
      .limit(50)

    const { data: courseCounts } = await supabase
      .from('course_catalog')
      .select('competitor_id, competitors(name)')
      .eq('is_active', true)

    const { data: recentAlerts } = await supabase
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
      alerts: (recentAlerts ?? []).map((a: { title: string; description: string | null }) =>
        `${a.title}: ${a.description ?? ''}`
      ),
    })

    // Insert new insights
    const { data: inserted, error: insertError } = await supabase
      .from('strategic_insights')
      .insert(insights)
      .select()

    if (insertError) {
      throw new Error(`Failed to insert insights: ${insertError.message}`)
    }

    const duration = Date.now() - startTime
    return NextResponse.json({
      success: true,
      insights_generated: inserted?.length ?? 0,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error('AI insights cron error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        duration_ms: duration,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
