import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface FacebookData {
  followers: number
  likes: number
  page_name: string
}

function parseFBNum(s: string): number {
  const clean = s.replace(/,/g, '').trim()
  if (clean.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(clean) * 1_000_000)
  }
  if (clean.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(clean) * 1_000)
  }
  return parseInt(clean, 10) || 0
}

export async function scrapeFacebook(
  pageHandle: string
): Promise<ScraperResult<FacebookData>> {
  const scraped_at = new Date().toISOString()
  const url = `https://www.facebook.com/${pageHandle}`

  try {
    // Facebook aggressively blocks scrapers. We attempt a fetch and parse
    // any follower data from the HTML. Most requests will be redirected
    // to login or blocked by bot detection.
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: Facebook blocked the request`)
    }

    const html = await res.text()

    // Check if we've been redirected to login
    if (
      html.includes('login') &&
      html.includes('You must log in to continue') ||
      html.includes('loginForm')
    ) {
      throw new Error('Facebook requires login to view this page')
    }

    const $ = cheerio.load(html)

    // Try Open Graph meta tags
    const ogTitle = $('meta[property="og:title"]').attr('content') || ''
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''

    // Facebook sometimes embeds follower counts in meta description
    const followersMatch =
      description.match(/([\d,.KMkm]+)\s*[Ff]ollowers/i) ||
      html.match(/"followerCount":\s*(\d+)/i) ||
      html.match(/([\d,.]+)\s*people follow this/i)

    const likesMatch =
      description.match(/([\d,.KMkm]+)\s*[Ll]ikes/i) ||
      html.match(/"likeCount":\s*(\d+)/i)

    if (!followersMatch) {
      throw new Error(
        'Facebook page scraped but follower count not found — Facebook blocks most public data'
      )
    }

    return {
      success: true,
      data: {
        followers: parseFBNum(followersMatch[1]),
        likes: likesMatch ? parseFBNum(likesMatch[1]) : 0,
        page_name: ogTitle,
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
