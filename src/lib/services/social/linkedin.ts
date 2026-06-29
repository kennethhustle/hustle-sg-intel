import type { ScraperResult } from '@/lib/types'
import {
  loadPageContent,
  findCountDetailed,
  exactCount,
  extractJsonNumber,
  pickPreciseCount,
  SOURCE_CONFIDENCE,
} from './_shared'

interface LinkedInData {
  followers: number
  employees: number
  company_name: string
}

/**
 * Scrapes a fixed LinkedIn company/school permalink for public follower counts.
 * `target` is the exact URL stored in social_profiles (falls back to building
 * a URL from a stored company path for backwards compatibility).
 */
export async function scrapeLinkedIn(
  target: string
): Promise<ScraperResult<LinkedInData>> {
  const scraped_at = new Date().toISOString()
  const base = target.startsWith('http') ? target : `https://www.linkedin.com/${target}`

  // LinkedIn frequently serves a generic "750 million members" auth wall to
  // datacenter IPs. The localised sg.linkedin.com host returns the public
  // follower meta far more reliably, so try both hosts before giving up.
  const candidates = [base]
  if (/\/\/www\.linkedin\.com/.test(base)) candidates.push(base.replace('//www.linkedin.com', '//sg.linkedin.com'))

  let lastErr = 'LinkedIn page loaded but follower count not accessible — auth wall or restricted data'

  for (const url of candidates) {
    try {
      const page = await loadPageContent(url, {
        waitUntilReady: ({ html }) => /[\d,]+\s+followers/i.test(html) || /followerCount/i.test(html),
        settleMs: 15_000,
      })

      const metaText = `${page.metaDescription} ${page.ogDescription}`

      // Explicit source priority (json > meta > body), not argument order.
      const followers = pickPreciseCount(
        exactCount(
          extractJsonNumber(page.html, ['followerCount', 'followingInfoCount']),
          SOURCE_CONFIDENCE.json
        ),
        findCountDetailed(metaText, ['followers'], SOURCE_CONFIDENCE.meta),
        findCountDetailed(page.bodyText, ['followers'], SOURCE_CONFIDENCE.body)
      )

      if (followers === null) continue

      const employees =
        pickPreciseCount(
          exactCount(extractJsonNumber(page.html, ['staffCount']), SOURCE_CONFIDENCE.json),
          findCountDetailed(metaText, ['employees'], SOURCE_CONFIDENCE.meta),
          findCountDetailed(page.bodyText, ['employees'], SOURCE_CONFIDENCE.body)
        ) ?? 0

      const company_name = (page.ogTitle || page.title)
        .replace(' | LinkedIn', '')
        .trim()

      return {
        success: true,
        data: { followers, employees, company_name },
        error: null,
        scraped_at,
        source: url,
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
  }

  return {
    success: false,
    data: null,
    error: lastErr,
    scraped_at,
    source: base,
  }
}
