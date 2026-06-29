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

import fs from 'node:fs'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import { createServiceClient } from '@/lib/supabase/server'

const COURSES_PER_PROVIDER = 5
const BATCH_SIZE = 3
const RUN_COUNT_TIMEOUT_MS = 20000 // max wait for the run-count text to hydrate

// Priority-ordered patterns. New MySkillsFuture app (courses.myskillsfuture.gov.sg)
// renders "View all N course runs" / "Apply to one of the N available course dates";
// legacy portal rendered "Showing X–Y of N course runs". First match wins.
const RUN_COUNT_PATTERNS: { source: RunCountSource; re: RegExp }[] = [
  { source: 'view_all',         re: /View\s+all\s+(\d+)\s+course\s+runs?/i },
  { source: 'available_dates',  re: /one\s+of\s+the\s+(\d+)\s+available\s+course\s+dates?/i },
  { source: 'legacy',           re: /Showing\s+[\d\-–]+\s+of\s+(\d+)\s+course\s+run/i },
]

export type RunCountSource = 'view_all' | 'available_dates' | 'legacy' | 'failed_keep_previous'

export interface RunCountResult {
  sf_ref_no: string
  course_url: string
  upcoming_run_count: number
  source: RunCountSource
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

/**
 * Provider-name normalization mirroring the dashboard grouping in
 * course-intelligence/page.tsx (grp()). Keeps run-count selection aligned with
 * the leaderboard so we scrape exactly the course each provider's value comes from.
 */
const PROVIDER_GROUP: Record<string, string> = {
  'BELLS INSTITUTE OF HIGHER LEARNING PTE. LTD.': 'BELLS Institute',
  'VERTICAL INSTITUTE PTE. LTD.':                 'Vertical Institute',
  'OOM PTE. LTD.':                                'OOm Pte Ltd',
  'SKILLS DEVELOPMENT ACADEMY PTE. LTD.':         'Skills Dev Academy',
  'INFO-TECH SYSTEMS LTD.':                       'InfoTech Academy',
  '@ASK TRAINING PTE. LTD.':                      'ASK Training',
  'HEICODERS ACADEMY PRIVATE LIMITED':            'Heicoders Academy',
  'HAPPY TOGETHER PTE. LTD.':                     'Happy Together',
  'EQUINET ACADEMY PRIVATE LIMITED':              'Equinet Academy',
  'HUSTLE INSTITUTE PTE. LTD.':                   'Hustle SG',
  'HUSTLE ACADEMY PTE. LTD.':                     'Hustle SG',
}
function normalizeProvider(raw: string): string {
  if ((raw ?? '').toUpperCase().includes('HUSTLE')) return 'Hustle SG'
  return PROVIDER_GROUP[raw] ?? raw
}

interface SelectedCourse {
  sf_ref_no: string
  course_url: string
  provider: string      // normalized (display) provider name
  raw_provider: string  // original sf_courses.provider_name
  title: string
  old_count: number     // current sf_courses.upcoming_run_count before re-scrape
}

/**
 * Primary selection: the single course that currently produces each provider's
 * leaderboard value — the highest upcoming_run_count course per normalized provider.
 * Mirrors the dashboard ranking and yields ~10 courses (one per displayed provider).
 * Returns [] when no provider has any run data yet (caller falls back).
 */
async function selectLeaderCourses(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<SelectedCourse[]> {
  const { data, error } = await supabase
    .from('sf_courses')
    .select('sf_ref_no, provider_name, title, upcoming_run_count')
    .order('upcoming_run_count', { ascending: false })

  if (error || !data) {
    throw new Error(`Failed to fetch courses for leader selection: ${error?.message}`)
  }

  // data is sorted desc, so the first row seen per provider is its current leader.
  const leaderByProvider = new Map<string, SelectedCourse>()
  for (const c of data) {
    const provider = normalizeProvider(c.provider_name)
    if (leaderByProvider.has(provider)) continue          // already have this provider's max
    if ((c.upcoming_run_count ?? 0) <= 0) continue         // no real leader yet for this provider
    leaderByProvider.set(provider, {
      sf_ref_no: c.sf_ref_no,
      course_url: buildCourseUrl(c.sf_ref_no),
      provider,
      raw_provider: c.provider_name,
      title: c.title ?? '',
      old_count: c.upcoming_run_count ?? 0,
    })
  }
  return [...leaderByProvider.values()]
}

/**
 * Fallback selection (only used when no provider has run data yet): the original
 * top-N-per-provider-by-popularity behaviour.
 */
async function selectTopByPopularity(
  supabase: Awaited<ReturnType<typeof createServiceClient>>
): Promise<SelectedCourse[]> {
  const { data, error } = await supabase
    .from('sf_courses')
    .select('sf_ref_no, provider_name, title, upcoming_run_count, popularity_score')
    .order('provider_name', { ascending: true })
    .order('popularity_score', { ascending: false })

  if (error || !data) {
    throw new Error(`Failed to fetch courses for fallback selection: ${error?.message}`)
  }

  const providerCounts = new Map<string, number>()
  const out: SelectedCourse[] = []
  for (const c of data) {
    const raw = c.provider_name
    const n = providerCounts.get(raw) ?? 0
    if (n < COURSES_PER_PROVIDER) {
      providerCounts.set(raw, n + 1)
      out.push({
        sf_ref_no: c.sf_ref_no,
        course_url: buildCourseUrl(c.sf_ref_no),
        provider: normalizeProvider(raw),
        raw_provider: raw,
        title: c.title ?? '',
        old_count: c.upcoming_run_count ?? 0,
      })
    }
  }
  return out
}

/**
 * Launch a headless browser.
 * Production (Vercel/Lambda): bundled @sparticuz/chromium binary — UNCHANGED.
 * Local dev: an installed Chrome/Edge (env override or common install paths),
 * since the @sparticuz binary is Linux-only and cannot run on a dev machine.
 */
async function launchBrowser(): Promise<puppeteer.Browser> {
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    })
  }

  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((p): p is string => !!p)
  const executablePath = candidates.find((p) => { try { return fs.existsSync(p) } catch { return false } })
  if (!executablePath) {
    throw new Error('No local Chrome/Edge found. Set PUPPETEER_EXECUTABLE_PATH to run run-count scraping locally.')
  }
  console.log(`[runcount] local browser: ${executablePath}`)
  return puppeteer.launch({
    executablePath,
    headless: true,
    defaultViewport: { width: 1280, height: 800 },
  })
}

