import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface LinkedInData {
  followers: number
  employees: number
  company_name: string
}

function parseLINum(s: string): number {
  const clean = s.replace(/,/g, '').trim()
  if (clean.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(clean) * 1_000_000)
  }
  if (clean.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(clean) * 1_000)
  }
  return parseInt(clean, 10) || 0
}

export async function scrapeLinkedIn(
  companyPath: string
): Promise<ScraperResult<LinkedInData>> {
  const scraped_at = new Date().toISOString()
  const url = `https://www.linkedin.com/${companyPath}`

  try {
    // LinkedIn heavily blocks non-authenticated scraping.
    // We attempt the request but expect frequent failures.
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
      throw new Error(`HTTP ${res.status}: LinkedIn blocked the request`)
    }

    const html = await res.text()

    // Check for auth wall or redirect
    if (
      html.includes('authwall') ||
      html.includes('Join LinkedIn') ||
      html.includes('Sign in') && html.includes('to view full profiles')
    ) {
      throw new Error('LinkedIn requires authentication to view follower counts')
    }

    const $ = cheerio.load(html)

    const ogTitle = $('meta[property="og:title"]').attr('content') || ''
    const description =
      $('meta[name="description"]').attr('content') ||
      $('meta[property="og:description"]').attr('content') ||
      ''

    // Try to extract follower count from description or embedded JSON
    const followersMatch =
      description.match(/([\d,.KMkm]+)\s*followers/i) ||
      html.match(/"followersCount":\s*(\d+)/i) ||
      html.match(/([\d,]+)\s*followers/i)

    const employeesMatch =
      description.match(/([\d,.KMkm]+)\s*employees/i) ||
      html.match(/"staffCountRange".*?"start":(\d+)/i)

    if (!followersMatch) {
      throw new Error(
        'LinkedIn page loaded but follower count not accessible — LinkedIn restricts public data access'
      )
    }

    return {
      success: true,
      data: {
        followers: parseLINum(followersMatch[1]),
        employees: employeesMatch ? parseLINum(employeesMatch[1]) : 0,
        company_name: ogTitle.replace(' | LinkedIn', '').trim(),
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
