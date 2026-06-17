import { createServiceClient } from '@/lib/supabase/server'
import { scrapeSkillsFutureV2, type SFCourse } from '@/lib/services/courses/skillsfuture_v2'

const SF_PROVIDERS = [
  { competitorName: 'BELLS Institute',    searchTerms: ['BELLS Institute'] },
  { competitorName: 'Vertical Institute', searchTerms: ['Vertical Institute'] },
  { competitorName: 'OOm Pte Ltd',        searchTerms: ['OOm'] },
  { competitorName: 'Skills Dev Academy', searchTerms: ['Skills Development Academy', 'SDA Academy'] },
  { competitorName: 'InfoTech Academy',   searchTerms: ['Info-Tech Academy', 'InfoTech Academy'] },
  { competitorName: 'ASK Training',       searchTerms: ['ASK Training'] },
  { competitorName: 'Heicoders Academy',  searchTerms: ['Heicoders'] },
  { competitorName: 'Happy Together',     searchTerms: ['Happy Together'] },
  { competitorName: 'Equinet Academy',    searchTerms: ['Equinet'] },
  { competitorName: 'Hustle SG',          searchTerms: ['Hustle Singapore', 'Hustle SG'] },
]

export interface SFIngestionResult {
  competitor_name: string
  search_term: string
  rows_found: number
  rows_upserted: number
  error: string | null
  source_api_url: string
  scraped_at: string
}

export interface SFIngestionSummary {
  total_competitors: number
  total_found: number
  total_upserted: number
  results: SFIngestionResult[]
  started_at: string
}

function delay(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)) }

export async function ingestAllSFCourses(): Promise<SFIngestionSummary> {
  const supabase = await createServiceClient()
  const started_at = new Date().toISOString()

  const { data: competitors, error: compErr } = await supabase
    .from('competitors').select('id, name').eq('active', true)
  if (compErr || !competitors) throw new Error(`Failed to fetch competitors: ${compErr?.message}`)

  const compMap = new Map(competitors.map(c => [c.name, c.id]))
  const results: SFIngestionResult[] = []
  let totalFound = 0, totalUpserted = 0

  for (const provider of SF_PROVIDERS) {
    const competitorId = compMap.get(provider.competitorName)
    let bestResult: SFIngestionResult | null = null

    for (const term of provider.searchTerms) {
      const scraped_at = new Date().toISOString()
      let courses: SFCourse[] = []
      let scrapeError: string | null = null
      let sourceUrl = ''

      try {
        const result = await scrapeSkillsFutureV2(term)
        courses = result.courses
        sourceUrl = result.sourceUrl
      } catch (err) {
        scrapeError = err instanceof Error ? err.message : String(err)
      }

      let rowsUpserted = 0
      if (courses.length > 0 && competitorId) {
        const rows = courses.map(c => ({
          competitor_id: competitorId,
          sf_ref_no: c.sfRefNo,
          title: c.title,
          provider_name: c.providerName,
          category_text: c.category,
          course_fee: c.totalCost,
          popularity_score: c.popularityScore,
          respondent_count: c.respondents,
          quality_rating: c.rating,
          has_active_runs: c.activeRunCount > 0,
          course_mode: c.modeOfTraining,
          source_api_url: sourceUrl,
          scraped_at,
        }))

        const { error: upsertErr, data: upsertData } = await supabase
          .from('sf_courses')
          .upsert(rows, { onConflict: 'sf_ref_no', ignoreDuplicates: false })
          .select('sf_ref_no')

        if (upsertErr) {
          scrapeError = `Upsert error: ${upsertErr.message}`
        } else {
          rowsUpserted = upsertData?.length ?? rows.length
        }
      }

      const termResult: SFIngestionResult = {
        competitor_name: provider.competitorName,
        search_term: term,
        rows_found: courses.length,
        rows_upserted: rowsUpserted,
        error: scrapeError,
        source_api_url: sourceUrl,
        scraped_at,
      }

      if (!bestResult || termResult.rows_found > bestResult.rows_found) {
        bestResult = termResult
      }

      await delay(800)
    }

    if (bestResult) {
      results.push(bestResult)
      totalFound += bestResult.rows_found
      totalUpserted += bestResult.rows_upserted
    }

    await delay(1500)
  }

  return {
    total_competitors: SF_PROVIDERS.length,
    total_found: totalFound,
    total_upserted: totalUpserted,
    results,
    started_at,
  }
}
