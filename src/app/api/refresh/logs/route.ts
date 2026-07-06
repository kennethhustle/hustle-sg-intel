import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const module = searchParams.get('module')
  const trigger = searchParams.get('trigger')
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const limitParam = parseInt(searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10)
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), MAX_LIMIT) : DEFAULT_LIMIT

  const offsetParam = parseInt(searchParams.get('offset') ?? '0', 10)
  const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0

  const service = await createServiceClient()

  let query = service
    .from('data_refresh_logs')
    .select('*', { count: 'exact' })
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)
  if (module) query = query.eq('module', module)
  if (trigger) query = query.eq('triggered_by', trigger)
  if (from) query = query.gte('started_at', from)
  if (to) query = query.lte('started_at', to)

  const { data, count, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ data: data ?? [], count: count ?? 0 })
}
