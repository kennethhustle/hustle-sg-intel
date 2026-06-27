import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { generateSeoInsights, stampInsightsWithSession } from '@/lib/services/ai/claude'
import { gatherSeoIntelligence } from '@/lib/services/ai/seo-data'

export const maxDuration = 300 // 5 minutes

/**
 * Daily Search Intelligence (SEO) generation. Mirrors the ai-insights cron but
 * gathers internal SEO data and tags the run with metadata.module = 'seo' so it
 * stays isolated from Opportunity Engine. Reuses the same Gemini service,
 * strategic_insights table and session mechanism — no schema change.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()

  try {
    const supabase = await createServiceClient()

    const payload = await gatherSeoIntelligence(supabase)
    const insights = await generateSeoInsights(payload)

    const generationMs = Date.now() - startTime
    const { sessionId, insights: stampedInsights } = stampInsightsWithSession(insights, {
      source: 'cron',
      durationMs: generationMs,
      module: 'seo',
    })

    const { data: inserted, error: insertError } = await supabase
      .from('strategic_insights')
      .insert(stampedInsights)
      .select()

    if (insertError) {
      throw new Error(`Failed to insert insights: ${insertError.message}`)
    }

    const duration = Date.now() - startTime
    return NextResponse.json({
      success: true,
      session_id: sessionId,
      insights_generated: inserted?.length ?? 0,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    const duration = Date.now() - startTime
    console.error('SEO insights cron error:', err)
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
