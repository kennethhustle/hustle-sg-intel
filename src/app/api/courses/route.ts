import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const competitorId = searchParams.get('competitor_id')
  const sfOnly = searchParams.get('skillsfuture') === 'true'
  const category = searchParams.get('category')
  const limit = parseInt(searchParams.get('limit') ?? '100', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let query = supabase
    .from('course_catalog')
    .select(`
      *,
      competitors (id, name, slug, color, is_hustle, tier)
    `, { count: 'exact' })
    .eq('is_active', true)
    .order('scraped_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (competitorId) {
    query = query.eq('competitor_id', competitorId)
  }
  if (sfOnly) {
    query = query.eq('is_skillsfuture_claimable', true)
  }
  if (category) {
    query = query.ilike('category', `%${category}%`)
  }

  const { data: courses, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get per-competitor course counts
  const { data: countData } = await supabase
    .from('course_catalog')
    .select('competitor_id, is_skillsfuture_claimable, competitors(name)')
    .eq('is_active', true)

  const courseCountByCompetitor: Record<string, { total: number; sf_claimable: number; name: string }> = {}
  for (const row of (countData ?? [])) {
    const cid = row.competitor_id
    const compName = (row.competitors as { name: string } | null)?.name ?? cid
    if (!courseCountByCompetitor[cid]) {
      courseCountByCompetitor[cid] = { total: 0, sf_claimable: 0, name: compName }
    }
    courseCountByCompetitor[cid].total++
    if (row.is_skillsfuture_claimable) {
      courseCountByCompetitor[cid].sf_claimable++
    }
  }

  // Get category distribution
  const { data: categoryData } = await supabase
    .from('course_catalog')
    .select('category')
    .eq('is_active', true)
    .not('category', 'is', null)

  const categoryDistribution: Record<string, number> = {}
  for (const row of (categoryData ?? [])) {
    if (row.category) {
      categoryDistribution[row.category] = (categoryDistribution[row.category] ?? 0) + 1
    }
  }

  return NextResponse.json({
    data: courses ?? [],
    total: count ?? 0,
    counts_by_competitor: courseCountByCompetitor,
    category_distribution: categoryDistribution,
  })
}
