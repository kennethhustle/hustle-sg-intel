import { NextResponse } from 'next/server'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'
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

    await log.finalize(
      result.errors > 0 ? 'partial' : 'success',
      { fetched: result.scraped, updated: result.updated, failed: result.errors },
      result.errors > 0
        ? result.results.filter((r) => r.error).map((r) => `${r.sf_ref_no}: ${r.error}`).join(' | ')
        : null
    )

    return NextResponse.json({
      success: true,
      result,
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
