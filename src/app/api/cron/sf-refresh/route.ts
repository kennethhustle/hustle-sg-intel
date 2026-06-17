import { NextResponse } from 'next/server'
import { ingestAllSFCourses } from '@/lib/services/ingestion/sf_courses'

export const maxDuration = 300

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const startTime = Date.now()
  try {
    const result = await ingestAllSFCourses()
    return NextResponse.json({
      success: true, result,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('SF refresh cron error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err), duration_ms: Date.now() - startTime },
      { status: 500 }
    )
  }
}
