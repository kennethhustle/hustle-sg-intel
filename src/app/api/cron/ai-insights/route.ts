import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateStrategicInsights } from '@/lib/services/ai/claude'
import { buildIntelligencePayload } from '@/lib/services/ai/payload'
import { computeOpportunityScores } from '@/lib/services/scoring/opportunity'
import { startRefreshLog } from '@/lib/services/refresh-log'

export const maxDuration = 300 // 5 minutes

const TOP_OPPORTUNITY_COUNT = 8

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const log = await startRefreshLog('ai_insights', 'claude', 'cron')
  const supabase = await createServiceClient()

  // Step 1: opportunity scoring — persisted independently of AI generation
  // so a Claude failure never loses the freshly computed scores.
  let scoresResult: Awaited<ReturnType<typeof computeOpportunityScores>>
  try {
    scoresResult = await computeOpportunityScores(supabase)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, message)
    console.error('AI insights cron error (opportunity scoring):', err)
    return NextResponse.json(
      {
        success: false,
        error: message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }

  const topOpportunityScores = [...scoresResult.scores]
    .sort((a, b) => b.total_score - a.total_score)
    .slice(0, TOP_OPPORTUNITY_COUNT)

  // Step 2 onward: AI insight generation. If this fails, we still return the
  // persisted opportunity scores rather than a hard failure.
  try {
    const payload = await buildIntelligencePayload(supabase)
    const insights = await generateStrategicInsights(payload, topOpportunityScores)

    const { data: inserted, error: insertError } = await supabase
      .from('strategic_insights')
      .insert(insights)
      .select()

    if (insertError) {
      throw new Error(`Failed to insert insights: ${insertError.message}`)
    }

    await log.finalize('success', { inserted: (inserted?.length ?? 0) + scoresResult.persisted }, undefined, {
      scores: scoresResult.persisted,
      insights: inserted?.length ?? 0,
    })

    return NextResponse.json({
      success: true,
      opportunity_scores_computed: scoresResult.persisted,
      insights_generated: inserted?.length ?? 0,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('AI insights cron error (insight generation):', err)
    await log.finalize('partial', { inserted: scoresResult.persisted }, message, {
      scores: scoresResult.persisted,
      insights: 0,
    })

    // Opportunity scores were persisted successfully; only AI generation
    // failed. Report partial success rather than a total failure.
    return NextResponse.json(
      {
        success: false,
        partial: true,
        opportunity_scores_computed: scoresResult.persisted,
        insights_generated: 0,
        error: message,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: 207 }
    )
  }
}
