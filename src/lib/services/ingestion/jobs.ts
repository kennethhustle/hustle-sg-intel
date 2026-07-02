import { createServiceClient } from '@/lib/supabase/server'
import { scrapeMyCareersFuture } from '@/lib/services/jobs/mycareersfuture'
import { scrapeJobStreet } from '@/lib/services/jobs/jobstreet'
import { scrapeIndeed } from '@/lib/services/jobs/indeed'
import { scrapeCareerPage } from '@/lib/services/jobs/career_pages'
import { companyMatches, getEmployerName } from '@/lib/services/jobs/employer'

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
  total_deduplicated: number
  results: JobIngestionResult[]
}

interface RawJob {
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

// Provenance entry recorded inside raw_data.sources[] when the same logical job
// is discovered from more than one hiring source.
interface JobSourceEntry {
  source: string
  source_url: string | null
  posted_at: string | null
}

interface MergedJob {
  job: RawJob
  sources: JobSourceEntry[]
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
  let totalDeduplicated = 0

  for (const competitor of competitors) {
    // Per-competitor purge: deactivate ONLY this competitor's previous JobStreet
    // and MyCareersFuture rows before re-scraping, so the refresh rebuilds those
    // two sources from freshly validated data. Scoped per competitor (never
    // global) so a single scraper failure can't wipe the whole dataset. Career
    // Page and Indeed rows are left untouched.
    await supabase
      .from('job_postings')
      .update({ is_active: false })
      .eq('competitor_id', competitor.id)
      .eq('is_active', true)
      .in('source', ['jobstreet', 'mycareersfuture'])

    // Collect every source's results first. The order of the source list built
    // below (mycareersfuture → career_page → jobstreet → indeed) is also the
    // cross-source dedup priority: the first source to report a title owns it.
    const mcfResult = await scrapeMyCareersFuture(competitor.name)
    await delay(2000)
    const careerResult = await scrapeCareerPage(competitor.website, competitor.name)
    await delay(2000)
    const jsResult = await scrapeJobStreet(competitor.name)
    await delay(2000)
    const indeedResult = await scrapeIndeed(competitor.name)
    await delay(3000)

    const sources: Array<{ name: string; jobs: RawJob[]; error: string | null }> = [
      { name: 'mycareersfuture', jobs: mcfResult.data ?? [], error: mcfResult.error },
      { name: 'career_page', jobs: careerResult.data ?? [], error: careerResult.error },
      { name: 'jobstreet', jobs: jsResult.data ?? [], error: jsResult.error },
      { name: 'indeed', jobs: indeedResult.data ?? [], error: indeedResult.error },
    ]

    // Gated per-competitor career_page purge: only when THIS competitor's career
    // scrape succeeded AND returned at least one job do we deactivate its prior
    // active career_page rows, so the fresh validated set replaces them and stale
    // rows / duplicates drop out. If the scrape failed or returned nothing, the
    // existing active rows are kept unchanged (fail closed — never wipe valid
    // data on a transient failure). Scoped per competitor and to career_page
    // only; JobStreet/MyCareersFuture/Indeed are untouched here.
    if (careerResult.success && (careerResult.data?.length ?? 0) > 0) {
      await supabase
        .from('job_postings')
        .update({ is_active: false })
        .eq('competitor_id', competitor.id)
        .eq('is_active', true)
        .eq('source', 'career_page')
    }

    // Deduplicate across ALL sources by normalized title. The first source to
    // report a logical job owns the stored row; every other source that reports
    // the same job is folded into raw_data.sources[] instead of a new row.
    const merged = new Map<string, MergedJob>()
    const insertedBySource: Record<string, number> = {}
    let competitorDedup = 0

    for (const { name, jobs } of sources) {
      for (const job of jobs) {
        // Final employer-validation gate for the keyword sources. Even though the
        // scrapers already validate, re-check here so nothing unverified is ever
        // inserted. Fail closed: missing/mismatched employer ⇒ skip. Career Page
        // and Indeed jobs pass through unchanged.
        if (name === 'jobstreet' || name === 'mycareersfuture') {
          const employer = getEmployerName(name, job.raw_data)
          if (!companyMatches(competitor.name, employer)) continue
        }
        const key = normalizeJobTitle(job.title)
        if (!key) continue
        const entry: JobSourceEntry = {
          source: job.source ?? name,
          source_url: job.source_url,
          posted_at: job.posted_at,
        }
        const existing = merged.get(key)
        if (existing) {
          if (!existing.sources.some((s) => s.source === entry.source)) {
            existing.sources.push(entry)
          }
          competitorDedup++
        } else {
          merged.set(key, { job: { ...job, source: job.source ?? name }, sources: [entry] })
          insertedBySource[name] = (insertedBySource[name] ?? 0) + 1
        }
      }
    }

    // Insert one row per logical job, carrying all discovered sources.
    for (const { job, sources: provenance } of merged.values()) {
      const { error: insertError } = await supabase.from('job_postings').insert({
        competitor_id: competitor.id,
        title: job.title,
        department: job.department,
        location: job.location,
        job_type: job.job_type,
        source: job.source,
        source_url: job.source_url,
        posted_at: job.posted_at,
        is_active: true,
        salary_min: job.salary_min,
        salary_max: job.salary_max,
        currency: job.currency ?? 'SGD',
        raw_data: { ...job.raw_data, sources: provenance },
      })
      if (!insertError) totalInserted++
    }

    totalDeduplicated += competitorDedup

    for (const { name, jobs, error: sourceError } of sources) {
      allResults.push({
        competitor_id: competitor.id,
        competitor_name: competitor.name,
        source: name,
        jobs_found: jobs.length,
        jobs_inserted: insertedBySource[name] ?? 0,
        error: sourceError,
      })
    }
  }

  return {
    total_competitors: competitors.length,
    total_jobs_inserted: totalInserted,
    total_deduplicated: totalDeduplicated,
    results: allResults,
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
