import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const unreadOnly = searchParams.get('unread') === 'true'
  const severity = searchParams.get('severity')
  const competitorId = searchParams.get('competitor_id')
  const limit = parseInt(searchParams.get('limit') ?? '50', 10)
  const offset = parseInt(searchParams.get('offset') ?? '0', 10)

  let query = supabase
    .from('alerts')
    .select(`
      *,
      competitors (id, name, slug, color, is_hustle)
    `, { count: 'exact' })
    .eq('is_dismissed', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (unreadOnly) {
    query = query.eq('is_read', false)
  }
  if (severity) {
    query = query.eq('severity', severity)
  }
  if (competitorId) {
    query = query.eq('competitor_id', competitorId)
  }

  const { data: alerts, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Get unread count
  const { count: unreadCount } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)
    .eq('is_dismissed', false)

  return NextResponse.json({
    data: alerts ?? [],
    total: count ?? 0,
    unread_count: unreadCount ?? 0,
  })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const body = await request.json()
  const { id, ids, is_read, is_dismissed } = body

  if (!id && (!ids || !Array.isArray(ids))) {
    return NextResponse.json(
      { error: 'Provide either id or ids array' },
      { status: 400 }
    )
  }

  const updates: Record<string, boolean> = {}
  if (typeof is_read === 'boolean') updates.is_read = is_read
  if (typeof is_dismissed === 'boolean') updates.is_dismissed = is_dismissed

  if (Object.keys(updates).length === 0) {
    return NextResponse.json(
      { error: 'Provide is_read or is_dismissed to update' },
      { status: 400 }
    )
  }

  let query = supabase.from('alerts').update(updates)

  if (id) {
    query = query.eq('id', id)
  } else {
    query = query.in('id', ids)
  }

  const { data, error } = await query.select()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data })
}
