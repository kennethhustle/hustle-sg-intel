import { NextResponse } from 'next/server'
import { ingestAllSocial } from '@/lib/services/ingestion/social'
import { startRefreshLog } from '@/lib/services/refresh-log'
import { generateDataAlerts } from '@/lib/services/alerts/generate'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const log = await startRefreshLog('social', 'social-refresh', 'cron')

  let socialResult
  try {
    socialResult = await ingestAllSocial()
    const duration = Date.now() - startTime

    await log.finalize(
      socialResult.failed > 0 ? 'partial' : 'success',
      { fetched: socialResult.total, updated: socialResult.successful, failed: socialResult.failed },
      socialResult.failed > 0
        ? socialResult.results.filter((r) => r.error).map((r) => `${r.competitor_name}/${r.platform}: ${r.error}`).join(' | ')
        : null
    )

    // Social is the last data job of the nightly sequence (sf -> runcounts ->
    // marketing -> hiring -> social), so this is where we run rule-based alert
    // generation across the whole night's data. Isolated in its own try/catch
    // and logged under module 'alerts' so a failure here never masks the
    // social refresh result above.
    const alertsLog = await startRefreshLog('alerts', 'generate-data-alerts', 'cron')
    try {
      const alertsResult = await generateDataAlerts()
      await alertsLog.finalize('success', { inserted: alertsResult.created })
    } catch (alertErr) {
      console.error('generateDataAlerts error:', alertErr)
      await alertsLog.finalize('failed', undefined, alertErr instanceof Error ? alertErr.message : String(alertErr))
    }

    return NextResponse.json({
      success: true,
      result: socialResult,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error('Social refresh cron error:', err)
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
