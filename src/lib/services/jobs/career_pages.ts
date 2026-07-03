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

// Per-competitor career-page URL overrides. Some competitors publish jobs on a
// domain/path that the generic discovery below cannot reach (e.g. a wrong
// seeded domain, or a /careers path that redirects to the homepage). When an
// override exists it is fetched directly and the generic path discovery is
// skipped for that competitor only — everyone else is unaffected. Keyed by the
// competitor's display name.
const CAREER_PAGE_OVERRIDES: Record<string, string> = {
  'InfoTech Academy': 'https://www.info-tech.com.sg/career',
}

// Fetch a single known career-page URL directly (used for CAREER_PAGE_OVERRIDES).
async function fetchCareerUrl(url: string): Promise<{ html: string; url: string } | null> {
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
      return { html, url }
    }
  } catch {
    // fall through to null
  }
  return null
}

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

// --- Strict role-title validation -------------------------------------------
// The career-page scraper walks arbitrary marketing HTML, so it must reject
// perk/benefit/marketing lines and only keep text that reads like a real role.
const REJECT_TITLE_PATTERNS: RegExp[] = [
  /\bbenefits?\b/i,
  /\bbonus(es)?\b/i,
  /\bperks?\b/i,
  /career growth/i,
  /growth opportunit/i,
  /flexi[\s-]?cash/i,
  /\bmedical\b|\bdental\b/i,
  /hybrid work/i,
  /work arrangement/i,
  /company\s*(?:&|and)?\s*performance/i,
  /performance bonus/i,
  /annual leave/i,
  /nurturing environment/i,
  /insurance|allowance/i,
  /projected to reach/i,
  /market is projected/i,
  /\btrillion\b|\bbillion\b/i,
]

// Learning-content markers. Training-provider career pages advertise courses,
// programmes, certifications and workshops alongside (or instead of) real
// vacancies. These words appear in learning offerings but effectively never in
// a genuine short job title, so any title containing one is rejected across
// EVERY extraction path. Words that legitimately head real roles — "Course
// Consultant", "Programme Manager", "Curriculum Developer", "Training
// Executive", "Marketing Strategist" (singular) — are deliberately NOT listed
// so genuine job extraction is unaffected.
const COURSE_TITLE_PATTERNS: RegExp[] = [
  /\bcertified\b/i,
  /\bcertification\b/i,
  /\bcertificate\b/i,
  /\bworkshop\b/i,
  /\bboot ?camp\b/i,
  /\bmaster ?class\b/i,
  /\bseminar\b/i,
  /\bwebinar\b/i,
  /\bsyllabus\b/i,
  /\bcourseware\b/i,
  /\bmodules?\b/i,
  /\benrol/i,
  /\bintake\b/i,
  /\bfundamentals\b/i,
  /\bstrategies\b/i,
]

// Whitelisted role signals — at least one must appear for the unstructured
// (job-card / link / heading) extraction paths to accept a title.
const ROLE_KEYWORD_RE =
  /\b(trainer|instructor|teacher|tutor|lecturer|executive|manager|consultant|specialist|designer|developer|engineer|analyst|sales|marketing|content creator|copywriter|editor|producer|business development|finance|accountant|operations|coordinator|director|administrator|admin|officer|associate|recruiter|human resource|hr|strategist|assistant|technician|architect|scientist|advisor|planner|representative|supervisor|intern)\b/i

// Responsibility/requirement/qualification signals for the UNSTRUCTURED paths
// only. Job-description bullet lines frequently contain a role keyword (e.g.
// "sales", "marketing") yet are not titles. These words never appear in a
// genuine short job title, so they are safe to reject here.
const NON_TITLE_PATTERNS: RegExp[] = [
  /\bKPIs?\b/i, // metrics ("... sales targets and KPIs")
  /\bfamiliarity\b/i, // requirement ("Familiarity with ...")
  /\bunderstanding\b/i, // requirement ("Good understanding of ...")
  /\b(?:bachelor|master)'?s?\b/i, // qualification ("Bachelor's degree ...")
  /\b(?:degree|diploma)\b/i, // qualification ("... degree in marketing")
  /related field/i, // qualification ("... or related field")
  /\bspectrum\b/i, // responsibility ("... full spectrum of ...")
  // Sentence / marketing / showcase connectives. Genuine job titles are terse
  // noun phrases and effectively never contain these function words, whereas
  // project bullets, blog/tutorial headings and marketing banners do (e.g.
  // "... the Yahoo Finance API for ...", "... Marketing With AI", "Instructors
  // from Top Companies"). "of" is deliberately excluded because it heads real
  // titles ("Head of Marketing", "Director of Sales").
  /\b(?:the|for|with|from|your|our|their|top)\b/i,
]

// Genuine job titles do not begin with a verb. Responsibility bullets begin
// with an imperative ("Prepare ...", "Track ...") and project / portfolio /
// showcase items begin with a past-tense accomplishment verb ("Integrated ...",
// "Built ...", "Developed ..."). Neither is a job title. "support" is
// deliberately excluded because it legitimately starts real titles
// (e.g. "Support Engineer").
const RESPONSIBILITY_LEAD_RE =
  /^(?:prepare|track|provide|coordinate|meet|develop|ensure|conduct|assist|handle|achieve|maintain|liaise|generate|identify|monitor|oversee|perform|execute|deliver|drive|build|create|collaborate|respond|process|update|review|integrated|built|developed|created|designed|implemented|engineered|launched|deployed|architected|migrated|optimized|automated|analyzed|configured|programmed)\b/i

