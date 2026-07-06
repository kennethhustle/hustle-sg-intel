import { createServiceClient } from '@/lib/supabase/server'
import { scrapeSkillsFutureByProvider, type SFCourse } from '@/lib/services/courses/skillsfuture_v2'
import { classifyCourse } from '@/lib/services/courses/categories'
import { reportSourceSuccess, reportSourceFailure } from '@/lib/services/data-sources'

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
  deactivated: number
}

interface ProviderAlias {
  competitorId: string
  competitorName: string
  tpAliasName: string
}

function delay(ms: number) { return new Promise<void>(resolve => setTimeout(resolve, ms)) }

const STALE_DAYS = 3

/**
 * Load the MySkillsFuture provider aliases from competitor_data_sources,
 * scoped to active, non-archived competitors that opt into course tracking.
 * A competitor may have multiple aliases (e.g. Hustle SG); all are scraped
 * and aggregated under the same competitor_id.
 */
async function loadProviderAliases(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  competitorId?: string
): Promise<ProviderAlias[]> {
  let competitorQuery = supabase
    .from('competitors')
    .select('id, name')
    .eq('active', true)
    .is('archived_at', null)
    .eq('track_courses', true)

  if (competitorId) competitorQuery = competitorQuery.eq('id', competitorId)

  const { data: competitors, error: compErr } = await competitorQuery
  if (compErr) throw new Error(`Failed to fetch competitors: ${compErr.message}`)
  if (!competitors || competitors.length === 0) return []

  const competitorIds = competitors.map((c) => c.id)
  const compMap = new Map(competitors.map((c) => [c.id, c.name as string]))

  const { data: sources, error: srcErr } = await supabase
    .from('competitor_data_sources')
    .select('competitor_id, identifier')
    .eq('source_type', 'myskillsfuture')
    .eq('is_active', true)
    .in('competitor_id', competitorIds)

  if (srcErr) throw new Error(`Failed to fetch competitor_data_sources: ${srcErr.message}`)
  if (!sources) return []

  return sources.map((s) => ({
    competitorId: s.competitor_id as string,
    competitorName: compMap.get(s.competitor_id as string) ?? s.competitor_id as string,
    tpAliasName: s.identifier as string,
  }))
}

export async function ingestAllSFCourses(competitorId?: string): Promise<SFIngestionSummary> {
  const supabase = await createServiceClient()
  const started_at = new Date().toISOString()

  const providers = await loadProviderAliases(supabase, competitorId)

  const results: SFIngestionResult[] = []
  let totalFound = 0, totalUpserted = 0
  const seenAt = new Date().toISOString()

  // Preload existing values for every course we might touch, keyed by
  // sf_ref_no, so the upsert can carry prev_fee/prev_rating/prev_respondent_count
  // forward for change detection (see courses/intelligence.ts).
  const existingByRef = new Map<
    string,
    { upcoming_run_count: number | null; course_fee: number | null; quality_rating: number | null; respondent_count: number | null }
  >()
  {
    const { data: existingRows, error: existingErr } = await supabase
      .from('sf_courses')
      .select('sf_ref_no, upcoming_run_count, course_fee, quality_rating, respondent_count')
    if (!existingErr && existingRows) {
      for (const row of existingRows) {
        existingByRef.set(row.sf_ref_no as string, {
          upcoming_run_count: row.upcoming_run_count as number | null,
          course_fee: row.course_fee as number | null,
          quality_rating: row.quality_rating as number | null,
          respondent_count: row.respondent_count as number | null,
        })
      }
    }
  }

  for (const provider of providers) {
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

    if (courses.length > 0) {
      const rows = courses.map((c: SFCourse) => {
        const existing = existingByRef.get(c.sfRefNo)
        return {
          competitor_id: provider.competitorId,
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
          // NOTE: upcoming_run_count is intentionally excluded from this upsert.
          // The Solr API does not expose run counts (doclist.numFound is absent).
          // Run counts are scraped separately via browser navigation (authenticated
          // MySkillsFuture session required) and must never be overwritten here.
          source_api_url: sourceUrl,
          scraped_at,
          // Change detection: mark as seen now + active. first_seen_at keeps its
          // table default (NOW()) on first insert and is left untouched on update
          // because it's not part of this payload.
          last_seen_at: seenAt,
          is_active: true,
          category_cluster: classifyCourse(c.title, c.category),
          // Preserve the OLD values (pre-upsert) so intelligence.ts can diff
          // fee/rating/respondent changes on the next pipeline run.
          prev_fee: existing?.course_fee ?? null,
          prev_rating: existing?.quality_rating ?? null,
          prev_respondent_count: existing?.respondent_count ?? null,
        }
      })

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

  // Change detection: mark courses not seen in this run as inactive once
  // they're stale (last_seen_at older than 3 days). When running for a
  // single competitor, only that competitor's courses are affected.
  let deactivated = 0
  const staleCutoff = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000).toISOString()

  let deactivateQuery = supabase
    .from('sf_courses')
    .update({ is_active: false })
    .eq('is_active', true)
    .lt('last_seen_at', staleCutoff)

  if (competitorId) {
    deactivateQuery = deactivateQuery.eq('competitor_id', competitorId)
  }

  const { data: deactivatedRows, error: deactivateErr } = await deactivateQuery.select('sf_ref_no')
  if (!deactivateErr) {
    deactivated = deactivatedRows?.length ?? 0
  }

  // Report source health: failure only if ALL providers errored, partial if
  // some did, success otherwise. Never let this throw or block the return.
  try {
    const errored = results.filter((r) => r.error !== null)
    if (providers.length > 0 && errored.length === providers.length) {
      const message = errored.map((r) => `${r.competitor_name}: ${r.error}`).join(' | ')
      await reportSourceFailure('myskillsfuture_api', message, false)
    } else if (errored.length > 0) {
      const message = errored.map((r) => `${r.competitor_name}: ${r.error}`).join(' | ')
      await reportSourceFailure('myskillsfuture_api', message, true)
    } else {
      await reportSourceSuccess('myskillsfuture_api', { fetched: totalFound, updated: totalUpserted })
    }
  } catch (err) {
    console.error('Failed to report myskillsfuture_api source status:', err)
  }

  return {
    total_competitors: providers.length,
    total_found: totalFound,
    total_upserted: totalUpserted,
    results,
    started_at,
    deactivated,
  }
}
