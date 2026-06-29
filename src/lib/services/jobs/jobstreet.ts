import type { ScraperResult } from '@/lib/types'
import { withBrowser } from '@/lib/services/scraper/browser'
import type { Page } from 'puppeteer-core'

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

// JobStreet (a SEEK network site) is a hydrated SPA behind bot protection: a
// plain `fetch` is served a 403/empty shell. The real listing data is embedded
// as structured JSON in the server-rendered `window.SEEK_REDUX_DATA` blob
// (results.results.jobs[]) and rendered into DOM nodes that carry SEEK's stable
// `data-automation` test hooks. We load the page with the shared stealth
// browser service and read the structured JSON first, falling back to the
// data-automation DOM nodes — never brittle CSS class selectors.

const GENERIC_COMPANY_TOKENS = new Set([
  'pte', 'ltd', 'llp', 'inc', 'limited', 'the', 'and', 'academy', 'institute',
  'training', 'school', 'college', 'singapore', 'sg', 'co', 'company', 'group',
])

function significantTokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !GENERIC_COMPANY_TOKENS.has(t))
}

/** Loose, suffix-insensitive company match (e.g. "Vertical Institute Pte Ltd"). */
function companyMatches(competitor: string, company: string | null | undefined): boolean {
  if (!company) return false
  const wanted = significantTokens(competitor)
  if (wanted.length === 0) return true // nothing distinctive to match on — keep it
  const have = new Set(significantTokens(company))
  return wanted.some((t) => have.has(t))
}

function parseSalaryLabel(label: string | null | undefined): {
  salary_min: number | null
  salary_max: number | null
} {
  if (!label) return { salary_min: null, salary_max: null }
  // Examples: "$3,000 – $5,000 per month", "$25 – $35 per hour", "SGD 60,000".
  const nums = label.match(/[\d][\d,]*/g)
  if (!nums || nums.length === 0) return { salary_min: null, salary_max: null }
  const values = nums
    .map((n) => parseInt(n.replace(/,/g, ''), 10))
    .filter((n) => !isNaN(n))
  if (values.length === 0) return { salary_min: null, salary_max: null }
  const min = values[0]
  const max = values.length > 1 ? values[1] : values[0]
  return { salary_min: min ?? null, salary_max: max ?? null }
}

/** String-aware `{...}` matcher starting at `start` (the opening brace). */
function matchBraces(html: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return html.slice(start, i + 1)
    }
  }
  return null
}

interface ReduxJob {
  id?: string | number
  title?: string
  companyName?: string
  advertiser?: { description?: string }
  salaryLabel?: string
  listingDate?: string
  workTypes?: string[]
  locations?: Array<{ label?: string }>
  classifications?: Array<{ classification?: { description?: string } }>
  employer?: { companyUrl?: string }
}

function mapReduxJob(j: ReduxJob): JobStreetJob | null {
  if (!j || !j.title) return null
  const company = j.companyName || j.advertiser?.description || null
  const { salary_min, salary_max } = parseSalaryLabel(j.salaryLabel)
  return {
    title: j.title,
    department: j.classifications?.[0]?.classification?.description ?? null,
    location: j.locations?.[0]?.label ?? 'Singapore',
    job_type:
      Array.isArray(j.workTypes) && j.workTypes.length ? j.workTypes.join(', ') : null,
    source: 'jobstreet',
    source_url: j.id != null ? `https://sg.jobstreet.com/job/${j.id}` : null,
    posted_at: j.listingDate ?? null,
    salary_min,
    salary_max,
    currency: 'SGD',
    raw_data: {
      id: j.id ?? null,
      title: j.title,
      companyName: company,
      salaryLabel: j.salaryLabel ?? null,
      listingDate: j.listingDate ?? null,
      workTypes: j.workTypes ?? null,
      location: j.locations?.[0]?.label ?? null,
      classification: j.classifications?.[0]?.classification?.description ?? null,
      companyUrl: j.employer?.companyUrl ?? null,
    },
  }
}

