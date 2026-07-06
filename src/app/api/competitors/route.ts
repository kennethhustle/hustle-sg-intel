import { createClient, createServiceClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

// ─── Auth helper ────────────────────────────────────────────────────────────
// Mirrors the exact lookup pattern used in src/app/api/insights/route.ts:
// same user-session client, same `users` table/`role` column.
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

// ─── Shared field validation ────────────────────────────────────────────────
// URL fields: if the value doesn't start with http(s)://, prepend https://
// server-side before validating with z.string().url().
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

const competitorBaseSchema = z.object({
  name: z.string().trim().min(1, 'Name is required'),
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

  // Social URLs
  facebook_url: urlField,
  instagram_url: urlField,
  linkedin_company_slug: z.string().nullable().optional(),
  tiktok_url: urlField,
  youtube_url: urlField,
  threads_url: urlField,
  twitter_url: urlField,

  // Intelligence links
  google_business_name: z.string().nullable().optional(),
  review_url: urlField,
  google_maps_url: urlField,
  meta_ads_page: urlField,
  google_ads_domain: z.string().nullable().optional(),

  // Platform integration
  myskillsfuture_provider_name: z.string().nullable().optional(),
  mycareersfuture_name: z.string().nullable().optional(),

  // Ads data
  meta_ads_count: z.number().int().nullable().optional(),
  google_ads_est: z.number().int().nullable().optional(),
  google_rating: z.number().nullable().optional(),
  google_review_count: z.number().int().nullable().optional(),

  // Archive + module tracking
  archived_at: z.string().nullable().optional(),
  track_courses: z.boolean().optional(),
  track_hiring: z.boolean().optional(),
  track_marketing: z.boolean().optional(),
  track_social: z.boolean().optional(),
  track_seo: z.boolean().optional(),
  include_in_opportunity_engine: z.boolean().optional(),
})

const TRACK_DEFAULTS = {
  track_courses: true,
  track_hiring: true,
  track_marketing: true,
  track_social: true,
  track_seo: true,
  include_in_opportunity_engine: true,
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export async function GET() {
  // GET remains available to any authenticated user (existing behavior preserved).
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('competitors')
    .select('*, social_profiles(platform, handle, active)')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const authResult = await requireAdmin()
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status })
  }

  const body = await req.json()
  const parsed = competitorBaseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ') },
      { status: 400 }
    )
  }

  const supabase = await createServiceClient()
  const slug = slugify(parsed.data.name)

  // Slug uniqueness check
  const { data: existing } = await supabase
    .from('competitors')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: `A competitor with slug "${slug}" already exists. Choose a different name.` },
      { status: 409 }
    )
  }

  const insertPayload = {
    ...parsed.data,
    slug,
    active: parsed.data.active ?? true,
    track_courses: parsed.data.track_courses ?? TRACK_DEFAULTS.track_courses,
    track_hiring: parsed.data.track_hiring ?? TRACK_DEFAULTS.track_hiring,
    track_marketing: parsed.data.track_marketing ?? TRACK_DEFAULTS.track_marketing,
    track_social: parsed.data.track_social ?? TRACK_DEFAULTS.track_social,
    track_seo: parsed.data.track_seo ?? TRACK_DEFAULTS.track_seo,
    include_in_opportunity_engine: parsed.data.include_in_opportunity_engine ?? TRACK_DEFAULTS.include_in_opportunity_engine,
  }

  const { data, error } = await supabase
    .from('competitors')
    .insert(insertPayload)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
