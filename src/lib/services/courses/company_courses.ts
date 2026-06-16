import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface CompanyCourse {
  title: string
  category: string | null
  sub_category: string | null
  price: number | null
  currency: string
  duration_hours: number | null
  is_skillsfuture_claimable: boolean
  skillsfuture_credit: number | null
  source: string
  source_url: string | null
  raw_data: Record<string, unknown>
}

// Common course/programme page URL patterns to try
const COURSE_PATH_CANDIDATES = [
  '/courses',
  '/course',
  '/programmes',
  '/programs',
  '/training',
  '/learn',
  '/workshops',
  '/services',
  '/our-courses',
  '/all-courses',
]

async function fetchCoursePage(
  website: string
): Promise<{ html: string; url: string } | null> {
  const base = website.startsWith('http') ? website : `https://${website}`

  for (const path of COURSE_PATH_CANDIDATES) {
    const url = `${base.replace(/\/$/, '')}${path}`
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
      if (res.ok) {
        const html = await res.text()
        if (
          html.toLowerCase().includes('course') ||
          html.toLowerCase().includes('program') ||
          html.toLowerCase().includes('workshop') ||
          html.toLowerCase().includes('training')
        ) {
          return { html, url }
        }
      }
    } catch {
      // Try next path
    }
  }

  // Fallback: try the root website
  try {
    const res = await fetch(base, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      next: { revalidate: 0 },
    })
    if (res.ok) {
      return { html: await res.text(), url: base }
    }
  } catch {
    // Ignore
  }

  return null
}

function parsePrice(priceStr: string): number | null {
  if (!priceStr) return null
  const match = priceStr.match(/\$?([\d,]+(?:\.\d{1,2})?)/)
  if (!match) return null
  return parseFloat(match[1].replace(/,/g, '')) || null
}

function parseDuration(durationStr: string): number | null {
  if (!durationStr) return null
  // "2 hours", "3-day", "16 hours"
  const hoursMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*hours?/i)
  if (hoursMatch) return parseFloat(hoursMatch[1])
  const daysMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*days?/i)
  if (daysMatch) return parseFloat(daysMatch[1]) * 8
  const weeksMatch = durationStr.match(/(\d+(?:\.\d+)?)\s*weeks?/i)
  if (weeksMatch) return parseFloat(weeksMatch[1]) * 40
  return null
}

function isSFClaimableText(text: string): boolean {
  const lower = text.toLowerCase()
  return (
    lower.includes('skillsfuture') ||
    lower.includes('sfc') ||
    lower.includes('sf credit') ||
    lower.includes('claimable') ||
    lower.includes('wsq') ||
    lower.includes('workforce skills')
  )
}

export async function scrapeCompanyCourses(
  website: string,
  competitorName: string
): Promise<ScraperResult<CompanyCourse[]>> {
  const scraped_at = new Date().toISOString()

  try {
    const result = await fetchCoursePage(website)
    if (!result) {
      return {
        success: false,
        data: null,
        error: `No courses page found for ${competitorName} at ${website}`,
        scraped_at,
        source: website,
      }
    }

    const { html, url } = result
    const $ = cheerio.load(html)
    const courses: CompanyCourse[] = []

    // Try JSON-LD first
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const data = JSON.parse($(script).html() || '{}')
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item['@type'] === 'Course' || item['@type'] === 'EducationalOccupationalProgram') {
            courses.push({
              title: item.name || item.title || '',
              category: item.about?.[0]?.name || null,
              sub_category: null,
              price:
                item.offers?.price ||
                item.hasCourseInstance?.coursePrice ||
                null,
              currency: item.offers?.priceCurrency || 'SGD',
              duration_hours: null,
              is_skillsfuture_claimable: false,
              skillsfuture_credit: null,
              source: 'company_website',
              source_url: item.url || url,
              raw_data: item as Record<string, unknown>,
            })
          }
        }
      } catch {
        // Ignore
      }
    })

    // HTML extraction for course cards
    if (courses.length === 0) {
      const courseSelectors = [
        '[class*="course-card"]',
        '[class*="course-item"]',
        '[class*="program-card"]',
        '[class*="workshop-card"]',
        '[class*="training-card"]',
        '[data-course]',
        '.course',
        '.program',
        'article[class*="course"]',
        'li[class*="course"]',
      ]

      for (const selector of courseSelectors) {
        $(selector).each((_, el) => {
          const $el = $(el)
          const title = $el
            .find('h2, h3, h4, [class*="title"], [class*="name"]')
            .first()
            .text()
            .trim()
          const priceText = $el
            .find('[class*="price"], [class*="fee"], [class*="cost"]')
            .first()
            .text()
            .trim()
          const durationText = $el
            .find('[class*="duration"], [class*="hours"], [class*="length"]')
            .first()
            .text()
            .trim()
          const category = $el
            .find('[class*="category"], [class*="tag"]')
            .first()
            .text()
            .trim()
          const link = $el.find('a').first().attr('href')
          const fullText = $el.text()

          if (!title || title.length < 3 || title.length > 150) return

          const resolvedUrl = link
            ? link.startsWith('http')
              ? link
              : `${new URL(url).origin}${link.startsWith('/') ? '' : '/'}${link}`
            : url

          courses.push({
            title,
            category: category || null,
            sub_category: null,
            price: parsePrice(priceText),
            currency: 'SGD',
            duration_hours: parseDuration(durationText),
            is_skillsfuture_claimable: isSFClaimableText(fullText),
            skillsfuture_credit: null,
            source: 'company_website',
            source_url: resolvedUrl,
            raw_data: { title, priceText, durationText, category },
          })
        })
        if (courses.length > 0) break
      }
    }

    return {
      success: true,
      data: courses,
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
      source: website,
    }
  }
}
