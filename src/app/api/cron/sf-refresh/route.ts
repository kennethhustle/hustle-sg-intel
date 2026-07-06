import { NextResponse } from 'next/server'
import { ingestAllSFCourses } from '@/lib/services/ingestion/sf_courses'
import { startRefreshLog } from '@/lib/services/refresh-log'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const startTime = Date.now()
  const log = await startRefreshLog('sf_courses', 'sf-refresh', 'cron')

  try {
    const result = await ingestAllSFCourses()
    const hasErrors = result.results.some((r) => r.error !== null)
    await log.finalize(
      hasErrors ? 'partial' : 'success',
      { fetched: result.total_found, inserted: result.total_upserted },
      hasErrors ? result.results.filter((r) => r.error).map((r) => `${r.competitor_name}: ${r.error}`).join(' | ') : null,
      { deactivated: result.deactivated, results: result.results }
    )
    return NextResponse.json({
      success: true, result,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('SF refresh cron error:', err)
    const errMsg = err instanceof Error ? err.message : String(err)
    await log.finalize('failed', undefined, errMsg)
    return NextResponse.json(
      { success: false, error: errMsg, duration_ms: Date.now() - startTime },
      { status: 500 }
    )
  }
}
