import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getRefreshHealth } from '@/lib/services/refresh-log'
import { isAnyRefreshRunning } from '@/lib/services/refresh/modules'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const [health, running] = await Promise.all([
    getRefreshHealth(),
    isAnyRefreshRunning(),
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

  return NextResponse.json({
    overall: health.overall,
    modules: health.modules,
    running,
    last_updated: (lastCompleted?.completed_at as string | undefined) ?? null,
  })
}
