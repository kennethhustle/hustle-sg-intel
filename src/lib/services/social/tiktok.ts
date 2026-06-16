import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface TikTokData {
  followers: number
  following: number
  likes: number
  videos: number
  username: string
}

function parseTTNum(s: string): number {
  const clean = s.replace(/,/g, '').trim()
  if (clean.toLowerCase().endsWith('m')) {
    return Math.round(parseFloat(clean) * 1_000_000)
  }
  if (clean.toLowerCase().endsWith('k')) {
    return Math.round(parseFloat(clean) * 1_000)
  }
  return parseInt(clean, 10) || 0
}

export async function scrapeTikTok(
  handle: string
): Promise<ScraperResult<TikTokData>> {
  const scraped_at = new Date().toISOString()
  const cleanHandle = handle.replace('@', '')
  const url = `https://www.tiktok.com/@${cleanHandle}`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.tiktok.com/',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: TikTok blocked the request`)
    }

    const html = await res.text()
    const $ = cheerio.load(html)

    // TikTok embeds data in __INIT_PROPS__ or SIGI_STATE window variables
    let followers: number | null = null
    let following: number | null = null
    let likes: number | null = null
    let videos: number | null = null
    let username: string | null = null

    const scripts = $('script').toArray()
    for (const script of scripts) {
      const content = $(script).html() || ''

      // Try SIGI_STATE (newer TikTok format)
      if (content.includes('SIGI_STATE')) {
        try {
          const match = content.match(/window\['SIGI_STATE'\]\s*=\s*(\{.+\});?\s*window/)
          if (match) {
            const data = JSON.parse(match[1])
            const userDetail = data?.UserPage?.userInfo?.stats
            if (userDetail) {
              followers = userDetail.followerCount ?? null
              following = userDetail.followingCount ?? null
              likes = userDetail.heartCount ?? null
              videos = userDetail.videoCount ?? null
              username = data?.UserPage?.userInfo?.user?.uniqueId ?? null
            }
          }
        } catch {
          // Continue to next strategy
        }
      }

      // Try __INIT_PROPS__ (older TikTok format)
      if (followers === null && content.includes('__INIT_PROPS__')) {
        try {
          const match = content.match(/window\.__INIT_PROPS__\s*=\s*(\{.+?\});/)
          if (match) {
            const data = JSON.parse(match[1])
            const userInfo = data?.['/']?.userInfo?.stats || data?.userInfo?.stats
            if (userInfo) {
              followers = userInfo.followerCount ?? null
              following = userInfo.followingCount ?? null
              likes = userInfo.heartCount ?? null
              videos = userInfo.videoCount ?? null
            }
          }
        } catch {
          // Continue
        }
      }
    }

    // Try meta tags as final fallback
    if (followers === null) {
      const description =
        $('meta[name="description"]').attr('content') ||
        $('meta[property="og:description"]').attr('content') ||
        ''
      const followersMatch = description.match(/([\d,.KMkm]+)\s*[Ff]ollowers/i)
      if (followersMatch) {
        followers = parseTTNum(followersMatch[1])
      }
    }

    if (followers === null) {
      throw new Error(
        'Could not parse follower count from TikTok page — bot detection likely triggered'
      )
    }

    return {
      success: true,
      data: {
        followers,
        following: following ?? 0,
        likes: likes ?? 0,
        videos: videos ?? 0,
        username: username ?? cleanHandle,
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
