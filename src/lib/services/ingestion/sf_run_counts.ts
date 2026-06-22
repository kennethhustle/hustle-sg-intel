/**
 * sf_run_counts.ts
 *
 * Puppeteer-based scraper for MySkillsFuture course run counts.
 * Course pages are publicly accessible — no Singpass login required.
 *
 * Scraping approach:
 *   1. Query Supabase for top N courses per provider (by popularity_score)
 *   2. Navigate to each course's Schedule tab via headless Chrome
 *   3. Extract "Showing X–Y of N course runs" count via regex
 *   4. Return array of { sf_ref_no, upcoming_run_count } pairs
 *
 * Uses @sparticuz/chromium + puppeteer-core for Vercel compatibility.
 */

import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createServiceClient } from '@/lib/supabase/server'

const COURSES_PER_PROVIDER = 5
const BATCH_SIZE = 3
const PAGE_WAIT_MS = 6000 // wait for JS render
const RUN_COUNT_REGEX = /Showing\s+[\d\-–]+\s+of\s+(\d+)\s+course\s+run/i

export interface RunCountResult {
  sf_ref_no: string
  course_url: string
  upcoming_run_count: number
  error: string | null
}

export interface RunCountSummary {
  scraped: number
  updated: number
  errors: number
  results: RunCountResult[]
  started_at: string
}

/** Build the MySkillsFuture course Schedule tab URL from a ref number */
function buildCourseUrl(sfRefNo: string): string {
  return `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${sfRefNo}#schedule`
}

/** Extract run count from page text, returns null if not found */
function extractRunCount(text: string): number | null {
  const match = text.match(RUN_COUNT_REGEX)
  if (!match) return null
  const count = parseInt(match[1], 10)
  return isNaN(count) ? null : count
}

/** Scrape a single batch of URLs in parallel using one browser instance */
async function scrapeBatch(
  browser: puppeteer.Browser,
  batch: Array<{ sf_ref_no: string; course_url: string }>
): Promise<RunCountResult[]> {
  // Open all pages in parallel
  const pagePromises = batch.map(async (item) => {
    const page = await browser.newPage()
    try {
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      )
      // Block images/fonts to speed up loading
      await page.setRequestInterception(true)
      page.on('request', (req) => {
        const type = req.resourceType()
        if (['image', 'font', 'stylesheet'].includes(type)) {
          req.abort()
        } else {
          req.continue()
        }
      })
      await page.goto(item.course_url, { waitUntil: 'domcontentloaded', timeout: 30000 })
    } catch (navErr) {
      // Navigation error — page might still have partial content
      console.warn(`Navigation warning for ${item.sf_ref_no}:`, navErr)
    }
    return { page, ...item }
  })

  const pages = await Promise.all(pagePromises)

  // Wait once for JS to render run count text
  await new Promise<void>((resolve) => setTimeout(resolve, PAGE_WAIT_MS))

  // Read all pages
  const results: RunCountResult[] = []
  for (const { page, sf_ref_no, course_url } of pages) {
    try {
      const text = await page.evaluate(() => document.body?.innerText ?? '')
      const count = extractRunCount(text)
      results.push({
        sf_ref_no,
        course_url,
        upcoming_run_count: count ?? 0,
        error: count === null ? 'Run count text not found on page' : null,
      })
    } catch (err) {
      results.push({
        sf_ref_no,
        course_url,
        upcoming_run_count: 0,
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      await page.close().catch(() => {})
    }
  }

  return results
}

/** Main entry point: fetch courses from Supabase, scrape run counts, update DB */
export async function scrapeAndUpdateRunCounts(): Promise<RunCountSummary> {
  const started_at = new Date().toISOString()
  const supabase = await createServiceClient()

  // Fetch top N courses per provider that have a course URL
  // We use a subquery approach: get all courses ordered by provider + popularity,
  // then deduplicate to top N per provider in JS (Supabase doesn't support DISTINCT ON easily)
  const { data: allCourses, error: fetchErr } = await supabase
    .from('sf_courses')
    .select('sf_ref_no, provider_name, popularity_score')
    .order('provider_name', { ascending: true })
    .order('popularity_score', { ascending: false })

  if (fetchErr || !allCourses) {
    throw new Error(`Failed to fetch courses: ${fetchErr?.message}`)
  }

  // Pick top N per provider
  const providerCounts = new Map<string, number>()
  const selectedCourses: Array<{ sf_ref_no: string; course_url: string }> = []

  for (const course of allCourses) {
    const provider = course.provider_name
    const count = providerCounts.get(provider) ?? 0
    if (count < COURSES_PER_PROVIDER) {
      providerCounts.set(provider, count + 1)
      selectedCourses.push({
        sf_ref_no: course.sf_ref_no,
        course_url: buildCourseUrl(course.sf_ref_no),
      })
    }
  }

  console.log(`Scraping ${selectedCourses.length} courses across ${providerCounts.size} providers`)

  // Launch headless Chrome
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  })

  const allResults: RunCountResult[] = []

  try {
    // Process in batches of BATCH_SIZE
    for (let i = 0; i < selectedCourses.length; i += BATCH_SIZE) {
      const batch = selectedCourses.slice(i, i + BATCH_SIZE)
      console.log(`Scraping batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.map(c => c.sf_ref_no).join(', ')}`)
      const batchResults = await scrapeBatch(browser, batch)
      allResults.push(...batchResults)

      // Small delay between batches to be polite
      if (i + BATCH_SIZE < selectedCourses.length) {
        await new Promise<void>((resolve) => setTimeout(resolve, 2000))
      }
    }
  } finally {
    await browser.close().catch(() => {})
  }

  // Update sf_courses.upcoming_run_count for successful scrapes
  let updated = 0
  const successful = allResults.filter((r) => r.error === null)

  for (const result of successful) {
    const { error: updateErr } = await supabase
      .from('sf_courses')
      .update({ upcoming_run_count: result.upcoming_run_count })
      .eq('sf_ref_no', result.sf_ref_no)

    if (!updateErr) {
      updated++
    } else {
      console.error(`Failed to update ${result.sf_ref_no}:`, updateErr.message)
    }
  }

  // Rebuild provider_top_runs table
  await rebuildProviderTopRuns(supabase)

  return {
    scraped: allResults.length,
    updated,
    errors: allResults.filter((r) => r.error !== null).length,
    results: allResults,
    started_at,
  }
}

