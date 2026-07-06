import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// ─── Auth helper ────────────────────────────────────────────────────────────
// Same lookup pattern as src/app/api/competitors/route.ts and
// src/app/api/insights/route.ts (same auth client, same users.role column).
async function requireAdmin(): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { ok: false, status: 401, error: 'Unauthorized' }
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userData || userData.role !== 'admin') {
    return { ok: false, status: 403, error: 'Insufficient permissions — admin role required' }
  }

  return { ok: true }
}

const SOURCE_TYPES = [
  'myskillsfuture', 'mycareersfuture', 'google_business', 'meta_ads',
  'google_ads', 'jobstreet', 'indeed', 'careers_page', 'website', 'social', 'seo_domain',
] as const

const createSourceSchema = z.object({
  source_type: z.enum(SOURCE_TYPES),
  identifier: z.string().trim().min(1, 'Identifier is required'),
  platform: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
})

const patchSourceSchema = z.object({
  id: z.string().uuid('id must be a valid UUID'),
  source_type: z.enum(SOURCE_TYPES).optional(),
  identifier: z.string().trim().min(1, 'Identifier is required').optional(),
  platform: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  is_primary: z.boolean().optional(),
  is_active: z.boolean().optional(),
  last_verified_at: z.string().nullable().optional(),
})

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('competitor_data_sources')
    .select('*')
    .eq('competitor_id', id)
    .order('source_type', { ascending: true })
    .order('is_primary', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = createSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    )
  }

  const supabase = await createServiceClient()

  const { data: existing } = await supabase
    .from('competitor_data_sources')
    .select('id')
    .eq('competitor_id', id)
    .eq('source_type', parsed.data.source_type)
    .eq('identifier', parsed.data.identifier)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `A ${parsed.data.source_type} source with identifier "${parsed.data.identifier}" already exists for this competitor.` },
      { status: 409 }
    )
  }

  const { data, error } = await supabase
    .from('competitor_data_sources')
    .insert({
      competitor_id: id,
      source_type: parsed.data.source_type,
      identifier: parsed.data.identifier,
      platform: parsed.data.platform ?? null,
      url: parsed.data.url ?? null,
      notes: parsed.data.notes ?? null,
      is_primary: parsed.data.is_primary ?? false,
      is_active: parsed.data.is_active ?? true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params
  const body = await req.json()
  const parsed = patchSourceSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    )
  }

  const { id: sourceId, ...fields } = parsed.data
  const supabase = await createServiceClient()

  const { data, error } = await supabase
    .from('competitor_data_sources')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', sourceId)
    .eq('competitor_id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params
  const { searchParams } = new URL(req.url)
  const sourceId = searchParams.get('sourceId')

  if (!sourceId) {
    return NextResponse.json({ error: 'sourceId query param is required' }, { status: 400 })
  }

  const supabase = await createServiceClient()
  const { error } = await supabase
    .from('competitor_data_sources')
    .delete()
    .eq('id', sourceId)
    .eq('competitor_id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
