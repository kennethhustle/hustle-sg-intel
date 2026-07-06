import { createServiceClient } from '@/lib/supabase/server'
import { scrapeSkillsFuture } from '@/lib/services/courses/skillsfuture'
import { scrapeCompanyCourses } from '@/lib/services/courses/company_courses'
import { reportSourceSuccess, reportSourceFailure } from '@/lib/services/data-sources'

interface CourseIngestionResult {
  competitor_id: string
  competitor_name: string
  source: string
  courses_found: number
  courses_inserted: number
  error: string | null
}

interface OverallCourseResult {
  total_competitors: number
  total_courses_inserted: number
  results: CourseIngestionResult[]
}

function normalizeCourseTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

export async function ingestAllCourses(competitorId?: string): Promise<OverallCourseResult> {
  const supabase = await createServiceClient()

  let query = supabase
    .from('competitors')
    .select('id, name, website')
    .eq('active', true)
    .is('archived_at', null)
    .eq('track_courses', true)

  if (competitorId) query = query.eq('id', competitorId)

  const { data: competitors, error } = await query

  if (error || !competitors) {
    throw new Error(`Failed to fetch competitors: ${error?.message}`)
  }

  // Mark stale courses as inactive
  let staleQuery = supabase
    .from('course_catalog')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('scraped_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  if (competitorId) staleQuery = staleQuery.eq('competitor_id', competitorId)

  await staleQuery

  const allResults: CourseIngestionResult[] = []
  let totalInserted = 0

  for (const competitor of competitors) {
    const seenTitles = new Set<string>()

    // Source 1: SkillsFuture API
    const sfResult = await scrapeSkillsFuture(competitor.name)
    const sfInserted = await ingestCourseBatch(
      supabase,
      competitor.id,
      'skillsfuture',
      sfResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'skillsfuture',
      courses_found: sfResult.data?.length ?? 0,
      courses_inserted: sfInserted,
      error: sfResult.error,
    })
    totalInserted += sfInserted
    await delay(1500)

    // Source 2: Company website
    const companyResult = await scrapeCompanyCourses(competitor.website, competitor.name)
    const companyInserted = await ingestCourseBatch(
      supabase,
      competitor.id,
      'company_website',
      companyResult.data ?? [],
      seenTitles
    )
    allResults.push({
      competitor_id: competitor.id,
      competitor_name: competitor.name,
      source: 'company_website',
      courses_found: companyResult.data?.length ?? 0,
      courses_inserted: companyInserted,
      error: companyResult.error,
    })
    totalInserted += companyInserted
    await delay(2000)
  }

  // Report source health for the company website scraper specifically
  // (the 'skillsfuture' source in this file is reported separately under
  // myskillsfuture_api by ingestion/sf_courses.ts).
  try {
    const companyResults = allResults.filter((r) => r.source === 'company_website')
    const errored = companyResults.filter((r) => r.error !== null)
    const fetched = companyResults.reduce((sum, r) => sum + r.courses_found, 0)
    const updated = companyResults.reduce((sum, r) => sum + r.courses_inserted, 0)

    if (companyResults.length > 0 && errored.length === companyResults.length) {
      const message = errored.map((r) => `${r.competitor_name}: ${r.error}`).join(' | ')
      await reportSourceFailure('company_courses_scraper', message, false)
    } else if (errored.length > 0) {
      const message = errored.map((r) => `${r.competitor_name}: ${r.error}`).join(' | ')
      await reportSourceFailure('company_courses_scraper', message, true)
    } else {
      await reportSourceSuccess('company_courses_scraper', { fetched, updated })
    }
  } catch (err) {
    console.error('Failed to report company_courses_scraper source status:', err)
  }

  return {
    total_competitors: competitors.length,
    total_courses_inserted: totalInserted,
    results: allResults,
  }
}

async function ingestCourseBatch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  competitorId: string,
  source: string,
  courses: Array<{
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
  }>,
  seenTitles: Set<string>
): Promise<number> {
  if (courses.length === 0) return 0

  let inserted = 0
  for (const course of courses) {
    const normalizedTitle = normalizeCourseTitle(course.title)
    if (seenTitles.has(normalizedTitle)) continue
    seenTitles.add(normalizedTitle)

    const { error } = await supabase.from('course_catalog').insert({
      competitor_id: competitorId,
      title: course.title,
      category: course.category,
      sub_category: course.sub_category,
      price: course.price,
      currency: course.currency ?? 'SGD',
      duration_hours: course.duration_hours,
      is_skillsfuture_claimable: course.is_skillsfuture_claimable,
      skillsfuture_credit: course.skillsfuture_credit,
      source: course.source ?? source,
      source_url: course.source_url,
      is_active: true,
      raw_data: course.raw_data,
    })

    if (!error) inserted++
  }

  return inserted
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
