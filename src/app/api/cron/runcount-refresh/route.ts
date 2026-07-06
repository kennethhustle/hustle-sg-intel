import { NextResponse } from 'next/server'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'
import { runCourseIntelligencePipeline } from '@/lib/services/courses/intelligence'
import { startRefreshLog } from '@/lib/services/refresh-log'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const log = await startRefreshLog('runcounts', 'runcount-refresh', 'cron')

  try {
    const result = await scrapeAndUpdateRunCounts()
    const duration = Date.now() - startTime

    // Post-refresh computation: demand scores, change detection, snapshots,
    // threat scores, opportunity scores. Failures here are non-fatal — they
    // never fail the run-count refresh itself, just get logged in metadata.
    let pipelineResult: { changes: number; snapshots: number; threats: number } | null = null
    let pipelineError: string | null = null
    try {
      pipelineResult = await runCourseIntelligencePipeline()
    } catch (pipelineErr) {
      pipelineError = pipelineErr instanceof Error ? pipelineErr.message : String(pipelineErr)
      console.error('runcount-refresh: course intelligence pipeline failed:', pipelineError)
    }

    await log.finalize(
      result.errors > 0 ? 'partial' : 'success',
      { fetched: result.scraped, updated: result.updated, failed: result.errors },
      result.errors > 0
        ? result.results.filter((r) => r.error).map((r) => `${r.sf_ref_no}: ${r.error}`).join(' | ')
        : null,
      { intelligence_pipeline: pipelineResult, intelligence_pipeline_error: pipelineError }
    )

    return NextResponse.json({
      success: true,
      result,
      intelligence_pipeline: pipelineResult,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error('Run count refresh cron error:', err)
    const errMsg = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, errMsg)
    return NextResponse.json(
      {
        success: false,
        error: errMsg,
        duration_ms: duration,
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}
