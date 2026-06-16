import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: competitors, error } = await supabase
    .from('competitors')
    .select(`
      *,
      social_profiles (*)
    `)
    .eq('active', true)
    .order('name')

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // For each competitor, fetch their latest social metrics per platform
  const competitorsWithMetrics = await Promise.all(
    (competitors ?? []).map(async (competitor) => {
      const { data: metrics } = await supabase
        .rpc('get_latest_social_metrics', { competitor_uuid: competitor.id })

      return {
        ...competitor,
        latest_metrics: metrics ?? [],
      }
    })
  )

  return NextResponse.json({ data: competitorsWithMetrics })
}
