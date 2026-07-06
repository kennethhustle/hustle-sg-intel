import { createServiceClient } from '@/lib/supabase/server'
import { scrapeInstagram } from '@/lib/services/social/instagram'
import { scrapeYouTube } from '@/lib/services/social/youtube'
import { scrapeFacebook } from '@/lib/services/social/facebook'
import { scrapeLinkedIn } from '@/lib/services/social/linkedin'
import { scrapeTikTok } from '@/lib/services/social/tiktok'
import type { Platform } from '@/lib/types'
import { reportSourceSuccess, reportSourceFailure, updateSourceStatus } from '@/lib/services/data-sources'

interface IngestionResult {
  competitor_id: string
  competitor_name: string
  platform: Platform
  success: boolean
  followers: number | null
  error: string | null
}

interface OverallResult {
  total: number
  successful: number
  failed: number
  results: IngestionResult[]
  alerts_created: number
}

export async function ingestAllSocial(competitorId?: string): Promise<OverallResult> {
  const supabase = await createServiceClient()

  // Fetch all active, non-archived competitors (that opt into social tracking)
  // with their social profiles
  let query = supabase
    .from('competitors')
    .select(`
      id,
      name,
      slug,
      is_hustle,
      social_profiles (
        id,
        platform,
        handle,
        url,
        active
      )
    `)
    .eq('active', true)
    .is('archived_at', null)
    .eq('track_social', true)

  if (competitorId) query = query.eq('id', competitorId)

  const { data: competitors, error: competitorsError } = await query

  if (competitorsError || !competitors) {
    throw new Error(`Failed to fetch competitors: ${competitorsError?.message}`)
  }

  const results: IngestionResult[] = []
  let alertsCreated = 0

  for (const competitor of competitors) {
    const profiles = (competitor.social_profiles as Array<{
      id: string
      platform: Platform
      handle: string | null
      url: string | null
      active: boolean
    }>).filter((p) => p.active && p.handle)

    for (const profile of profiles) {
      const result = await scrapePlatform(profile.platform, profile.handle!, profile.url)

      // Get previous metric to detect changes
      const { data: prevMetric } = await supabase
        .from('social_metrics')
        .select('followers')
        .eq('profile_id', profile.id)
        .order('scraped_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      const followerCount = result.data?.followers ?? result.data?.subscribers ?? null
      const postsCount = result.data?.posts_count ?? result.data?.videos ?? null

      // Insert into social_metrics (legacy, detailed)
      const { error: insertError } = await supabase.from('social_metrics').insert({
        profile_id: profile.id,
        competitor_id: competitor.id,
        platform: profile.platform,
        followers: followerCount,
        following: result.data?.following ?? null,
        posts_count: postsCount,
        engagement_rate: null,
        data_source: result.success ? 'scraped' : 'unavailable',
        error_message: result.error,
      })

      // Upsert into social_snapshots (new, for dashboard)
      if (result.success && followerCount !== null) {
        await supabase.from('social_snapshots').upsert({
          competitor_id: competitor.id,
          platform: profile.platform,
          follower_count: followerCount,
          total_posts: postsCount,
          data_confidence: profile.platform === 'youtube' ? 'high' : 'medium',
          snapshot_date: new Date().toISOString().split('T')[0],
          scraped_at: new Date().toISOString(),
        }, { onConflict: 'competitor_id,platform,snapshot_date' })
      }

      if (insertError) {
        console.error(`Failed to insert metric for ${competitor.name} ${profile.platform}:`, insertError)
      }

      const currentFollowers =
        result.data?.followers ?? result.data?.subscribers ?? null
      const prevFollowers = prevMetric?.followers ?? null

      // Create alert if followers changed by more than 10%
      if (
        result.success &&
        currentFollowers !== null &&
        prevFollowers !== null &&
        prevFollowers > 0
      ) {
        const changePercent =
          ((currentFollowers - prevFollowers) / prevFollowers) * 100

        if (Math.abs(changePercent) >= 10) {
          const isGrowth = changePercent > 0
          const { error: alertError } = await supabase.from('alerts').insert({
            competitor_id: competitor.id,
            alert_type: 'social_follower_change',
            severity: Math.abs(changePercent) >= 25 ? 'high' : 'medium',
            title: `${competitor.name} ${profile.platform} followers ${isGrowth ? 'up' : 'down'} ${Math.abs(changePercent).toFixed(1)}%`,
            description: `${competitor.name}'s ${profile.platform} followers changed from ${prevFollowers.toLocaleString()} to ${currentFollowers.toLocaleString()} (${isGrowth ? '+' : ''}${changePercent.toFixed(1)}%)`,
            metadata: {
              platform: profile.platform,
              previous_followers: prevFollowers,
              current_followers: currentFollowers,
              change_percent: changePercent,
            },
          })

          if (!alertError) alertsCreated++
        }
      }

      results.push({
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        platform: profile.platform,
        success: result.success,
        followers: currentFollowers,
        error: result.error,
      })

      // Rate limiting — be respectful to target sites
      await delay(1500)
    }
  }

  // Report per-platform source health, aggregated across all competitors,
  // plus a separate check for any manually verified social entries. Never
  // let this throw or block the return.
  try {
    const sourceKeyByPlatform: Record<string, string> = {
      youtube: 'youtube_api',
      facebook: 'facebook_scraper',
      instagram: 'instagram_scraper',
      linkedin: 'linkedin_scraper',
      tiktok: 'tiktok_scraper',
    }

    for (const [platform, sourceKey] of Object.entries(sourceKeyByPlatform)) {
      const platformResults = results.filter((r) => r.platform === platform)
      if (platformResults.length === 0) continue

      const succeeded = platformResults.filter((r) => r.success)
      const failed = platformResults.filter((r) => !r.success)

      if (failed.length === 0) {
        await reportSourceSuccess(sourceKey, { fetched: platformResults.length, updated: succeeded.length })
      } else if (succeeded.length === 0) {
        // All attempts for this platform failed — spec calls for 'unavailable'
        // specifically rather than the generic reportSourceFailure 'failed'.
        await updateSourceStatus(sourceKey, {
          status: 'unavailable',
          error_message: 'Scraping blocked — unable to parse follower count',
          last_failed_at: new Date().toISOString(),
        })
      } else {
        const message = failed[0].error ?? 'Some competitors failed'
        await reportSourceFailure(sourceKey, message, true)
      }
    }

    const { data: manualRows } = await supabase
      .from('social_snapshots')
      .select('id')
      .eq('data_source', 'verified_manual')

    if (manualRows && manualRows.length > 0) {
      await reportSourceSuccess('social_manual', { fetched: manualRows.length })
    }
    // else: leave social_manual untouched entirely, per spec.
  } catch (err) {
    console.error('Failed to report social source statuses:', err)
  }

  return {
    total: results.length,
    successful: results.filter((r) => r.success).length,
    failed: results.filter((r) => !r.success).length,
    results,
    alerts_created: alertsCreated,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapePlatform(platform: Platform, handle: string, url: string | null): Promise<{ success: boolean; data: any; error: string | null }> {
  switch (platform) {
    case 'instagram':
      return scrapeInstagram(handle)
    case 'youtube':
      return scrapeYouTube(handle)
    case 'facebook':
      return scrapeFacebook(handle)
    case 'linkedin':
      // LinkedIn path is stored in the handle field
      return scrapeLinkedIn(handle)
    case 'tiktok':
      return scrapeTikTok(handle)
    default:
      return {
        success: false,
        data: null,
        error: `Unknown platform: ${platform}`,
      }
  }
}

export async function ingestSocialForCompetitor(competitorId: string): Promise<IngestionResult[]> {
  const supabase = await createServiceClient()

  const { data: profiles, error } = await supabase
    .from('social_profiles')
    .select('*')
    .eq('competitor_id', competitorId)
    .eq('active', true)

  if (error || !profiles) {
    throw new Error(`Failed to fetch profiles: ${error?.message}`)
  }

  const results: IngestionResult[] = []

  for (const profile of profiles) {
    if (!profile.handle) continue

    const result = await scrapePlatform(
      profile.platform as Platform,
      profile.handle,
      profile.url
    )

    await supabase.from('social_metrics').insert({
      profile_id: profile.id,
      competitor_id: competitorId,
      platform: profile.platform,
      followers: result.data?.followers ?? result.data?.subscribers ?? null,
      following: result.data?.following ?? null,
      posts_count: result.data?.posts_count ?? result.data?.videos ?? null,
      engagement_rate: null,
      data_source: result.success ? 'scraped' : 'unavailable',
      error_message: result.error,
    })

    results.push({
      competitor_id: competitorId,
      competitor_name: '',
      platform: profile.platform as Platform,
      success: result.success,
      followers: result.data?.followers ?? result.data?.subscribers ?? null,
      error: result.error,
    })

    await delay(1500)
  }

  return results
}
