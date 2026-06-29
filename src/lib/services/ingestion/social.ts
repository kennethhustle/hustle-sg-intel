import { createServiceClient } from '@/lib/supabase/server'
import { scrapeInstagram } from '@/lib/services/social/instagram'
import { scrapeYouTube } from '@/lib/services/social/youtube'
import { scrapeFacebook } from '@/lib/services/social/facebook'
import { scrapeLinkedIn } from '@/lib/services/social/linkedin'
import { scrapeTikTok } from '@/lib/services/social/tiktok'
import { openSharedBrowser, closeSharedBrowser } from '@/lib/services/scraper/browser'
import {
  SOURCE_CONFIDENCE,
  confidenceLabel,
  confidenceFromLabel,
} from '@/lib/services/social/_shared'
import type { Platform } from '@/lib/types'

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

export async function ingestAllSocial(): Promise<OverallResult> {
  const supabase = await createServiceClient()

  // Fetch all active competitors with their social profiles
  const { data: competitors, error: competitorsError } = await supabase
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

  if (competitorsError || !competitors) {
    throw new Error(`Failed to fetch competitors: ${competitorsError?.message}`)
  }

  const results: IngestionResult[] = []
  let alertsCreated = 0

  // Open one warmed-up browser reused for every profile in this batch. TikTok
  // and LinkedIn only return their full follower data to a warm, stealthy
  // session — a cold launch-per-request browser gets blocked.
  await openSharedBrowser()

  try {
    // Flatten to (competitor, profile) work items.
    const workItems: Array<{ competitor: CompetitorRow; profile: SocialProfileRow }> = []
    for (const competitor of competitors as CompetitorRow[]) {
      const profiles = (competitor.social_profiles ?? []).filter(
        (p) => p.active && p.handle
      )
      for (const profile of profiles) {
        workItems.push({ competitor, profile })
      }
    }

    // First pass over every profile.
    for (const { competitor, profile } of workItems) {
      const { result, alertCreated } = await processSocialProfile(
        supabase,
        competitor,
        profile
      )
      if (alertCreated) alertsCreated++
      results.push(result)
      await delay(1500)
    }

    // Retry queue: Instagram throttles bursts by serving a meta-only login wall,
    // which the scraper correctly REFUSES (no exact value). Such accounts must be
    // retried later until an exact integer is captured — never left rounded. We
    // re-attempt the failed Instagram profiles in additional rounds, with a
    // growing cooldown so the IP throttle clears between rounds.
    const RETRY_COOLDOWN_MS = [60_000, 120_000, 180_000, 240_000]
    for (let round = 0; round < RETRY_COOLDOWN_MS.length; round++) {
      const pending = workItems.filter(({ competitor, profile }) => {
        if (profile.platform !== 'instagram' && profile.platform !== 'linkedin') return false
        const r = results.find(
          (x) => x.competitor_id === competitor.id && x.platform === profile.platform
        )
        return r ? !r.success : true
      })
      if (pending.length === 0) break

      console.log(
        `[social] retry round ${round + 1}: ${pending.length} account(s) ` +
          `awaiting an exact value — cooling down ${RETRY_COOLDOWN_MS[round] / 1000}s`
      )
      await delay(RETRY_COOLDOWN_MS[round])

      for (const { competitor, profile } of pending) {
        const { result, alertCreated } = await processSocialProfile(
          supabase,
          competitor,
          profile
        )
        if (alertCreated) alertsCreated++
        // Replace the previous (failed) result for this competitor+platform.
        const idx = results.findIndex(
          (x) => x.competitor_id === competitor.id && x.platform === profile.platform
        )
        if (idx >= 0) results[idx] = result
        else results.push(result)
        await delay(2500)
      }
    }

    const stillRounded = results.filter(
      (r) => r.platform === 'instagram' && !r.success
    )
    if (stillRounded.length > 0) {
      console.warn(
        `[social] ${stillRounded.length} Instagram account(s) still without an exact ` +
          `value after all retry rounds: ${stillRounded.map((r) => r.competitor_name).join(', ')}`
      )
    }

    return {
      total: results.length,
      successful: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      results,
      alerts_created: alertsCreated,
    }
  } finally {
    await closeSharedBrowser()
  }
}

interface SocialProfileRow {
  id: string
  platform: Platform
  handle: string | null
  url: string | null
  active: boolean
}

interface CompetitorRow {
  id: string
  name: string
  slug: string
  is_hustle: boolean
  social_profiles: SocialProfileRow[]
}

/**
 * Scrapes a single social profile and persists it (social_metrics +
 * confidence-gated social_snapshots), creating a follower-change alert when
 * warranted. Returns the run result and whether an alert was created so the
 * caller can run it in both the first pass and the retry rounds.
 */
