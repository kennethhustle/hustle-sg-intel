import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getRefreshHealth } from '@/lib/services/refresh-log'
import { isAnyRefreshRunning } from '@/lib/services/refresh/modules'
import { getSourceStatuses, computeDataConfidence } from '@/lib/services/data-sources'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [health, running, sources, confidence] = await Promise.all([
    getRefreshHealth(),
    isAnyRefreshRunning(),
    getSourceStatuses(),
    computeDataConfidence(),
  ])

  const service = await createServiceClient()
  const { data: lastCompleted } = await service
    .from('data_refresh_logs')
    .select('completed_at')
    .in('status', ['success', 'partial'])
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Bucket the real status enum ('connected','working','partial','failed',
  // 'unavailable','manual_only','static_only','not_configured') into the
  // five summary buckets the UI expects. Mapping decisions:
  //  - working -> working
  //  - partial -> partial
  //  - unavailable AND failed -> unavailable (both represent a broken/blocked source)
  //  - manual_only AND static_only -> manual
  //  - not_configured -> not_configured
  //  - connected (configured, no successful run yet) is counted as manual's
  //    neighbour bucket "working" would overstate it and "not_configured"
  //    would understate it, so it's folded into partial (configured but
  //    unproven), matching computeDataConfidence's own treatment of
  //    'connected' as a partial-credit state.
  const sourceCounts = {
    working: 0,
    partial: 0,
    unavailable: 0,
    manual: 0,
    not_configured: 0,
  }
  for (const s of sources) {
    switch (s.status) {
      case 'working':
        sourceCounts.working++
        break
      case 'partial':
      case 'connected':
        sourceCounts.partial++
        break
      case 'failed':
      case 'unavailable':
        sourceCounts.unavailable++
        break
      case 'manual_only':
      case 'static_only':
        sourceCounts.manual++
        break
      case 'not_configured':
        sourceCounts.not_configured++
        break
    }
  }

  return NextResponse.json({
    overall: health.overall,
    modules: health.modules,
    running,
    last_updated: (lastCompleted?.completed_at as string | undefined) ?? null,
    sources: sourceCounts,
    confidence: { score: confidence.score, breakdown: confidence.breakdown },
  })
}
