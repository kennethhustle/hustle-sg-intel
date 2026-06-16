import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface JobStreetJob {
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
  // Format: "SGD 3,000 - SGD 5,000" or "SGD 3,000"
  const match = salaryStr.match(
    /SGD\s*([\d,]+)(?:\s*-\s*SGD\s*([\d,]+))?/i
  )
  if (!match) return { min: null, max: null }
  const min = parseInt(match[1].replace(/,/g, ''), 10) || null
  const max = match[2] ? parseInt(match[2].replace(/,/g, ''), 10) || null : min
  return { min, max }
}

export async function scrapeJobStreet(
  companyName: string
): Promise<ScraperResult<JobStreetJob[]>> {
  const scraped_at = new Date().toISOString()
  const encodedName = encodeURIComponent(companyName)
  const url = `https://www.jobstreet.com.sg/en/job-search/${encodedName.toLowerCase().replace(/%20/g, '-')}-jobs/`

  try {
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
      throw new Error(`JobStreet HTTP ${res.status}: ${res.statusText}`)
    }

    const html = await res.text()

    // Check for CAPTCHA or bot detection
    if (html.includes('captcha') || html.includes('robot') || html.includes('blocked')) {
      throw new Error('JobStreet bot detection triggered — request blocked')
    }

    const $ = cheerio.load(html)
    const jobs: JobStreetJob[] = []

    // JobStreet job card selectors — may change with site updates
    $('[data-automation="job-card"], article[class*="job"]').each((_, el) => {
      const $el = $(el)
      const title =
        $el.find('[data-automation="job-title"], h1, h2, h3').first().text().trim()
      const location = $el
        .find('[data-automation="job-location"], [class*="location"]')
        .first()
        .text()
        .trim()
      const jobType = $el
        .find('[data-automation="job-type"], [class*="type"]')
        .first()
        .text()
        .trim()
      const salaryText = $el
        .find('[data-automation="job-salary"], [class*="salary"]')
        .first()
        .text()
        .trim()
      const link = $el.find('a').first().attr('href')
      const dateText = $el
        .find('[data-automation="job-list-date"], time, [class*="date"]')
        .first()
        .text()
        .trim()

      if (!title) return

      const { min: salary_min, max: salary_max } = parseSalary(salaryText)

      jobs.push({
        title,
        department: null,
        location: location || 'Singapore',
        job_type: jobType || null,
        source: 'jobstreet',
        source_url: link ? `https://www.jobstreet.com.sg${link}` : null,
        posted_at: dateText ? new Date(dateText).toISOString() : null,
        salary_min,
        salary_max,
        currency: 'SGD',
        raw_data: { title, location, jobType, salaryText, link, dateText },
      })
    })

    // Also try JSON-LD embedded job postings
    $('script[type="application/ld+json"]').each((_, script) => {
      try {
        const data = JSON.parse($(script).html() || '{}')
        const items = Array.isArray(data) ? data : [data]
        for (const item of items) {
          if (item['@type'] === 'JobPosting') {
            jobs.push({
              title: item.title || '',
              department: item.occupationalCategory || null,
              location:
                item.jobLocation?.address?.addressLocality ||
                item.jobLocation?.address?.addressRegion ||
                'Singapore',
              job_type: item.employmentType || null,
              source: 'jobstreet',
              source_url: item.url || null,
              posted_at: item.datePosted
                ? new Date(item.datePosted).toISOString()
                : null,
              salary_min: item.baseSalary?.value?.minValue || null,
              salary_max: item.baseSalary?.value?.maxValue || null,
              currency: item.baseSalary?.currency || 'SGD',
              raw_data: item as Record<string, unknown>,
            })
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    })

    if (jobs.length === 0) {
      return {
        success: true,
        data: [],
        error: null,
        scraped_at,
        source: url,
      }
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
