import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { startRefreshLog } from '@/lib/services/refresh-log'
import { ingestAllSFCourses } from '@/lib/services/ingestion/sf_courses'
import { scrapeAndUpdateRunCounts } from '@/lib/services/ingestion/sf_run_counts'
import { runMarketingRefresh } from '@/lib/services/marketing/refresh'
import { ingestAllJobs } from '@/lib/services/ingestion/jobs'
import { ingestAllSocial } from '@/lib/services/ingestion/social'

export const maxDuration = 300

type ModuleStatus = 'success' | 'partial' | 'failed' | 'skipped'

interface ModuleResult {
  module: string
  status: ModuleStatus
  message?: string
}

// Best-effort in-memory rate limit. Not reliable across serverless instances,
// so the authoritative check is the data_refresh_logs lookback below — this
// map just avoids duplicate work within a single warm instance.
const recentRefreshes = new Map<string, number>()
const RATE_LIMIT_MS = 5 * 60 * 1000

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: competitorId } = await params

  // ─── Auth: session user must be admin or analyst ─────────────────────────────
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userData || !['admin', 'analyst'].includes(userData.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  const service = await createServiceClient()

  // ─── Verify competitor exists, active, not archived ──────────────────────────
  const { data: competitor, error: compErr } = await service
    .from('competitors')
    .select('id, name, active, archived_at, track_courses, track_hiring, track_marketing, track_social, track_seo')
    .eq('id', competitorId)
    .single()

  if (compErr || !competitor) {
    return NextResponse.json({ error: 'Competitor not found' }, { status: 404 })
  }
  if (!competitor.active || competitor.archived_at) {
    return NextResponse.json({ error: 'Competitor is inactive or archived' }, { status: 400 })
  }

  // ─── Rate limit: refuse if refreshed via this route in the last 5 minutes ────
  const inMemoryLast = recentRefreshes.get(competitorId)
  if (inMemoryLast && Date.now() - inMemoryLast < RATE_LIMIT_MS) {
    return NextResponse.json(
      { error: 'This competitor was refreshed recently. Please wait before retrying.' },
      { status: 429 }
    )
  }

  const { data: recentLogs } = await service
    .from('data_refresh_logs')
    .select('started_at')
    .eq('competitor_id', competitorId)
    .eq('triggered_by', 'manual')
    .gte('started_at', new Date(Date.now() - RATE_LIMIT_MS).toISOString())
    .limit(1)

  if (recentLogs && recentLogs.length > 0) {
    return NextResponse.json(
      { error: 'This competitor was refreshed recently. Please wait before retrying.' },
      { status: 429 }
    )
  }

  recentRefreshes.set(competitorId, Date.now())

  const results: ModuleResult[] = []

  // ─── sf_courses ────────────────────────────────────────────────────────────
  if (competitor.track_courses) {
    const log = await startRefreshLog('sf_courses', 'refresh-competitor', 'manual', competitorId)
    try {
      const result = await ingestAllSFCourses(competitorId)
      const hasErrors = result.results.some((r) => r.error !== null)
      await log.finalize(
        hasErrors ? 'partial' : 'success',
        { fetched: result.total_found, inserted: result.total_upserted },
        hasErrors ? result.results.filter((r) => r.error).map((r) => r.error).join(' | ') : null
      )
      results.push({
        module: 'sf_courses',
        status: hasErrors ? 'partial' : 'success',
        message: `${result.total_upserted} course rows upserted`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await log.finalize('failed', undefined, errMsg)
      results.push({ module: 'sf_courses', status: 'failed', message: errMsg })
    }
  } else {
    results.push({ module: 'sf_courses', status: 'skipped', message: 'track_courses is disabled' })
  }

  // ─── run counts ────────────────────────────────────────────────────────────
  if (competitor.track_courses) {
    const log = await startRefreshLog('runcounts', 'refresh-competitor', 'manual', competitorId)
    try {
      const result = await scrapeAndUpdateRunCounts(competitorId)
      const hasErrors = result.errors > 0
      await log.finalize(
        hasErrors ? 'partial' : 'success',
        { fetched: result.scraped, updated: result.updated, failed: result.errors }
      )
      results.push({
        module: 'runcounts',
        status: hasErrors ? 'partial' : 'success',
        message: `${result.updated}/${result.scraped} run counts updated`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await log.finalize('failed', undefined, errMsg)
      results.push({ module: 'runcounts', status: 'failed', message: errMsg })
    }
  } else {
    results.push({ module: 'runcounts', status: 'skipped', message: 'track_courses is disabled' })
  }

  // ─── marketing ─────────────────────────────────────────────────────────────
  if (competitor.track_marketing) {
    try {
      // runMarketingRefresh manages its own data_refresh_logs entry.
      const result = await runMarketingRefresh('manual', competitorId)
      const hasErrors = result.errors.length > 0
      results.push({
        module: 'marketing',
        status: hasErrors ? 'partial' : 'success',
        message: `${result.records_updated} competitor(s) updated`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      results.push({ module: 'marketing', status: 'failed', message: errMsg })
    }
  } else {
    results.push({ module: 'marketing', status: 'skipped', message: 'track_marketing is disabled' })
  }

  // ─── hiring / jobs ─────────────────────────────────────────────────────────
  if (competitor.track_hiring) {
    const log = await startRefreshLog('hiring', 'refresh-competitor', 'manual', competitorId)
    try {
      const result = await ingestAllJobs(competitorId)
      const hasErrors = result.results.some((r) => r.error !== null)
      const totalFound = result.results.reduce((s, r) => s + r.jobs_found, 0)
      await log.finalize(
        hasErrors ? 'partial' : 'success',
        { fetched: totalFound, inserted: result.total_jobs_inserted },
        hasErrors ? result.results.filter((r) => r.error).map((r) => `${r.source}: ${r.error}`).join(' | ') : null
      )
      results.push({
        module: 'hiring',
        status: hasErrors ? 'partial' : 'success',
        message: `${result.total_jobs_inserted} jobs inserted`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await log.finalize('failed', undefined, errMsg)
      results.push({ module: 'hiring', status: 'failed', message: errMsg })
    }
  } else {
    results.push({ module: 'hiring', status: 'skipped', message: 'track_hiring is disabled' })
  }

  // ─── social ────────────────────────────────────────────────────────────────
  if (competitor.track_social) {
    const log = await startRefreshLog('social', 'refresh-competitor', 'manual', competitorId)
    try {
      const result = await ingestAllSocial(competitorId)
      const hasErrors = result.failed > 0
      await log.finalize(
        hasErrors ? 'partial' : 'success',
        { fetched: result.total, updated: result.successful, failed: result.failed },
        hasErrors ? result.results.filter((r) => r.error).map((r) => `${r.platform}: ${r.error}`).join(' | ') : null
      )
      results.push({
        module: 'social',
        status: hasErrors ? 'partial' : 'success',
        message: `${result.successful}/${result.total} profiles refreshed`,
      })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      await log.finalize('failed', undefined, errMsg)
      results.push({ module: 'social', status: 'failed', message: errMsg })
    }
  } else {
    results.push({ module: 'social', status: 'skipped', message: 'track_social is disabled' })
  }

  return NextResponse.json({ competitor_id: competitorId, results })
}
