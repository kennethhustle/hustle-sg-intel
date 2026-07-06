import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// ─── Auth helper ────────────────────────────────────────────────────────────
// Mirrors the exact lookup pattern used in src/app/api/insights/route.ts.
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

// ─── Shared field validation (same approach as the collection route) ──────────
function normalizeUrl(value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return value === '' ? null : value as null | undefined
  if (typeof value !== 'string') return value as never
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

const urlField = z.preprocess(
  normalizeUrl,
  z.string().url({ message: 'Must be a valid URL' }).nullable().optional()
)

const competitorUpdateSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').optional(),
  short_name: z.string().nullable().optional(),
  website: urlField,
  country: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  tier: z.enum(['High', 'Mid', 'Low']).optional(),
  color: z.string().nullable().optional(),
  active: z.boolean().optional(),
  notes: z.string().nullable().optional(),
  display_order: z.number().int().optional(),
  logo_url: z.string().nullable().optional(),
  is_hustle: z.boolean().optional(),

  facebook_url: urlField,
  instagram_url: urlField,
  linkedin_company_slug: z.string().nullable().optional(),
  tiktok_url: urlField,
  youtube_url: urlField,
  threads_url: urlField,
  twitter_url: urlField,

  google_business_name: z.string().nullable().optional(),
  review_url: urlField,
  google_maps_url: urlField,
  meta_ads_page: urlField,
  google_ads_domain: z.string().nullable().optional(),

  myskillsfuture_provider_name: z.string().nullable().optional(),
  mycareersfuture_name: z.string().nullable().optional(),

  meta_ads_count: z.number().int().nullable().optional(),
  google_ads_est: z.number().int().nullable().optional(),
  google_rating: z.number().nullable().optional(),
  google_review_count: z.number().int().nullable().optional(),

  archived_at: z.string().nullable().optional(),
  track_courses: z.boolean().optional(),
  track_hiring: z.boolean().optional(),
  track_marketing: z.boolean().optional(),
  track_social: z.boolean().optional(),
  track_seo: z.boolean().optional(),
  include_in_opportunity_engine: z.boolean().optional(),
})

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

// Child tables that reference competitors(id). Used to report affected-row
// counts before a hard delete so the UI can warn the admin.
const CHILD_TABLES_WITH_COMPETITOR_ID = [
  'sf_courses',
  'competitor_marketing_data',
  'job_postings',
  'social_snapshots',
  'seo_rankings',
  'data_refresh_logs',
  'competitor_data_sources',
  'social_profiles',
  'social_metrics',
  'course_catalog',
  'alerts',
  'marketing_snapshots',
  'social_content_themes',
] as const

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdmin()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const { id } = await params
  const supabase = await createServiceClient()
  const body = await req.json()

  // ── Restore branch — checked early, before generic field updates ──────────
  if (body && body.restore === true) {
    const { data, error } = await supabase
      .from('competitors')
      .update({ archived_at: null, active: true, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const parsed = competitorUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    )
  }

  const updatePayload: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() }

  // Regenerate slug if name changed, enforcing uniqueness (excluding self).
  if (parsed.data.name) {
    const slug = slugify(parsed.data.name)
    const { data: existing } = await supabase
      .from('competitors')
      .select('id')
      .eq('slug', slug)
      .neq('id', id)
      .maybeSingle()

    if (existing) {
      return NextResponse.json(
        { error: `A competitor with slug "${slug}" already exists. Choose a different name.` },
        { status: 409 }
      )
    }
    updatePayload.slug = slug
  }

  const { data, error } = await supabase
    .from('competitors')
    .update(updatePayload)
    .eq('id', id)
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
  const mode = searchParams.get('mode') // null (archive) | 'deactivate' | 'hard'

  const supabase = await createServiceClient()

  if (mode === 'deactivate') {
    const { error } = await supabase
      .from('competitors')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, mode: 'deactivate' })
  }

  if (mode === 'hard') {
    // Count related rows across child tables before deleting, so the UI can
    // show a warning about historical data being lost.
    const affected: Record<string, number> = {}
    for (const table of CHILD_TABLES_WITH_COMPETITOR_ID) {
      const { count } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('competitor_id', id)
      affected[table] = count ?? 0
    }

    const { error } = await supabase
      .from('competitors')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, mode: 'hard', affected_rows: affected })
  }

  // Default: archive — set archived_at = now(), active = false.
  // Preserves all historical intelligence data.
  const { error } = await supabase
    .from('competitors')
    .update({ archived_at: new Date().toISOString(), active: false, updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, mode: 'archive' })
}