/** Extract run count from page text using priority patterns; null if none match */
function extractRunCount(text: string): { count: number; source: RunCountSource } | null {
  for (const { source, re } of RUN_COUNT_PATTERNS) {
    const match = text.match(re)
    if (!match) continue
    const count = parseInt(match[1], 10)
    if (!isNaN(count)) return { count, source }
  }
  return null
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

  // Read all pages, waiting per-page until the run-count text hydrates.
  const results: RunCountResult[] = []
  for (const { page, sf_ref_no, course_url } of pages) {
    try {
      // SPA renders the schedule asynchronously — poll until any supported
      // run-count phrase appears instead of sleeping a fixed interval.
      await page
        .waitForFunction(
          () =>
            /View\s+all\s+\d+\s+course\s+runs?/i.test(document.body?.innerText ?? '') ||
            /one\s+of\s+the\s+\d+\s+available\s+course\s+dates?/i.test(document.body?.innerText ?? '') ||
            /Showing\s+[\d\-–]+\s+of\s+\d+\s+course\s+run/i.test(document.body?.innerText ?? ''),
          { timeout: RUN_COUNT_TIMEOUT_MS }
        )
        .catch(() => {})
      const text = await page.evaluate(() => document.body?.innerText ?? '')
      const hit = extractRunCount(text)
      results.push({
        sf_ref_no,
        course_url,
        upcoming_run_count: hit?.count ?? 0,
        source: hit?.source ?? 'failed_keep_previous',
        error: hit === null ? 'Run count text not found on page' : null,
      })
    } catch (err) {
      results.push({
        sf_ref_no,
        course_url,
        upcoming_run_count: 0,
        source: 'failed_keep_previous',
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

  // Select the course behind each provider's current leaderboard value (~10 pages).
  // Fall back to top-5/popularity only if no provider has any run data yet.
  let selectedCourses = await selectLeaderCourses(supabase)
  let selectionMode = 'leader'
  if (selectedCourses.length === 0) {
    console.warn('[runcount] No provider has run data yet — falling back to top-5 by popularity')
    selectedCourses = await selectTopByPopularity(supabase)
    selectionMode = 'fallback-top5'
  }

  console.log(
    `[runcount] selection=${selectionMode}; scraping ${selectedCourses.length} course(s): ` +
    selectedCourses.map((c) => `${c.provider}:${c.sf_ref_no}(old=${c.old_count})`).join(', ')
  )

  // Launch headless Chrome (prod: @sparticuz/chromium; local: installed Chrome/Edge)
  const browser = await launchBrowser()

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

  // Update sf_courses.upcoming_run_count for successful scrapes, with per-course logging.
  const selMap = new Map(selectedCourses.map((c) => [c.sf_ref_no, c]))
  let updated = 0

  for (const result of allResults) {
    const sel = selMap.get(result.sf_ref_no)
    const provider = sel?.provider ?? 'unknown'
    const oldCount = sel?.old_count ?? 0

    if (result.error !== null) {
      console.warn(`[runcount] FAIL  [source=failed_keep_previous] provider="${provider}" ref=${result.sf_ref_no} old=${oldCount} keep=${oldCount} -> ${result.error}`)
      continue
    }

    const { error: updateErr } = await supabase
      .from('sf_courses')
      .update({ upcoming_run_count: result.upcoming_run_count })
      .eq('sf_ref_no', result.sf_ref_no)

    if (!updateErr) {
      updated++
      const delta = result.upcoming_run_count - oldCount
      console.log(`[runcount] OK    [source=${result.source}] provider="${provider}" ref=${result.sf_ref_no} old=${oldCount} new=${result.upcoming_run_count} (${delta >= 0 ? '+' : ''}${delta})`)
    } else {
      console.error(`[runcount] DBERR provider="${provider}" ref=${result.sf_ref_no}: ${updateErr.message}`)
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
