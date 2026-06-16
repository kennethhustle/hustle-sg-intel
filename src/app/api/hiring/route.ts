import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const competitorId = searchParams.get('competitor_id')
  const source = searchParams.get('source')
  const activeOnly = searchParams.get('active') !== 'false'
  const limit = parseInt(searchParams.get('limit') ?? '100', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let query = supabase
    .from('job_postings')
    .select(`
      *,
      competitors (id, name, slug, color, is_hustle, tier)
    `, { count: 'exact' })
    .order('scraped_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (activeOnly) {
    query = query.eq('is_active', true)
  }
  if (competitorId) {
    query = query.eq('competitor_id', competitorId)
  }
  if (source) {
    query = query.eq('source', source)
  }

  const { data: jobs, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get hiring velocity: jobs posted per week per competitor (last 30 days)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const { data: recentJobs } = await supabase
    .from('job_postings')
    .select('competitor_id, scraped_at, competitors(name)')
    .eq('is_active', true)
    .gte('scraped_at', thirtyDaysAgo)

  // Build velocity map
  const velocityMap = new Map<string, number>()
  for (const job of (recentJobs ?? [])) {
    const cid = job.competitor_id
    velocityMap.set(cid, (velocityMap.get(cid) ?? 0) + 1)
  }

  // Get source breakdown
  const { data: sourceCounts } = await supabase
    .from('job_postings')
    .select('source, competitor_id')
    .eq('is_active', true)

  const sourceBreakdown: Record<string, number> = {}
  for (const row of (sourceCounts ?? [])) {
    sourceBreakdown[row.source] = (sourceBreakdown[row.source] ?? 0) + 1
  }

  return NextResponse.json({
    data: jobs ?? [],
    total: count ?? 0,
    velocity: Object.fromEntries(velocityMap),
    source_breakdown: sourceBreakdown,
  })
}