/** True for paragraphs, sentences, and perk/benefit/marketing lines. */
function isRejectedTitle(title: string): boolean {
  const t = title.trim()
  if (!t || t.length < 3 || t.length > 80) return true
  const words = t.split(/\s+/)
  if (words.length > 10) return true
  if (/[.!?]$/.test(t) && words.length > 6) return true
  if (COURSE_TITLE_PATTERNS.some((re) => re.test(t))) return true
  return REJECT_TITLE_PATTERNS.some((re) => re.test(t))
}

/** Stricter check for unstructured text: must look like an actual job role. */
function looksLikeRole(title: string): boolean {
  const t = title.trim()
  if (isRejectedTitle(t)) return false
  if (RESPONSIBILITY_LEAD_RE.test(t)) return false
  if (NON_TITLE_PATTERNS.some((re) => re.test(t))) return false
  return ROLE_KEYWORD_RE.test(t)
}

function resolveUrl(link: string | undefined, baseUrl: string): string {
  if (!link) return baseUrl
  if (link.startsWith('http')) return link
  return `${new URL(baseUrl).origin}${link.startsWith('/') ? '' : '/'}${link}`
}

function extractJobsFromHTML(html: string, baseUrl: string): CareerPageJob[] {
  const $ = cheerio.load(html)
  const jobs: CareerPageJob[] = []
  const seen = new Set<string>()

  const add = (job: CareerPageJob) => {
    const key = job.title.trim().toLowerCase()
    if (!key || seen.has(key)) return
    seen.add(key)
    jobs.push(job)
  }

  // 1. Structured data first: JSON-LD JobPosting. Authoritative, so only the
  //    obvious-non-job reject list is applied (no role-keyword requirement).
  $('script[type="application/ld+json"]').each((_, script) => {
    try {
      const data = JSON.parse($(script).html() || '{}')
      const items = Array.isArray(data) ? data : [data]
      for (const item of items) {
        if (item['@type'] !== 'JobPosting') continue
        const title = (item.title || '').trim()
        if (!title || isRejectedTitle(title)) continue
        add({
          title,
          department: item.occupationalCategory || null,
          location:
            item.jobLocation?.address?.addressLocality ||
            item.jobLocation?.address?.addressRegion ||
            'Singapore',
          job_type: item.employmentType || null,
          source: 'career_page',
          source_url: item.url || baseUrl,
          posted_at: item.datePosted ? new Date(item.datePosted).toISOString() : null,
          salary_min: item.baseSalary?.value?.minValue || null,
          salary_max: item.baseSalary?.value?.maxValue || null,
          currency: item.baseSalary?.currency || 'SGD',
          raw_data: item as Record<string, unknown>,
        })
      }
    } catch {
      // Ignore malformed JSON-LD
    }
  })

  if (jobs.length > 0) return jobs

  // 2. Job cards / career listing sections — must read like a real role.
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
      const title = $el.find('h1, h2, h3, h4, [class*="title"], strong').first().text().trim()
      if (!looksLikeRole(title)) return
      const location = $el.find('[class*="location"], [class*="place"]').first().text().trim()
      const jobType = $el.find('[class*="type"], [class*="employment"]').first().text().trim()
      const department = $el.find('[class*="department"], [class*="team"]').first().text().trim()
      const link = $el.find('a').first().attr('href')
      add({
        title,
        department: department || null,
        location: location || 'Singapore',
        job_type: jobType || null,
        source: 'career_page',
        source_url: resolveUrl(link, baseUrl),
        posted_at: null,
        salary_min: null,
        salary_max: null,
        currency: 'SGD',
        raw_data: { title, location, jobType, department, link },
      })
    })
    if (jobs.length > 0) break
  }

  if (jobs.length > 0) return jobs

  // 3. Application links — anchors pointing at a job/apply page whose visible
  //    text reads like a role.
  $(
    'a[href*="job"], a[href*="career"], a[href*="apply"], a[href*="position"], a[href*="vacanc"], a[href*="role"], a[href*="opening"]'
  ).each((_, el) => {
    const $a = $(el)
    const title = $a.text().trim()
    if (!looksLikeRole(title)) return
    add({
      title,
      department: null,
      location: 'Singapore',
      job_type: null,
      source: 'career_page',
      source_url: resolveUrl($a.attr('href'), baseUrl),
      posted_at: null,
      salary_min: null,
      salary_max: null,
      currency: 'SGD',
      raw_data: { title, link: $a.attr('href') ?? null },
    })
  })

  if (jobs.length > 0) return jobs

  // 4. Last-resort heading / list-item fallback — strict role check only.
  $('h2, h3, h4, li').each((_, el) => {
    const $el = $(el)
    const text = $el.text().trim()
    if (!looksLikeRole(text)) return
    const link = $el.closest('a').attr('href') || $el.find('a').attr('href')
    add({
      title: text,
      department: null,
      location: 'Singapore',
      job_type: null,
      source: 'career_page',
      source_url: resolveUrl(link, baseUrl),
      posted_at: null,
      salary_min: null,
      salary_max: null,
      currency: 'SGD',
      raw_data: { title: text, link: link ?? null },
    })
  })

  return jobs
}

export async function scrapeCareerPage(
  website: string,
  competitorName: string
): Promise<ScraperResult<CareerPageJob[]>> {
  const scraped_at = new Date().toISOString()

  try {
    const override = CAREER_PAGE_OVERRIDES[competitorName]
    let result: { html: string; url: string } | null
    if (override) {
      console.log(`[career] Using override URL for competitor "${competitorName}"`)
      result = await fetchCareerUrl(override)
    } else {
      result = await fetchCareerPage(website)
    }
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