/** Primary path: structured jobs from the embedded SEEK_REDUX_DATA JSON. */
function extractFromRedux(html: string, companyName: string): JobStreetJob[] {
  const marker = html.indexOf('SEEK_REDUX_DATA')
  if (marker === -1) return []
  const start = html.indexOf('{', marker)
  if (start === -1) return []
  const jsonStr = matchBraces(html, start)
  if (!jsonStr) return []

  let data: { results?: { results?: { jobs?: ReduxJob[] } } }
  try {
    data = JSON.parse(jsonStr)
  } catch {
    return []
  }
  const jobs = data?.results?.results?.jobs
  if (!Array.isArray(jobs)) return []

  const mapped = jobs.map(mapReduxJob).filter((j): j is JobStreetJob => j !== null)
  const matched = mapped.filter((j) =>
    companyMatches(companyName, j.raw_data.companyName as string | null)
  )
  // If a company filter would drop everything, the keyword search results are
  // still the best signal we have — keep them rather than returning nothing.
  return matched.length > 0 ? matched : mapped
}

/** Fallback path: SEEK's stable `data-automation` DOM hooks (not CSS classes). */
async function extractFromDom(page: Page, companyName: string): Promise<JobStreetJob[]> {
  const raw = await page.evaluate(() => {
    const cards = Array.from(
      document.querySelectorAll('[data-automation="normalJob"], article[data-card-type]')
    )
    return cards
      .map((card) => {
        const titleEl = card.querySelector(
          '[data-automation="jobTitle"]'
        ) as HTMLAnchorElement | null
        const title = titleEl?.textContent?.trim() || ''
        const href =
          titleEl?.getAttribute('href') ||
          (titleEl?.closest('a') as HTMLAnchorElement | null)?.getAttribute('href') ||
          ''
        const company =
          card.querySelector('[data-automation="jobCompany"]')?.textContent?.trim() || ''
        const location =
          card.querySelector('[data-automation="jobLocation"]')?.textContent?.trim() || ''
        const salary =
          card.querySelector('[data-automation="jobSalary"]')?.textContent?.trim() || ''
        const date =
          card.querySelector('[data-automation="jobListingDate"]')?.textContent?.trim() || ''
        const department =
          card.querySelector('[data-automation="jobClassification"]')?.textContent?.trim() ||
          ''
        return { title, href, company, location, salary, date, department }
      })
      .filter((j) => j.title)
  })

  const mapped: JobStreetJob[] = raw.map((j) => {
    const { salary_min, salary_max } = parseSalaryLabel(j.salary)
    const source_url = j.href
      ? j.href.startsWith('http')
        ? j.href
        : `https://sg.jobstreet.com${j.href}`
      : null
    return {
      title: j.title,
      department: j.department || null,
      location: j.location || 'Singapore',
      job_type: null,
      source: 'jobstreet',
      source_url,
      posted_at: null,
      salary_min,
      salary_max,
      currency: 'SGD',
      raw_data: {
        title: j.title,
        companyName: j.company || null,
        location: j.location,
        salaryLabel: j.salary,
        date: j.date,
      },
    }
  })

  const matched = mapped.filter((j) =>
    companyMatches(companyName, j.raw_data.companyName as string | null)
  )
  return matched.length > 0 ? matched : mapped
}

export async function scrapeJobStreet(
  companyName: string
): Promise<ScraperResult<JobStreetJob[]>> {
  const scraped_at = new Date().toISOString()
  const url = `https://sg.jobstreet.com/jobs?keywords=${encodeURIComponent(companyName)}`

  try {
    const jobs = await withBrowser(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
      // The listing data is server-rendered, but wait briefly for the job nodes
      // so the DOM fallback is reliable if the embedded JSON shape ever changes.
      await page
        .waitForSelector('[data-automation="jobTitle"]', { timeout: 15_000 })
        .catch(() => {})

      const html = await page.content()
      const fromJson = extractFromRedux(html, companyName)
      if (fromJson.length > 0) return fromJson
      return extractFromDom(page, companyName)
    })

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
