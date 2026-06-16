import * as cheerio from 'cheerio'
import type { ScraperResult } from '@/lib/types'

interface CareerPageJob {
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

// Common careers page URL patterns to try
const CAREERS_PATH_CANDIDATES = [
  '/careers',
  '/career',
  '/jobs',
  '/join-us',
  '/join',
  '/work-with-us',
  '/hiring',
  '/vacancies',
  '/opportunities',
]

async function fetchCareerPage(website: string): Promise<{ html: string; url: string } | null> {
  const base = website.startsWith('http') ? website : `https://${website}`

  for (const path of CAREERS_PATH_CANDIDATES) {
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
        // Quick sanity check: page should have some job-related content
        if (
          html.toLowerCase().includes('job') ||
          html.toLowerCase().includes('career') ||
          html.toLowerCase().includes('hiring') ||
          html.toLowerCase().includes('vacancy')
        ) {
          return { html, url }
        }
      }
    } catch {
      // Try next path
    }
  }
  return null
}

function extractJobsFromHTML(html: string, baseUrl: string): CareerPageJob[] {
  const $ = cheerio.load(html)
  const jobs: CareerPageJob[] = []

  // Try JSON-LD structured data first
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
            source: 'career_page',
            source_url: item.url || baseUrl,
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
      // Ignore
    }
  })

  if (jobs.length > 0) return jobs

  // Generic HTML extraction — look for job listing patterns
  const jobSelectors = [
    '[class*="job-listing"]',
    '[class*="job-card"]',
    '[class*="career-card"]',
    '[class*="vacancy"]',
    '[class*="position"]',
    '[data-job]',
    'li[class*="job"]',
    'article[class*="job"]',
    'div[class*="job-item"]',
    'tr[class*="job"]',
  ]

  for (const selector of jobSelectors) {
    $(selector).each((_, el) => {
      const $el = $(el)
      const title = $el
        .find('h1, h2, h3, h4, [class*="title"], strong')
        .first()
        .text()
        .trim()
      const location = $el
        .find('[class*="location"], [class*="place"]')
        .first()
        .text()
        .trim()
      const jobType = $el
        .find('[class*="type"], [class*="employment"]')
        .first()
        .text()
        .trim()
      const link = $el.find('a').first().attr('href')
      const department = $el
        .find('[class*="department"], [class*="team"]')
        .first()
        .text()
        .trim()

      if (!title || title.length < 3) return

      const resolvedUrl = link
        ? link.startsWith('http')
          ? link
          : `${new URL(baseUrl).origin}${link.startsWith('/') ? '' : '/'}${link}`
        : baseUrl

      jobs.push({
        title,
        department: department || null,
        location: location || 'Singapore',
        job_type: jobType || null,
        source: 'career_page',
        source_url: resolvedUrl,
        posted_at: null,
        salary_min: null,
        salary_max: null,
        currency: 'SGD',
        raw_data: { title, location, jobType, department, link },
      })
    })
    if (jobs.length > 0) break
  }

  // If still nothing, try generic heading + link pattern
  if (jobs.length === 0) {
    $('h3, h4').each((_, el) => {
      const $el = $(el)
      const text = $el.text().trim()
      const link = $el.closest('a').attr('href') || $el.find('a').attr('href')
      // Filter out navigation/generic headings
      if (
        text.length > 5 &&
        text.length < 100 &&
        (text.toLowerCase().includes('engineer') ||
          text.toLowerCase().includes('manager') ||
          text.toLowerCase().includes('director') ||
          text.toLowerCase().includes('analyst') ||
          text.toLowerCase().includes('coordinator') ||
          text.toLowerCase().includes('developer') ||
          text.toLowerCase().includes('designer') ||
          text.toLowerCase().includes('executive') ||
          text.toLowerCase().includes('specialist') ||
          text.toLowerCase().includes('trainer') ||
          text.toLowerCase().includes('instructor'))
      ) {
        jobs.push({
          title: text,
          department: null,
          location: 'Singapore',
          job_type: null,
          source: 'career_page',
          source_url: link
            ? link.startsWith('http')
              ? link
              : `${new URL(baseUrl).origin}${link}`
            : baseUrl,
          posted_at: null,
          salary_min: null,
          salary_max: null,
          currency: 'SGD',
          raw_data: { title: text, link },
        })
      }
    })
  }

  return jobs
}

export async function scrapeCareerPage(
  website: string,
  competitorName: string
): Promise<ScraperResult<CareerPageJob[]>> {
  const scraped_at = new Date().toISOString()

  try {
    const result = await fetchCareerPage(website)
    if (!result) {
      return {
        success: false,
        data: null,
        error: `No careers page found for ${competitorName} at ${website}`,
        scraped_at,
        source: website,
      }
    }

    const jobs = extractJobsFromHTML(result.html, result.url)

    return {
      success: true,
      data: jobs,
      error: null,
      scraped_at,
      source: result.url,
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