async function processSocialProfile(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  competitor: CompetitorRow,
  profile: SocialProfileRow
): Promise<{ result: IngestionResult; alertCreated: boolean }> {
  const scrapeResult = await scrapePlatform(profile.platform, profile.handle!, profile.url)

  const followerCountLog =
    scrapeResult.data?.followers ?? scrapeResult.data?.subscribers ?? null

  console.log(
    `[social] ${competitor.name} | ${profile.platform} | ${profile.url ?? profile.handle} | ` +
      `${scrapeResult.success ? 'SUCCESS' : 'FAIL'} | followers=${followerCountLog ?? 'n/a'}` +
      `${scrapeResult.success ? '' : ` | ${scrapeResult.error ?? 'unknown error'}`}`
  )

  // Get previous metric to detect changes
  const { data: prevMetric } = await supabase
    .from('social_metrics')
    .select('followers')
    .eq('profile_id', profile.id)
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const followerCount = scrapeResult.data?.followers ?? scrapeResult.data?.subscribers ?? null
  const postsCount = scrapeResult.data?.posts_count ?? scrapeResult.data?.videos ?? null

  // Insert into social_metrics (legacy, detailed)
  const { error: insertError } = await supabase.from('social_metrics').insert({
    profile_id: profile.id,
    competitor_id: competitor.id,
    platform: profile.platform,
    followers: followerCount,
    following: scrapeResult.data?.following ?? null,
    posts_count: postsCount,
    engagement_rate: null,
    data_source: scrapeResult.success ? 'scraped' : 'unavailable',
    error_message: scrapeResult.error,
  })

  // Upsert into social_snapshots (new, for dashboard) — confidence-gated.
  // Only overwrite an existing same-day snapshot when the incoming value
  // has EQUAL OR HIGHER confidence, so a later rounded scrape can never
  // clobber an earlier exact one (e.g. exact 30707 is kept over rounded 31000).
  if (scrapeResult.success && followerCount !== null) {
    const snapshotDate = new Date().toISOString().split('T')[0]
    const incomingConfidence: number =
      scrapeResult.data?.followers_confidence ??
      (profile.platform === 'youtube'
        ? SOURCE_CONFIDENCE.json
        : SOURCE_CONFIDENCE.body)

    const { data: existingSnapshot } = await supabase
      .from('social_snapshots')
      .select('follower_count, data_confidence')
      .eq('competitor_id', competitor.id)
      .eq('platform', profile.platform)
      .eq('snapshot_date', snapshotDate)
      .maybeSingle()

    const existingConfidence = existingSnapshot
      ? confidenceFromLabel(existingSnapshot.data_confidence)
      : 0

    if (incomingConfidence >= existingConfidence) {
      await supabase.from('social_snapshots').upsert({
        competitor_id: competitor.id,
        platform: profile.platform,
        follower_count: followerCount,
        total_posts: postsCount,
        data_confidence: confidenceLabel(incomingConfidence),
        snapshot_date: snapshotDate,
        scraped_at: new Date().toISOString(),
      }, { onConflict: 'competitor_id,platform,snapshot_date' })
    } else {
      console.log(
        `[social] keep higher-confidence snapshot for ${competitor.name} | ${profile.platform} | ` +
          `existing ${existingSnapshot?.follower_count} (${existingSnapshot?.data_confidence}) ` +
          `> incoming ${followerCount} (${confidenceLabel(incomingConfidence)})`
      )
    }
  }

  if (insertError) {
    console.error(`Failed to insert metric for ${competitor.name} ${profile.platform}:`, insertError)
  }

  const currentFollowers =
    scrapeResult.data?.followers ?? scrapeResult.data?.subscribers ?? null
  const prevFollowers = prevMetric?.followers ?? null

  let alertCreated = false

  // Create alert if followers changed by more than 10%
  if (
    scrapeResult.success &&
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

      if (!alertError) alertCreated = true
    }
  }

  return {
    result: {
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      platform: profile.platform,
      success: scrapeResult.success,
      followers: currentFollowers,
      error: scrapeResult.error,
    },
    alertCreated,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function scrapePlatform(platform: Platform, handle: string, url: string | null): Promise<{ success: boolean; data: any; error: string | null }> {
  // For the 4 permalink platforms we use the EXACT stored profile URL.
  // YouTube is intentionally left on its handle/channel identifier because it
  // is resolved through the official YouTube Data API (not URL scraping).
  const target = url ?? handle

  switch (platform) {
    case 'instagram':
      return scrapeInstagram(target)
    case 'youtube':
      return scrapeYouTube(handle)
    case 'facebook':
      return scrapeFacebook(target)
    case 'linkedin':
      return scrapeLinkedIn(target)
    case 'tiktok':
      return scrapeTikTok(target)
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
