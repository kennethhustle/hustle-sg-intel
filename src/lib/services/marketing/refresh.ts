/**
 * Marketing Intelligence Refresh Service
 *
 * Runs as part of the daily 4 AM SGT cron (or on-demand via the Refresh Now button).
 *
 * Data pipeline:
 *  1. Refresh Meta Ads count      — Meta Ad Library API (public, no auth)
 *  2. Refresh Google Reviews/Rating — Google Places API (requires GOOGLE_PLACES_API_KEY)
 *  3. Sync SF data               — from live sf_courses table in Supabase
 *  4. Recalculate threat scores  — (done at page render time, not stored)
 *  5. Write refresh log          — data_refresh_logs table
 *
 * Google Ads (Transparency) has no public API and blocks automation.
 * Those values are NOT updated automatically — update them manually in Supabase
 * or via the `google_ads` column in competitor_marketing_data.
 */

import { createServiceClient } from '@/lib/supabase/server'

// ─── Small retry helper ────────────────────────────────────────────────────────
// Retries a failed fetch-like async call once after a short delay. Used for the
// Meta Ad Library and Google Places calls, which occasionally fail transiently.
async function fetchWithRetry<T>(
  fn: () => Promise<T | null>,
  retries = 1,
  delayMs = 2000
): Promise<T | null> {
  let result = await fn()
  let attempt = 0
  while (result === null && attempt < retries) {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    result = await fn()
    attempt++
  }
  return result
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface CompetitorRecord {
  id:            string
  name:          string
  meta_ads_url:  string | null
  review_url:    string | null
  google_ads:    number | null
}

interface PartialUpdate {
  competitor_id: string
  meta_ads?:     number | null
  google_reviews?: number | null
  google_rating?:  number | null
  sf_runs?:      number | null
  sf_respondents?: number | null
}

export interface RefreshResult {
  records_updated: number
  meta_ads_updated: number
  reviews_updated: number
  sf_updated: number
  errors: Array<{ competitor: string; field: string; error: string }>
  skipped_google_ads: boolean
}

// ─── Meta Ads: Meta Ad Library public search API ─────────────────────────────
async function fetchMetaAdsCount(searchTerm: string): Promise<number | null> {
  try {
    const params = new URLSearchParams({
      ad_type:            'ALL',
      ad_reached_countries: 'SG',
      active_status:      'ACTIVE',
      search_terms:       searchTerm,
      fields:             'id',
      limit:              '1',
      summary:            'true',
    })

    const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN
    if (token) params.set('access_token', token)

    const url = `https://graph.facebook.com/v19.0/ads_archive?${params}`
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal:  AbortSignal.timeout(15_000),
    })

    if (!res.ok) return null
    const json = await res.json() as {
      data?: unknown[]
      paging?: unknown
      summary?: { total_count?: number }
      error?:   { message: string }
    }
    if (json.error) return null

    return json.summary?.total_count ?? null
  } catch {
    return null
  }
}

// ─── Google Places: fetch review count + rating via Places API ───────────────
async function fetchGooglePlaces(
  placeSearchQuery: string
): Promise<{ reviews: number; rating: number } | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) return null

  try {
    const findRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?` +
        new URLSearchParams({
          input:      placeSearchQuery,
          inputtype:  'textquery',
          fields:     'place_id',
          key,
        }),
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!findRes.ok) return null
    const findJson = await findRes.json() as {
      candidates?: Array<{ place_id: string }>
    }
    const placeId = findJson.candidates?.[0]?.place_id
    if (!placeId) return null

    const detailRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?` +
        new URLSearchParams({
          place_id: placeId,
          fields:   'user_ratings_total,rating',
          key,
        }),
      { signal: AbortSignal.timeout(10_000) }
    )
    if (!detailRes.ok) return null
    const detailJson = await detailRes.json() as {
      result?: { user_ratings_total?: number; rating?: number }
    }
    const r = detailJson.result
    if (!r?.user_ratings_total || !r.rating) return null
    return { reviews: r.user_ratings_total, rating: r.rating }
  } catch {
    return null
  }
}

// ─── Main refresh function ────────────────────────────────────────────────────

