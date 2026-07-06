import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRefreshHealth } from '@/lib/services/refresh-log'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const health = await getRefreshHealth()
  return NextResponse.json(health)
}
