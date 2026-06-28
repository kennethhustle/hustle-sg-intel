import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  pickPreciseCount,
  SOURCE_CONFIDENCE,
} from './_shared'

interface TikTokData {
  followers: number
  following: number
  likes: number
  videos: number
  username: string
}

/**
 * Scrapes a fixed TikTok profile permalink for public follower counts.
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a bare handle for backwards compatibility).
 */
export async function scrapeTikTok(
  target: string
): Promise<ScraperResult<TikTokData>> {
  const scraped_at = new Date().toISOString()
  const cleanHandle = target.replace('@', '')
  const url = target.startsWith('http')
    ? target
    : `https://www.tiktok.com/@${cleanHandle}`

  try {
    const page = await loadPageContent(url)

    // TikTok embeds stats in SIGI_STATE / __UNIVERSAL_DATA_FOR_REHYDRATION__
    // JSON inside the rendered HTML — this is the authoritative exact integer.
    // Body/meta text only carry abbreviated values ("18.3K"). Source priority
    // is explicit (json > meta > body), not argument order.
    const followers = pickPreciseCount(
      exactCount(extractJsonNumber(page.html, ['followerCount']), SOURCE_CONFIDENCE.json),
      findCountDetailed(
        `${page.metaDescription} ${page.ogDescription}`,
        ['followers'],
        SOURCE_CONFIDENCE.meta
      ),
      findCountDetailed(page.bodyText, ['followers'], SOURCE_CONFIDENCE.body)
    )

    if (followers === null) {
      throw new Error(
        'TikTok page loaded but follower count not found — bot detection or layout change'
      )
    }

    const following = extractJsonNumber(page.html, ['followingCount']) ?? 0
    const likes = extractJsonNumber(page.html, ['heartCount', 'heart']) ?? 0
    const videos = extractJsonNumber(page.html, ['videoCount']) ?? 0

    return {
      success: true,
      data: {
        followers,
        following,
        likes,
        videos,
        username: cleanHandle,
      },
      error: null,
      scraped_at,
      source: url,
    }
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      scraped_at,
      source: url,
    }
  }
}
