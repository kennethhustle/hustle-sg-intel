import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const revalidate = 0

export async function GET() {
  const supabase = await createClient()

  const { data: logs, error } = await supabase
    .from('data_refresh_logs')
    .select('id, status, started_at, completed_at, triggered_by, records_updated, duration_seconds, error_message, metadata')
    .eq('module', 'marketing')
    .order('started_at', { ascending: false })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const latestLog = logs?.[0] ?? null
  const lastSuccessfulLog = logs?.find(l => l.status === 'success') ?? null

  return NextResponse.json({ latestLog, lastSuccessfulLog })
}
