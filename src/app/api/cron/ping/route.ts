import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const maxDuration = 30

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

  const results: Record<string, unknown> = {
    // Show first 40 chars to distinguish anon vs service role key
    anon_key_prefix: anonKey?.substring(0, 40),
    service_key_prefix: serviceKey?.substring(0, 40),
    keys_differ: anonKey !== serviceKey,
  }

  // Test with explicit service role client
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  // Try insert
  const { data: comp } = await supabase.from('competitors').select('id').limit(1)
  const { data: prof } = await supabase.from('social_profiles').select('id, platform').eq('active', true).limit(1)

  if (comp?.[0] && prof?.[0]) {
    const { error: insertErr } = await supabase.from('social_metrics').insert({
      profile_id: prof[0].id,
      competitor_id: comp[0].id,
      platform: prof[0].platform,
      followers: null,
      data_source: 'unavailable',
      error_message: 'ping_test',
    })
    results.insert_ok = !insertErr
    results.insert_error = insertErr?.message ?? null
    results.insert_code = insertErr?.code ?? null

    if (!insertErr) {
      await supabase.from('social_metrics').delete().eq('error_message', 'ping_test')
      results.cleanup = true
    }
  }

  return NextResponse.json({ ok: true, results })
}
