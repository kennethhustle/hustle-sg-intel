import { NextResponse } from 'next/server'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'

export const maxDuration = 300 // 5 minutes

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    const result = await scrapeAndUpdateRunCounts()
    const duration = Date.now() - startTime

    return NextResponse.json({
      success: true,
      result,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error('Run count refresh cron error:', err)
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
