import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { runMarketingRefresh } from '@/lib/services/marketing/refresh'

export const maxDuration = 300

export async function POST() {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const startTime = Date.now()
  try {
    const result = await runMarketingRefresh('manual')
    return NextResponse.json({
      success: true,
      result,
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - startTime,
      timestamp: new Date().toISOString(),
    }, { status: 500 })
  }
}
