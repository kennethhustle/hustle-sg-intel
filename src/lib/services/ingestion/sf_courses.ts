import { createServiceClient } from '@/lib/supabase/server'
import { scrapeSkillsFutureV2, type SFCourse } from '@/lib/services/courses/skillsfuture_v2'

// providerMatch: case-insensitive substring that must appear in the course's provider_name
// to confirm the course genuinely belongs to this competitor (avoids upsert collisions)
const SF_PROVIDERS = [
  { competitorName: 'BELLS Institute',    providerMatch: 'bells',             searchTerms: ['BELLS Institute'] },
  { competitorName: 'Vertical Institute', providerMatch: 'vertical',          searchTerms: ['Vertical Institute'] },
  { competitorName: 'OOm Pte Ltd',        providerMatch: 'oom',               searchTerms: ['OOm'] },
  { competitorName: 'Skills Dev Academy', providerMatch: 'skills development', searchTerms: ['Skills Development Academy', 'SDA Academy'] },
  { competitorName: 'InfoTech Academy',   providerMatch: 'info',              searchTerms: ['Info-Tech Academy', 'InfoTech Academy'] },
  { competitorName: 'ASK Training',       providerMatch: 'ask',               searchTerms: ['ASK Training'] },
  { competitorName: 'Heicoders Academy',  providerMatch: 'heicoders',         searchTerms: ['Heicoders'] },
  { competitorName: 'Happy Together',     providerMatch: 'happy together',    searchTerms: ['Happy Together'] },
  { competitorName: 'Equinet Academy',    providerMatch: 'equinet',           searchTerms: ['Equinet'] },
  { competitorName: 'Hustle SG',          providerMatch: 'hustle',            searchTerms: ['Hustle Singapore', 'Hustle SG'] },
]

export interface SFIngestionResult {
  competitor_name: string
  search_term: string
  rows_found: number
  rows_matched: number
  rows_upserted: number
  error: string | null
  source_api_url: string
  scraped_at: string
}

export interface SFIngestionSummary {
  total_competitors: number
  total_found: number
  total_matched: number
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
  let totalFound = 0, totalMatched = 0, totalUpserted = 0

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

      // Filter to only courses genuinely from this provider
      const matchStr = provider.providerMatch.toLowerCase()
      const matchedCourses = courses.filter(c =>
        c.providerName.toLowerCase().includes(matchStr)
      )

      let rowsUpserted = 0
      if (matchedCourses.length > 0 && competitorId) {
        const rows = matchedCourses.map(c => ({
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
        rows_matched: matchedCourses.length,
        rows_upserted: rowsUpserted,
        error: scrapeError,
        source_api_url: sourceUrl,
        scraped_at,
      }

      if (!bestResult || termResult.rows_matched > bestResult.rows_matched) {
        bestResult = termResult
      }

      await delay(800)
    }

    if (bestResult) {
      results.push(bestResult)
      totalFound += bestResult.rows_found
      totalMatched += bestResult.rows_matched
      totalUpserted += bestResult.rows_upserted
    }

    await delay(1500)
  }

  return {
    total_competitors: SF_PROVIDERS.length,
    total_found: totalFound,
    total_matched: totalMatched,
    total_upserted: totalUpserted,
    results,
    started_at,
  }
}
