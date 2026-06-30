import { createServiceClient } from '@/lib/supabase/server'
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

export default async function CompetitorsPage() {
  const competitors = await getData()
  return (
    <AppLayout title="Competitor Management">
      <CompetitorsAdmin initialCompetitors={competitors} />
    </AppLayout>
  )
}
