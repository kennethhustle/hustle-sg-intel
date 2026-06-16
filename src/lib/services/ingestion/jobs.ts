import { createServiceClient } from '@/lib/supabase/server'
import { scrapeMyCareersFuture } from '@/lib/services/jobs/mycareersfuture'
import { scrapeJobStreet } from '@/lib/services/jobs/jobstreet'
import { scrapeIndeed } from '@/lib/services/jobs/indeed'
import { scrapeCareerPage } from '@/lib/services/jobs/career_pages'

interface JobIngestionResult {
  competitor_id: string
  competitor_name: string
  source: string
  jobs_found: number
  jobs_inserted: number
  error: string | null
}

interface OverallJobResult {
  total_competitors: number
  total_jobs_inserted: number
  results: JobIngestionResult[]
}

function normalizeJobTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function ingestAllJobs(): Promise<OverallJobResult> {
  const supabase = await createServiceClient()

  const { data: competitors, error } = await supabase
    .from('competitors')
    .select('id, name, website')
    .eq('active', true)

  if (error || !competitors) {
    throw new Error(`Failed to fetch competitors: ${error?.message}`)
  }

  // Mark all current jobs as inactive before re-scraping
  await supabase
    .from('job_postings')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('scraped_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

  const allResults: JobIngestionResult[] = []
  let totalInserted = 0

  for (const competitor of competitors) {
    // Track seen job titles to deduplicate within a competitor
    const seenTitles = new Set<string>()

    // Source 1: MyCareersFuture
    const mcfResult = await scrapeMyCareersFuture(competitor.name)
    const mcfIngested = await ingestJobBatch(
      supabase,
      competitor.id,
      'mycareersfuture',
      mcfResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'mycareersfuture',
      jobs_found: mcfResult.data?.length ?? 0,
      jobs_inserted: mcfIngested,
      error: mcfResult.error,
    })
    totalInserted += mcfIngested
    await delay(2000)

    // Source 2: Career Page
    const careerResult = await scrapeCareerPage(competitor.website, competitor.name)
    const careerIngested = await ingestJobBatch(
      supabase,
      competitor.id,
      'career_page',
      careerResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'career_page',
      jobs_found: careerResult.data?.length ?? 0,
      jobs_inserted: careerIngested,
      error: careerResult.error,
    })
    totalInserted += careerIngested
    await delay(2000)

    // Source 3: JobStreet
    const jsResult = await scrapeJobStreet(competitor.name)
    const jsIngested = await ingestJobBatch(
      supabase,
      competitor.id,
      'jobstreet',
      jsResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'jobstreet',
      jobs_found: jsResult.data?.length ?? 0,
      jobs_inserted: jsIngested,
      error: jsResult.error,
    })
    totalInserted += jsIngested
    await delay(2000)

    // Source 4: Indeed
    const indeedResult = await scrapeIndeed(competitor.name)
    const indeedIngested = await ingestJobBatch(
      supabase,
      competitor.id,
      'indeed',
      indeedResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'indeed',
      jobs_found: indeedResult.data?.length ?? 0,
      jobs_inserted: indeedIngested,
      error: indeedResult.error,
    })
    totalInserted += indeedIngested
    await delay(3000)
  }

  return {
    total_competitors: competitors.length,
    total_jobs_inserted: totalInserted,
    results: allResults,
  }
}

async function ingestJobBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  competitorId: string,
  source: string,
  jobs: Array<{
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
  }>,
  seenTitles: Set<string>
): Promise<number> {
  if (jobs.length === 0) return 0

  let inserted = 0
  for (const job of jobs) {
    const normalizedTitle = normalizeJobTitle(job.title)
    if (seenTitles.has(normalizedTitle)) continue
    seenTitles.add(normalizedTitle)

    const { error } = await supabase.from('job_postings').insert({
      competitor_id: competitorId,
      title: job.title,
      department: job.department,
      location: job.location,
      job_type: job.job_type,
      source: job.source ?? source,
      source_url: job.source_url,
      posted_at: job.posted_at,
      is_active: true,
      salary_min: job.salary_min,
      salary_max: job.salary_max,
      currency: job.currency ?? 'SGD',
      raw_data: job.raw_data,
    })

    if (!error) inserted++
  }

  return inserted
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
