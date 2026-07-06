import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { REFRESH_MODULE_KEYS, runRefreshModule, isModuleRunning } from '@/lib/services/refresh/modules'

export const maxDuration = 300

const bodySchema = z.object({
  module: z.enum(REFRESH_MODULE_KEYS as [string, ...string[]]),
})

export async function POST(request: NextRequest) {
  // ─── Auth: session user must be admin or analyst ───────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userData || !['admin', 'analyst'].includes(userData.role)) {
    return NextResponse.json(
      { error: 'Insufficient permissions', message: 'Only admins and analysts can trigger a refresh.' },
      { status: 403 }
    )
  }

  // ─── Validate body ──────────────────────────────────────────────────────────
  let parsedBody: z.infer<typeof bodySchema>
  try {
    const json = await request.json()
    const result = bodySchema.safeParse(json)
    if (!result.success) {
      return NextResponse.json(
        { error: 'invalid_module', message: 'The module field must be one of the known refresh modules.' },
        { status: 400 }
      )
    }
    parsedBody = result.data
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be valid JSON with a module field.' },
      { status: 400 }
    )
  }

  const { module } = parsedBody

  // ─── Duplicate prevention ───────────────────────────────────────────────────
  const running = await isModuleRunning(module)
  if (running) {
    return NextResponse.json(
      {
        error: 'already_running',
        message: 'A refresh for this module is already running. Please wait for it to complete.',
        started_at: running.started_at,
      },
      { status: 409 }
    )
  }

  // ─── Run ────────────────────────────────────────────────────────────────────
  try {
    const triggeredBy = userData.role === 'admin' ? 'admin' : 'manual'
    const result = await runRefreshModule(module, triggeredBy)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: 'unexpected_error', message }, { status: 500 })
  }
}
