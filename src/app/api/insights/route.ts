import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateStrategicInsights } from '@/lib/services/ai/claude'
import { buildIntelligencePayload } from '@/lib/services/ai/payload'
import { computeOpportunityScores } from '@/lib/services/scoring/opportunity'
import { startRefreshLog } from '@/lib/services/refresh-log'

const TOP_OPPORTUNITY_COUNT = 8

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
  // Check if user is admin/analyst
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
  const log = await startRefreshLog('ai_insights', 'claude', 'manual')

  let scoresResult: Awaited<ReturnType<typeof computeOpportunityScores>>
  try {
    scoresResult = await computeOpportunityScores(serviceSupabase)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    return NextResponse.json({ error: message }, { status: 500 })
  }

  const topOpportunityScores = [...scoresResult.scores]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, TOP_OPPORTUNITY_COUNT)

  try {
    const payload = await buildIntelligencePayload(serviceSupabase)
    const insights = await generateStrategicInsights(payload, topOpportunityScores)

    const { data: inserted, error: insertError } = await serviceSupabase
      .from('strategic_insights')
      .insert(insights)
      .select()

    if (insertError) {
      await log.finalize('partial', { inserted: scoresResult.persisted }, insertError.message, {
        scores: scoresResult.persisted,
        insights: 0,
      })
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    await log.finalize('success', { inserted: (inserted?.length ?? 0) + scoresResult.persisted }, undefined, {
      scores: scoresResult.persisted,
      insights: inserted?.length ?? 0,
    })

    return NextResponse.json({
      data: inserted,
      count: inserted?.length ?? 0,
      opportunity_scores_computed: scoresResult.persisted,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('partial', { inserted: scoresResult.persisted }, message, {
      scores: scoresResult.persisted,
      insights: 0,
    })
    return NextResponse.json(
      {
        error: message,
        partial: true,
        opportunity_scores_computed: scoresResult.persisted,
      },
      { status: 207 }
    )
  }
}
