import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getSourceStatuses, updateSourceStatus, type SourceWithRuntime, type SourceStatus } from '@/lib/services/data-sources'

const VALID_STATUSES: SourceStatus[] = [
  'connected', 'working', 'partial', 'failed',
  'unavailable', 'manual_only', 'static_only', 'not_configured',
]

/**
 * GET /api/data-sources — list the operational status of every data source.
 * Requires an authenticated session (same pattern as /api/refresh/status).
 * Optional query params: module, status, source_type, provider, reliability, enabled.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const module = searchParams.get('module') ?? undefined
  const status = searchParams.get('status')
  const sourceType = searchParams.get('source_type')
  const provider = searchParams.get('provider')
  const reliability = searchParams.get('reliability')
  const enabled = searchParams.get('enabled')

  let sources: SourceWithRuntime[] = await getSourceStatuses(module)

  if (status) {
    sources = sources.filter((s) => s.status === status)
  }
  if (sourceType) {
    sources = sources.filter((s) => s.source_type === sourceType)
  }
  if (provider) {
    sources = sources.filter((s) => s.provider === provider)
  }
  if (reliability) {
    sources = sources.filter((s) => s.reliability_level === reliability)
  }
  if (enabled !== null) {
    const wantEnabled = enabled === 'true'
    sources = sources.filter((s) => s.is_enabled === wantEnabled)
  }

  return NextResponse.json({ data: sources })
}

interface PatchBody {
  source_key: string
  is_enabled?: boolean
  notes?: string
  status?: string
  verified?: boolean
}

/**
 * PATCH /api/data-sources — admin-only. Update a source's enabled flag,
 * notes, or status, OR mark a manual source as freshly verified.
 */
export async function PATCH(request: NextRequest) {
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

  if (!userData || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: PatchBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Request body must be valid JSON.' },
      { status: 400 }
    )
  }

  if (!body.source_key) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'source_key is required.' },
      { status: 400 }
    )
  }

  const service = await createServiceClient()

  if (body.verified === true) {
    // "Mark manual data as verified" — distinct from the generic patch below.
    const now = new Date().toISOString()
    const { error } = await service
      .from('data_sources')
      .update({ last_success_at: now, last_checked_at: now, error_message: null })
      .eq('source_key', body.source_key)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const [updated] = await getSourceStatuses().then((rows) =>
      rows.filter((r) => r.source_key === body.source_key)
    )
    return NextResponse.json({ data: updated ?? null })
  }

  // Generic field patch. updateSourceStatus's SourceStatusPatch type doesn't
  // cover is_enabled/notes, so we go through the Supabase client directly
  // for those, consistent with data-sources.ts's own internal style — but
  // route status changes through updateSourceStatus so last_checked_at is
  // stamped consistently with every other status-reporting call site.
  const directPatch: Record<string, unknown> = {}
  if (typeof body.is_enabled === 'boolean') directPatch.is_enabled = body.is_enabled
  if (typeof body.notes === 'string') directPatch.notes = body.notes

  const hasValidStatus = typeof body.status === 'string' && VALID_STATUSES.includes(body.status as SourceStatus)
  if (typeof body.status === 'string' && !hasValidStatus) {
    return NextResponse.json(
      { error: 'invalid_body', message: `status must be one of ${VALID_STATUSES.join(', ')}.` },
      { status: 400 }
    )
  }

  if (Object.keys(directPatch).length === 0 && !hasValidStatus) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'Provide at least one of is_enabled, notes, status, or verified.' },
      { status: 400 }
    )
  }

  if (hasValidStatus) {
    await updateSourceStatus(body.source_key, { status: body.status as SourceStatus })
  }

  if (Object.keys(directPatch).length > 0) {
    const { error } = await service
      .from('data_sources')
      .update(directPatch)
      .eq('source_key', body.source_key)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  const [updated] = await getSourceStatuses().then((rows) =>
    rows.filter((r) => r.source_key === body.source_key)
  )
  return NextResponse.json({ data: updated ?? null })
}
