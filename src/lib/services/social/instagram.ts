import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  extractExactFollowersFromHtml,
  pickPreciseCount,
  SOURCE_CONFIDENCE,
} from './_shared'

interface InstagramData {
  followers: number
  following: number
  posts_count: number
}

/** Escalating backoff (ms) between attempts within a single scrape. Instagram
 *  throttles bursts by serving a meta-only login wall; waiting longer lets it
 *  serve the fully hydrated (JSON-bearing) variant. */
const ATTEMPT_BACKOFF_MS = [0, 4_000, 8_000, 15_000, 25_000, 40_000]

/**
 * Scrapes a fixed Instagram profile permalink for the EXACT public follower
 * count. Retries with escalating backoff until an exact integer is captured.
 *
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a bare handle for backwards compatibility).
 */
export async function scrapeInstagram(
  target: string
): Promise<ScraperResult<InstagramData>> {
  const scraped_at = new Date().toISOString()
  const url = target.startsWith('http')
    ? target
    : `https://www.instagram.com/${target.replace('@', '')}/`

  // Hydration gate: the precise follower data (embedded `follower_count` JSON,
  // the `title="30,707"` DOM attribute, or — for small accounts — the visible
  // full integer) only appears AFTER React hydrates. The static SSR <head> only
  // carries the ROUNDED og:description ("31K"). We must wait until the precise
  // data has rendered before reading, otherwise we capture only the rounded meta.
  const isHydrated = ({ html, bodyText }: { html: string; bodyText: string }) =>
    /"follower_count"\s*:/.test(html) ||
    /"edge_followed_by"/.test(html) ||
    /title="[\d,]+"[\s\S]{0,200}?followers/i.test(html) ||
    /([\d][\d.,]*\s*[kmb]?)\s*followers/i.test(bodyText)

  try {
    // Follower-count source policy (STRICT — only an EXACT integer is a success):
    //   1. Embedded JSON `follower_count` / `edge_followed_by` — exact integer.
    //   2. DOM `title="30,707"` attribute on the followers control — exact integer.
    //   3. A FULL-INTEGER visible body value (small accounts: "7,052 followers").
    //   REJECTED: any abbreviated value — body "30.7K" AND og/meta "31K" — because
    //   they are rounded. We keep retrying with backoff until an exact value is
    //   captured; if every attempt is exhausted we FAIL the scrape so ingestion
    //   re-queues this account rather than storing an approximation.
    let best: {
      followers: number
      following: number
      posts_count: number
      followers_confidence: number
    } | null = null

    for (let attempt = 0; attempt < ATTEMPT_BACKOFF_MS.length; attempt++) {
      if (ATTEMPT_BACKOFF_MS[attempt] > 0) {
        await new Promise((r) => setTimeout(r, ATTEMPT_BACKOFF_MS[attempt]))
      }

      const page = await loadPageContent(url, { waitUntilReady: isHydrated })
      const metaText = `${page.metaDescription} ${page.ogDescription}`

      // 1+2) Exact integer from embedded JSON or the DOM title attribute.
      const exactFollowers = extractExactFollowersFromHtml(page.html)
      // 3) Full-integer body value (only when NOT abbreviated — no K/M/B suffix).
      const bodyDetailed = findCountDetailed(
        page.bodyText,
        ['followers'],
        SOURCE_CONFIDENCE.body
      )

      const followersResult =
        exactCount(exactFollowers, SOURCE_CONFIDENCE.json) ??
        (bodyDetailed && bodyDetailed.exact ? bodyDetailed : null)

      if (followersResult === null) {
        // Not hydrated / only a rounded value this attempt. Do NOT store the
        // rounded meta — back off and retry.
        continue
      }

      // following / posts are not growth-critical; meta is acceptable here.
      const following =
        pickPreciseCount(
          exactCount(
            extractJsonNumber(page.html, ['following_count', 'edge_follow']),
            SOURCE_CONFIDENCE.json
          ),
          findCountDetailed(page.bodyText, ['following'], SOURCE_CONFIDENCE.body),
          findCountDetailed(metaText, ['following'], SOURCE_CONFIDENCE.meta)
        ) ?? 0

      const posts_count =
        pickPreciseCount(
          exactCount(
            extractJsonNumber(page.html, ['media_count', 'edge_owner_to_timeline_media']),
            SOURCE_CONFIDENCE.json
          ),
          findCountDetailed(page.bodyText, ['posts'], SOURCE_CONFIDENCE.body),
          findCountDetailed(metaText, ['posts'], SOURCE_CONFIDENCE.meta)
        ) ?? 0

      best = {
        followers: followersResult.value,
        following,
        posts_count,
        followers_confidence: followersResult.confidence,
      }
      // An exact integer was captured (JSON/title or full-integer body) — done.
      break
    }

    if (best === null) {
      // Every attempt yielded only a rounded value — refuse to store it so the
      // ingestion retry queue re-attempts this account later.
      throw new Error(
        'Instagram: no exact follower value (JSON / title / full-integer body) ' +
          'captured after retries — refusing to store a rounded value'
      )
    }

    return {
      success: true,
      data: best,
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