export async function runMarketingRefresh(
  triggeredBy: 'cron' | 'manual' = 'cron',
  competitorId?: string
): Promise<RefreshResult> {
  const supabase  = await createServiceClient()
  const startedAt = new Date().toISOString()
  const result: RefreshResult = {
    records_updated:  0,
    meta_ads_updated: 0,
    reviews_updated:  0,
    sf_updated:       0,
    errors:           [],
    skipped_google_ads: true,
  }

  const { data: logRow, error: logErr } = await supabase
    .from('data_refresh_logs')
    .insert({
      module:       'marketing',
      source:       'marketing',
      started_at:   startedAt,
      status:       'running',
      triggered_by: triggeredBy,
      competitor_id: competitorId ?? null,
    })
    .select('id')
    .single()

  const logId: string | null = logErr ? null : logRow?.id ?? null

  async function finaliseLog(status: 'success' | 'failed' | 'partial', errorMsg?: string) {
    const completedAt = new Date().toISOString()
    const durationSec =
      (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000

    if (!logId) return
    await supabase
      .from('data_refresh_logs')
      .update({
        completed_at:    completedAt,
        status,
        duration_seconds: durationSec,
        records_updated: result.records_updated,
        error_message:   errorMsg ?? null,
        metadata: {
          meta_ads_updated: result.meta_ads_updated,
          reviews_updated:  result.reviews_updated,
          sf_updated:       result.sf_updated,
          errors:           result.errors,
        },
      })
      .eq('id', logId)
  }

  try {
    let compQuery = supabase
      .from('competitors')
      .select('id, name')
      .eq('active', true)
      .is('archived_at', null)
      .eq('track_marketing', true)

    if (competitorId) compQuery = compQuery.eq('id', competitorId)

    const { data: competitors, error: compErr } = await compQuery

    if (compErr || !competitors?.length) {
      await finaliseLog('failed', compErr?.message ?? 'No competitors found')
      return result
    }

    const { data: marketingRows } = await supabase
      .from('competitor_marketing_data')
      .select('competitor_id, meta_ads_url, review_url, google_ads')

    const marketingMap = new Map<string, Pick<CompetitorRecord, 'meta_ads_url' | 'review_url' | 'google_ads'>>()
    for (const r of (marketingRows ?? [])) {
      marketingMap.set(r.competitor_id, {
        meta_ads_url: r.meta_ads_url,
        review_url:   r.review_url,
        google_ads:   r.google_ads,
      })
    }

    const { data: sfData } = await supabase
      .from('sf_courses')
      .select('competitor_id, upcoming_run_count, respondent_count')

    const sfMap = new Map<string, { runs: number; respondents: number }>()
    for (const row of (sfData ?? [])) {
      const ex = sfMap.get(row.competitor_id) ?? { runs: 0, respondents: 0 }
      sfMap.set(row.competitor_id, {
        runs:        ex.runs + (row.upcoming_run_count ?? 0),
        respondents: ex.respondents + (row.respondent_count ?? 0),
      })
    }

    const updates: PartialUpdate[] = []

    for (const comp of competitors as Array<{ id: string; name: string }>) {
      const mkt = marketingMap.get(comp.id)
      const update: PartialUpdate = { competitor_id: comp.id }

      let metaSearchTerm = comp.name
      if (mkt?.meta_ads_url) {
        try {
          const u = new URL(mkt.meta_ads_url)
          metaSearchTerm = u.searchParams.get('q') ?? comp.name
        } catch { /* ignore */ }
      }

      const metaCount = await fetchWithRetry(() => fetchMetaAdsCount(metaSearchTerm))
      if (metaCount !== null) {
        update.meta_ads = metaCount
        result.meta_ads_updated++
      } else {
        result.errors.push({ competitor: comp.name, field: 'meta_ads', error: 'API returned null' })
      }

      const googleCount = await fetchWithRetry(() => fetchGooglePlaces(`${comp.name} Singapore training`))
      if (googleCount !== null) {
        update.google_reviews = googleCount.reviews
        update.google_rating  = googleCount.rating
        result.reviews_updated++
      } else {
        result.errors.push({ competitor: comp.name, field: 'google_reviews', error: 'Places API unavailable or key not set' })
      }

      const sf = sfMap.get(comp.id)
      if (sf) {
        update.sf_runs = sf.runs
        update.sf_respondents = sf.respondents
        result.sf_updated++
      }

      updates.push(update)
    }

    const snapshotDate = new Date().toISOString().split('T')[0]

    for (const upd of updates) {
      const payload: Record<string, unknown> = {
        competitor_id: upd.competitor_id,
        updated_at:    new Date().toISOString(),
      }
      if (upd.meta_ads       !== undefined) payload.meta_ads       = upd.meta_ads
      if (upd.google_reviews !== undefined) payload.google_reviews = upd.google_reviews
      if (upd.google_rating  !== undefined) payload.google_rating  = upd.google_rating
      if (upd.sf_runs        !== undefined) payload.sf_runs        = upd.sf_runs
      if (upd.sf_respondents !== undefined) payload.sf_respondents = upd.sf_respondents

      const { error: upsertErr } = await supabase
        .from('competitor_marketing_data')
        .upsert(payload, { onConflict: 'competitor_id' })

      if (!upsertErr) {
        result.records_updated++
      } else {
        result.errors.push({
          competitor: upd.competitor_id,
          field:      'upsert',
          error:      upsertErr.message,
        })
      }

      // Daily history snapshot for trend/alert detection (marketing_snapshots).
      const snapshotPayload: Record<string, unknown> = {
        competitor_id: upd.competitor_id,
        snapshot_date: snapshotDate,
      }
      if (upd.meta_ads       !== undefined) snapshotPayload.meta_ads       = upd.meta_ads
      if (upd.google_reviews !== undefined) snapshotPayload.google_reviews = upd.google_reviews
      if (upd.google_rating  !== undefined) snapshotPayload.google_rating  = upd.google_rating
      if (upd.sf_runs        !== undefined) snapshotPayload.sf_runs        = upd.sf_runs

      const { error: snapshotErr } = await supabase
        .from('marketing_snapshots')
        .upsert(snapshotPayload, { onConflict: 'competitor_id,snapshot_date' })

      if (snapshotErr) {
        result.errors.push({
          competitor: upd.competitor_id,
          field:      'marketing_snapshot',
          error:      snapshotErr.message,
        })
      }
    }

    const finalStatus: 'success' | 'partial' =
      result.errors.length === 0 ? 'success' : 'partial'
    await finaliseLog(finalStatus)

    return result

  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    await finaliseLog('failed', errMsg)
    return result
  }
}
