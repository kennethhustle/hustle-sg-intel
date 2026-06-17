import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface InstagramData {
  followers: number
  following: number
  posts_count: number
}

function parseIGNum(s: string): number {
  const clean = s.replace(/,/g, '').trim()
  if (clean.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(clean) * 1_000_000)
  }
  if (clean.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(clean) * 1_000)
  }
  return parseInt(clean, 10) || 0
}

export async function scrapeInstagram(
  handle: string
): Promise<ScraperResult<InstagramData>> {
  const scraped_at = new Date().toISOString()
  const cleanHandle = handle.replace('@', '')
  const url = `https://www.instagram.com/${cleanHandle}/`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Cache-Control': 'no-cache',
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const html = await res.text()

    // Try to extract from meta tags — Instagram embeds count in description
    const $ = cheerio.load(html)
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''

    // Instagram meta format: "30.4K Followers, 150 Following, 1,234 Posts"
    const followersMatch = description.match(/([\d,.KMkm]+)\s*Followers/i)
    const followingMatch = description.match(/([\d,.KMkm]+)\s*Following/i)
    const postsMatch = description.match(/([\d,.KMkm]+)\s*Posts/i)

    if (!followersMatch) {
      // Try JSON-LD as fallback
      const jsonLd = $('script[type="application/ld+json"]').first().html()
      if (jsonLd) {
        try {
          const parsed = JSON.parse(jsonLd)
          if (parsed.mainEntityofPage || parsed['@type'] === 'ProfilePage') {
            throw new Error('JSON-LD found but no follower count parseable')
          }
        } catch {
          // ignore JSON parse errors
        }
      }
      throw new Error(
        'Could not parse follower count from Instagram page — likely blocked or page structure changed'
      )
    }

    return {
      success: true,
      data: {
        followers: parseIGNum(followersMatch[1]),
        following: followingMatch ? parseIGNum(followingMatch[1]) : 0,
        posts_count: postsMatch ? parseIGNum(postsMatch[1]) : 0,
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
