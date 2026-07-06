import { NextResponse } from 'next/server'
import { ingestAllJobs } from '@/lib/services/ingestion/jobs'
import { startRefreshLog } from '@/lib/services/refresh-log'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const log = await startRefreshLog('hiring', 'hiring-refresh', 'cron')

  try {
    const result = await ingestAllJobs()
    const duration = Date.now() - startTime

    const totalFound = result.results.reduce((sum, r) => sum + r.jobs_found, 0)
    const anyErrors = result.results.some((r) => r.error !== null)

    await log.finalize(
      anyErrors ? 'partial' : 'success',
      { fetched: totalFound, inserted: result.total_jobs_inserted },
      anyErrors
        ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}/${r.source}: ${r.error}`).join(' | ')
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
    console.error('Hiring refresh cron error:', err)
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
