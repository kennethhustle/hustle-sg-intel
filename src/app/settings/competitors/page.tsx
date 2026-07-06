import { createClient, createServiceClient } from '@/lib/supabase/server'
import { AppLayout } from '@/components/layout/app-layout'
import { CompetitorsAdmin } from './competitors-admin'

export const revalidate = 0

export type Competitor = {
  id: string
  name: string
  slug: string
  short_name: string | null
  website: string
  color: string
  tier: string | null
  active: boolean
  is_hustle: boolean
  country: string | null
  industry: string | null
  notes: string | null
  logo_url: string | null
  display_order: number
  // Social
  facebook_url: string | null
  instagram_url: string | null
  linkedin_company_slug: string | null
  tiktok_url: string | null
  youtube_url: string | null
  threads_url: string | null
  twitter_url: string | null
  // Intelligence links
  google_business_name: string | null
  review_url: string | null
  google_maps_url: string | null
  meta_ads_page: string | null
  google_ads_domain: string | null
  // Platform integration
  myskillsfuture_provider_name: string | null
  mycareersfuture_name: string | null
  // Ads data
  meta_ads_count: number
  google_ads_est: number
  google_rating: number | null
  google_review_count: number | null
  // Archive + module tracking (migration 006)
  archived_at: string | null
  track_courses: boolean
  track_hiring: boolean
  track_marketing: boolean
  track_social: boolean
  track_seo: boolean
  include_in_opportunity_engine: boolean
  // Timestamps
  created_at: string
  updated_at: string
  // Joined
  social_profiles?: { platform: string; handle: string; active: boolean }[]
}

async function getData(): Promise<Competitor[]> {
  const supabase = await createServiceClient()
  const { data, error } = await supabase
    .from('competitors')
    .select('*, social_profiles(platform, handle, active)')
    .order('display_order', { ascending: true })
    .order('name', { ascending: true })

  if (error) {
    console.error('Failed to load competitors:', error.message)
    return []
  }
  return (data ?? []) as Competitor[]
}

async function getCurrentUserRole(): Promise<string> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return 'viewer'

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  return userData?.role ?? 'viewer'
}

export type HealthAuxData = {
  mysfAliasCompetitorIds: string[]
  latestRefreshByCompetitor: Record<string, { status: string; started_at: string }>
  googleAdsVerifiedAtByCompetitor: Record<string, string | null>
}

// Auxiliary data used to extend the Data Health badge computation on the client:
// (a) myskillsfuture aliases from competitor_data_sources,
// (b) latest data_refresh_logs status per competitor,
// (c) google_ads_verified_at per competitor (for the 30-day staleness check).
async function getHealthAuxData(): Promise<HealthAuxData> {
  const supabase = await createServiceClient()

  const [sourcesRes, logsRes, mktRes] = await Promise.all([
    supabase
      .from('competitor_data_sources')
      .select('competitor_id')
      .eq('source_type', 'myskillsfuture')
      .eq('is_active', true),
    supabase
      .from('data_refresh_logs')
      .select('competitor_id, status, started_at')
      .not('competitor_id', 'is', null)
      .order('started_at', { ascending: false }),
    supabase
      .from('competitor_marketing_data')
      .select('competitor_id, google_ads_verified_at'),
  ])

  const mysfAliasCompetitorIds = Array.from(
    new Set((sourcesRes.data ?? []).map((r) => r.competitor_id as string))
  )

  // Keep only the most recent log row per competitor (data is already ordered desc).
  const latestRefreshByCompetitor: Record<string, { status: string; started_at: string }> = {}
  for (const row of (logsRes.data ?? [])) {
    const cid = row.competitor_id as string
    if (!latestRefreshByCompetitor[cid]) {
      latestRefreshByCompetitor[cid] = { status: row.status as string, started_at: row.started_at as string }
    }
  }

  const googleAdsVerifiedAtByCompetitor: Record<string, string | null> = {}
  for (const row of (mktRes.data ?? [])) {
    googleAdsVerifiedAtByCompetitor[row.competitor_id as string] = row.google_ads_verified_at as string | null
  }

  return { mysfAliasCompetitorIds, latestRefreshByCompetitor, googleAdsVerifiedAtByCompetitor }
}

export default async function CompetitorsPage() {
  const [competitors, role, healthAux] = await Promise.all([
    getData(),
    getCurrentUserRole(),
    getHealthAuxData(),
  ])
  return (
    <AppLayout title="Competitor Management">
      <CompetitorsAdmin initialCompetitors={competitors} currentUserRole={role} healthAux={healthAux} />
    </AppLayout>
  )
}
