import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { startRefreshLog } from '@/lib/services/refresh-log'
import { runAiInsightsFlow } from '@/lib/services/refresh/modules'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const log = await startRefreshLog('ai_insights', 'claude', 'cron')
  const supabase = await createServiceClient()

  // Score -> payload -> generate -> insert flow shared with the on-demand
  // module runner (src/lib/services/refresh/modules.ts::runAiInsightsFlow).
  const flowResult = await runAiInsightsFlow(supabase)

  if (flowResult.status === 'failed') {
    await log.finalize('failed', undefined, flowResult.error)
    console.error('AI insights cron error (opportunity scoring):', flowResult.error)
    return NextResponse.json(
      {
        success: false,
        error: flowResult.error,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }

  if (flowResult.status === 'partial') {
    console.error('AI insights cron error (insight generation):', flowResult.error)
    await log.finalize('partial', flowResult.counts, flowResult.error, flowResult.metadata)

    // Opportunity scores were persisted successfully; only AI generation
    // failed. Report partial success rather than a total failure.
    return NextResponse.json(
      {
        success: false,
        partial: true,
        opportunity_scores_computed: flowResult.metadata.scores,
        insights_generated: 0,
        error: flowResult.error,
        duration_ms: Date.now() - startTime,
        timestamp: new Date().toISOString(),
      },
      { status: 207 }
    )
  }

  await log.finalize('success', flowResult.counts, undefined, flowResult.metadata)

  return NextResponse.json({
    success: true,
    opportunity_scores_computed: flowResult.metadata.scores,
    insights_generated: flowResult.metadata.insights,
    duration_ms: Date.now() - startTime,
    timestamp: new Date().toISOString(),
  })
}
