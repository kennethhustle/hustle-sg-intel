import { createServiceClient } from '@/lib/supabase/server'
import { scrapeSkillsFutureByProvider, type SFCourse } from '@/lib/services/courses/skillsfuture_v2'

// Exact TP_ALIAS_Suggest names from the SkillsFuture Solr index
const SF_PROVIDERS = [
  { competitorName: 'BELLS Institute',    tpAliasName: 'BELLS INSTITUTE OF HIGHER LEARNING PTE. LTD.' },
  { competitorName: 'Vertical Institute', tpAliasName: 'VERTICAL INSTITUTE PTE. LTD.' },
  { competitorName: 'OOm Pte Ltd',        tpAliasName: 'OOM PTE. LTD.' },
  { competitorName: 'Skills Dev Academy', tpAliasName: 'SKILLS DEVELOPMENT ACADEMY PTE. LTD.' },
  { competitorName: 'InfoTech Academy',   tpAliasName: 'INFO-TECH SYSTEMS LTD.' },
  { competitorName: 'ASK Training',       tpAliasName: '@ASK TRAINING PTE. LTD.' },
  { competitorName: 'Heicoders Academy',  tpAliasName: 'HEICODERS ACADEMY PRIVATE LIMITED' },
  { competitorName: 'Happy Together',     tpAliasName: 'HAPPY TOGETHER PTE. LTD.' },
  { competitorName: 'Equinet Academy',    tpAliasName: 'EQUINET ACADEMY PRIVATE LIMITED' },
  { competitorName: 'Hustle SG',          tpAliasName: 'HUSTLE INSTITUTE PTE. LTD.' },
]

export interface SFIngestionResult {
  competitor_name: string
  tp_alias_name: string
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
    const scraped_at = new Date().toISOString()
    let courses: SFCourse[] = []
    let scrapeError: string | null = null
    let sourceUrl = ''
    let rowsUpserted = 0

    try {
      const result = await scrapeSkillsFutureByProvider(provider.tpAliasName, 300)
      courses = result.courses
      sourceUrl = result.sourceUrl
    } catch (err) {
      scrapeError = err instanceof Error ? err.message : String(err)
    }

    if (courses.length > 0 && competitorId) {
      const rows = courses.map((c: SFCourse) => ({
        competitor_id: competitorId,
        sf_ref_no: c.sfRefNo,
        title: c.title,
        provider_name: c.providerName,
        category_text: c.category,
        course_fee: c.totalCost,
        popularity_score: c.popularityScore,
        respondent_count: c.respondents,
        quality_rating: c.rating,
        has_active_runs: c.hasActiveRuns,
        course_mode: c.modeOfTraining,
        source_api_url: sourceUrl,
        scraped_at,
      }))

      const { error: upsertErr, data: upsertData } = await supabase
        .from('sf_courses')
        .upsert(rows, { onConflict: 'sf_ref_no', ignoreDuplicates: false })
        .select('sf_ref_no')

      if (upsertErr) {
        scrapeError = (scrapeError ? scrapeError + ' | ' : '') + `Upsert error: ${upsertErr.message}`
      } else {
        rowsUpserted = upsertData?.length ?? rows.length
      }
    }

    results.push({
      competitor_name: provider.competitorName,
      tp_alias_name: provider.tpAliasName,
      rows_found: courses.length,
      rows_upserted: rowsUpserted,
      error: scrapeError,
      source_api_url: sourceUrl,
      scraped_at,
    })

    totalFound += courses.length
    totalUpserted += rowsUpserted

    await delay(2000) // be polite between providers
  }

  return {
    total_competitors: SF_PROVIDERS.length,
    total_found: totalFound,
    total_upserted: totalUpserted,
    results,
    started_at,
  }
}