/** Rebuild the provider_top_runs table from current sf_courses data */
async function rebuildProviderTopRuns(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<void> {
  // Get all courses with run counts
  const { data: courses, error } = await supabase
    .from('sf_courses')
    .select('sf_ref_no, title, provider_name, upcoming_run_count, competitor_id')
    .gt('upcoming_run_count', 0)
    .order('provider_name', { ascending: true })
    .order('upcoming_run_count', { ascending: false })

  if (error || !courses) {
    console.error('Failed to fetch courses for provider_top_runs rebuild:', error?.message)
    return
  }

  // Get competitor name mapping
  const { data: competitors } = await supabase
    .from('competitors')
    .select('id, name')

  const compMap = new Map((competitors ?? []).map((c: { id: number; name: string }) => [c.id, c.name]))

  // Pick top 3 per provider
  const providerCounts = new Map<string, number>()
  const rows: Array<{
    provider: string
    course_name: string
    course_url: string
    upcoming_run_count: number
    rank: number
    competitor_name: string | null
    scraped_at: string
  }> = []

  const scraped_at = new Date().toISOString()

  for (const course of courses) {
    const provider = course.provider_name
    const rank = (providerCounts.get(provider) ?? 0) + 1
    if (rank > 3) continue
    providerCounts.set(provider, rank)

    rows.push({
      provider,
      course_name: course.title,
      course_url: buildCourseUrl(course.sf_ref_no),
      upcoming_run_count: course.upcoming_run_count,
      rank,
      competitor_name: compMap.get(course.competitor_id) ?? null,
      scraped_at,
    })
  }

  if (rows.length === 0) return

  // Clear and repopulate
  await supabase.from('provider_top_runs').delete().neq('id', 0)
  const { error: insertErr } = await supabase.from('provider_top_runs').insert(rows)

  if (insertErr) {
    console.error('Failed to rebuild provider_top_runs:', insertErr.message)
  } else {
    console.log(`Rebuilt provider_top_runs with ${rows.length} rows`)
  }
}
