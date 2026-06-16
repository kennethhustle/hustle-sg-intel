import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface YouTubeData {
  subscribers: number
  videos: number
  channel_name: string
}

function parseYTNum(s: string): number {
  const clean = s.replace(/,/g, '').trim()
  if (clean.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(clean) * 1_000_000)
  }
  if (clean.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(clean) * 1_000)
  }
  return parseInt(clean, 10) || 0
}

export async function scrapeYouTube(
  channelIdentifier: string
): Promise<ScraperResult<YouTubeData>> {
  const scraped_at = new Date().toISOString()

  // channelIdentifier can be a channel ID (UCxxx), a @handle, or a /c/ path
  let url: string
  if (channelIdentifier.startsWith('UC')) {
    url = `https://www.youtube.com/channel/${channelIdentifier}`
  } else if (channelIdentifier.startsWith('@')) {
    url = `https://www.youtube.com/${channelIdentifier}`
  } else if (channelIdentifier.startsWith('c/')) {
    url = `https://www.youtube.com/${channelIdentifier}`
  } else {
    url = `https://www.youtube.com/@${channelIdentifier}`
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`)
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    // YouTube embeds subscriber count in ytInitialData JSON
    const scripts = $('script').toArray()
    let subscriberCount: number | null = null
    let videoCount: number | null = null
    let channelName: string | null = null

    for (const script of scripts) {
      const content = $(script).html() || ''
      if (content.includes('ytInitialData')) {
        try {
          const match = content.match(/var ytInitialData\s*=\s*(\{.+?\});/)
          if (match) {
            const data = JSON.parse(match[1])
            // Navigate the ytInitialData structure to find subscriber count
            const header =
              data?.header?.c4TabbedHeaderRenderer ||
              data?.header?.pageHeaderRenderer
            if (header) {
              channelName = header?.title || null
              const subscriberText =
                header?.subscriberCountText?.simpleText ||
                header?.subscriberCountText?.runs?.[0]?.text ||
                ''
              if (subscriberText) {
                const numMatch = subscriberText.match(/([\d,.KMkm]+)/i)
                if (numMatch) {
                  subscriberCount = parseYTNum(numMatch[1])
                }
              }
            }
          }
        } catch {
          // JSON parse error — try next script
        }
      }

      // Also check for subscriber count in meta tags as a fallback
      if (subscriberCount === null) {
        const metaDesc =
          $('meta[name="description"]').attr('content') ||
          $('meta[property="og:description"]').attr('content') ||
          ''
        const subMatch = metaDesc.match(/([\d,.KMkm]+)\s*subscribers/i)
        if (subMatch) {
          subscriberCount = parseYTNum(subMatch[1])
        }
      }
    }

    // Try to get video count from channel stats
    const statsText = html.match(/"videoCountText":\{"runs":\[\{"text":"([\d,]+)"\}/)?.[1]
    if (statsText) {
      videoCount = parseInt(statsText.replace(/,/g, ''), 10)
    }

    if (subscriberCount === null) {
      throw new Error(
        'Could not parse subscriber count from YouTube page — likely blocked or structure changed'
      )
    }

    return {
      success: true,
      data: {
        subscribers: subscriberCount,
        videos: videoCount ?? 0,
        channel_name: channelName ?? channelIdentifier,
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
