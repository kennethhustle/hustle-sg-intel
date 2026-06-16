import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface IndeedJob {
  title: string
  department: string | null
  location: string | null
  job_type: string | null
  source: string
  source_url: string | null
  posted_at: string | null
  salary_min: number | null
  salary_max: number | null
  currency: string
  raw_data: Record<string, unknown>
}

function parseSalary(salaryStr: string): {
  min: number | null
  max: number | null
} {
  if (!salaryStr) return { min: null, max: null }
  // Format: "$3,000 - $5,000 a month" or "$3,000 a month"
  const match = salaryStr.match(/\$([\d,]+)(?:\s*[–-]\s*\$([\d,]+))?/)
  if (!match) return { min: null, max: null }
  const min = parseInt(match[1].replace(/,/g, ''), 10) || null
  const max = match[2] ? parseInt(match[2].replace(/,/g, ''), 10) || null : min
  return { min, max }
}

function parsePostedDate(text: string): string | null {
  if (!text) return null
  text = text.toLowerCase().trim()
  const now = new Date()
  const daysMatch = text.match(/(\d+)\s*days?\s*ago/i)
  if (daysMatch) {
    const d = new Date(now)
    d.setDate(d.getDate() - parseInt(daysMatch[1], 10))
    return d.toISOString()
  }
  if (text.includes('today') || text.includes('just posted')) {
    return now.toISOString()
  }
  if (text.includes('yesterday')) {
    const d = new Date(now)
    d.setDate(d.getDate() - 1)
    return d.toISOString()
  }
  // Try to parse a standard date
  const parsed = new Date(text)
  if (!isNaN(parsed.getTime())) return parsed.toISOString()
  return null
}

export async function scrapeIndeed(
  companyName: string
): Promise<ScraperResult<IndeedJob[]>> {
  const scraped_at = new Date().toISOString()
  const encodedCompany = encodeURIComponent(companyName)
  const url = `https://sg.indeed.com/jobs?q=${encodedCompany}&l=Singapore&fromage=30`

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://sg.indeed.com/',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error(`Indeed HTTP ${res.status}: ${res.statusText}`)
    }

    const html = await res.text()

    if (html.includes('captcha') || html.includes('CAPTCHA') || html.includes('unusual activity')) {
      throw new Error('Indeed CAPTCHA/bot detection triggered')
    }

    const $ = cheerio.load(html)
    const jobs: IndeedJob[] = []

    // Try JSON-LD first (more reliable)
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const data = JSON.parse($(script).html() || '{}')
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item['@type'] === 'JobPosting') {
            const { min, max } = parseSalary(
              `$${item.baseSalary?.value?.minValue ?? ''} - $${item.baseSalary?.value?.maxValue ?? ''}`
            )
            jobs.push({
              title: item.title || '',
              department: item.occupationalCategory || null,
              location:
                item.jobLocation?.address?.addressLocality ||
                item.jobLocation?.address?.addressRegion ||
                'Singapore',
              job_type: item.employmentType || null,
              source: 'indeed',
              source_url: item.url || null,
              posted_at: item.datePosted
                ? new Date(item.datePosted).toISOString()
                : null,
              salary_min: min ?? item.baseSalary?.value?.minValue ?? null,
              salary_max: max ?? item.baseSalary?.value?.maxValue ?? null,
              currency: item.baseSalary?.currency || 'SGD',
              raw_data: item as Record<string, unknown>,
            })
          }
        }
      } catch {
        // Ignore parse errors
      }
    })

    // Fall back to HTML card parsing
    if (jobs.length === 0) {
      $('[data-jk], .job_seen_beacon, .jobsearch-SerpJobCard').each((_, el) => {
        const $el = $(el)
        const title =
          $el.find('[class*="title"] a, .jobtitle, h2 a').first().text().trim()
        const location = $el.find('[class*="location"], .location').first().text().trim()
        const salaryText = $el.find('[class*="salary"], .salary').first().text().trim()
        const dateText = $el.find('[class*="date"], .date').first().text().trim()
        const link = $el.find('a').first().attr('href')

        if (!title) return

        const { min, max } = parseSalary(salaryText)

        jobs.push({
          title,
          department: null,
          location: location || 'Singapore',
          job_type: null,
          source: 'indeed',
          source_url: link
            ? link.startsWith('http')
              ? link
              : `https://sg.indeed.com${link}`
            : null,
          posted_at: parsePostedDate(dateText),
          salary_min: min,
          salary_max: max,
          currency: 'SGD',
          raw_data: { title, location, salaryText, dateText },
        })
      })
    }

    return {
      success: true,
      data: jobs,
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
