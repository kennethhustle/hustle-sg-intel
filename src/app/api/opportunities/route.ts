import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: scores, error } = await supabase
    .from('opportunity_scores')
    .select('*')
    .eq('is_current', true)
    .order('total_score', { ascending: false })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: scores ?? [] })
}
