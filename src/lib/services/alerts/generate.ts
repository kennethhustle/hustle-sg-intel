/**
 * Rule-based data alert generation.
 *
 * Runs at the end of the nightly refresh sequence (after sf, runcounts,
 * marketing, hiring, social have all completed — see social-refresh cron)
 * and inspects the freshly-refreshed tables for events worth surfacing to
 * the team: new competitor courses, run-count surges, ad spend changes,
 * review growth, hiring spikes, and data-pipeline health problems.
 *
 * Every rule de-dupes against alerts of the same alert_type + competitor_id
 * created in the last 3 days, so re-running (or a slightly-late cron) won't
 * spam duplicate alerts.
 */
import { createServiceClient } from '@/lib/supabase/server'
import { updateSourceStatus } from '@/lib/services/data-sources'

type SupabaseClient = Awaited<ReturnType<typeof createServiceClient>>

export interface GenerateAlertsResult {
  created: number
}

const DEDUP_WINDOW_DAYS = 3
const NEW_COURSE_WINDOW_DAYS = 2
const STALE_HOURS = 48
// Manual/static source staleness thresholds — differentiated per source.
// Google Ads Transparency has no public API and is the highest-priority
// manual source to keep fresh, so it gets a tighter window than the other
// manual sources (social_manual, seo_manual_snapshot), which stay at 30 days.
const GOOGLE_ADS_STALE_DAYS = 14
const MANUAL_SOURCE_STALE_DAYS = 30

interface NewAlert {
  competitor_id: string | null
  alert_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  recommended_action?: string | null
  data_source?: string | null
  evidence?: unknown
  metadata?: Record<string, unknown> | null
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

/**
 * Check whether an alert of this type+competitor was already created within
 * the dedup window. `subKey`, when provided, is matched against
 * metadata->>dedup_sub_key so multiple independent conditions that share the
 * same alert_type + null competitor_id (e.g. the per-module data_quality
 * checks) don't dedupe against each other.
 */
async function alreadyAlerted(
  supabase: SupabaseClient,
  alertType: string,
  competitorId: string | null,
  subKey?: string
): Promise<boolean> {
  let query = supabase
    .from('alerts')
    .select('id, metadata')
    .eq('alert_type', alertType)
    .gte('created_at', daysAgoIso(DEDUP_WINDOW_DAYS))

  query = competitorId === null ? query.is('competitor_id', null) : query.eq('competitor_id', competitorId)

  const { data, error } = await query
  if (error) {
    console.error(`alreadyAlerted check failed for ${alertType}:`, error.message)
    return false
  }
  if (!data) return false
  if (!subKey) return data.length > 0
  return data.some((row) => (row.metadata as Record<string, unknown> | null)?.dedup_sub_key === subKey)
}

async function insertAlert(supabase: SupabaseClient, alert: NewAlert): Promise<boolean> {
  const { error } = await supabase.from('alerts').insert({
    competitor_id: alert.competitor_id,
    alert_type: alert.alert_type,
    severity: alert.severity,
    title: alert.title,
    description: alert.description,
    recommended_action: alert.recommended_action ?? null,
    data_source: alert.data_source ?? null,
    evidence: alert.evidence ?? null,
    metadata: alert.metadata ?? null,
  })
  if (error) {
    console.error(`Failed to insert alert (${alert.alert_type}):`, error.message)
    return false
  }
  return true
}

// ─── Rule: new_competitor_course ───────────────────────────────────────────────
async function ruleNewCompetitorCourse(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: rows, error } = await supabase
    .from('sf_courses')
    .select('competitor_id, title, first_seen_at')
    .gte('first_seen_at', daysAgoIso(NEW_COURSE_WINDOW_DAYS))
    .not('competitor_id', 'is', null)

  if (error || !rows) return []

  const byCompetitor = new Map<string, string[]>()
  for (const row of rows) {
    const cid = row.competitor_id as string
    const list = byCompetitor.get(cid) ?? []
    list.push(row.title as string)
    byCompetitor.set(cid, list)
  }

  const alerts: NewAlert[] = []
  for (const [competitorId, titles] of byCompetitor) {
    if (await alreadyAlerted(supabase, 'new_competitor_course', competitorId)) continue
    alerts.push({
      competitor_id: competitorId,
      alert_type: 'new_competitor_course',
      severity: 'medium',
      title: `${titles.length} new course${titles.length > 1 ? 's' : ''} listed on MySkillsFuture`,
      description: `Detected ${titles.length} new course${titles.length > 1 ? 's' : ''} in the last ${NEW_COURSE_WINDOW_DAYS} days: ${titles.slice(0, 5).join(', ')}${titles.length > 5 ? ', …' : ''}`,
      recommended_action: 'Review the new course(s) for overlap with Hustle SG offerings and pricing positioning.',
      data_source: 'myskillsfuture',
      evidence: { course_titles: titles },
    })
  }
  return alerts
}

// ─── Rule: course_removed ──────────────────────────────────────────────────────
async function ruleCourseRemoved(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: rows, error } = await supabase
    .from('sf_courses')
    .select('competitor_id, title, last_seen_at')
    .eq('is_active', false)
    .gte('last_seen_at', daysAgoIso(NEW_COURSE_WINDOW_DAYS))
    .not('competitor_id', 'is', null)

  if (error || !rows) return []

  const byCompetitor = new Map<string, string[]>()
  for (const row of rows) {
    const cid = row.competitor_id as string
    const list = byCompetitor.get(cid) ?? []
    list.push(row.title as string)
    byCompetitor.set(cid, list)
  }

  const alerts: NewAlert[] = []
  for (const [competitorId, titles] of byCompetitor) {
    if (await alreadyAlerted(supabase, 'course_removed', competitorId)) continue
    alerts.push({
      competitor_id: competitorId,
      alert_type: 'course_removed',
      severity: 'low',
      title: `${titles.length} course${titles.length > 1 ? 's' : ''} removed from MySkillsFuture`,
      description: `${titles.length} course${titles.length > 1 ? 's' : ''} no longer active: ${titles.slice(0, 5).join(', ')}${titles.length > 5 ? ', …' : ''}`,
      data_source: 'myskillsfuture',
      evidence: { course_titles: titles },
    })
  }
  return alerts
}

// ─── Rule: run_count_surge ──────────────────────────────────────────────────────
async function ruleRunCountSurge(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: sfRows, error: sfErr } = await supabase
    .from('sf_courses')
    .select('competitor_id, upcoming_run_count')
    .not('competitor_id', 'is', null)

  if (sfErr || !sfRows) return []

  const currentRuns = new Map<string, number>()
  for (const row of sfRows) {
    const cid = row.competitor_id as string
    currentRuns.set(cid, (currentRuns.get(cid) ?? 0) + (row.upcoming_run_count as number ?? 0))
  }

  const { data: mktRows, error: mktErr } = await supabase
    .from('competitor_marketing_data')
    .select('competitor_id, sf_runs')

  if (mktErr || !mktRows) return []

  const previousRuns = new Map<string, number>()
  for (const row of mktRows) {
    previousRuns.set(row.competitor_id as string, (row.sf_runs as number) ?? 0)
  }

  const alerts: NewAlert[] = []
  for (const [competitorId, current] of currentRuns) {
    const previous = previousRuns.get(competitorId) ?? 0
    const delta = current - previous
    if (previous <= 0 || delta < 5) continue
    const pctIncrease = (delta / previous) * 100
    if (pctIncrease < 30) continue

    if (await alreadyAlerted(supabase, 'run_count_surge', competitorId)) continue
    alerts.push({
      competitor_id: competitorId,
      alert_type: 'run_count_surge',
      severity: 'high',
      title: `Upcoming course runs surged ${pctIncrease.toFixed(0)}%`,
      description: `Total upcoming SkillsFuture course runs went from ${previous} to ${current} (+${delta}, +${pctIncrease.toFixed(0)}%).`,
      recommended_action: 'Investigate which courses are driving the surge — may indicate a marketing push or new cohort launch.',
      data_source: 'myskillsfuture',
      evidence: { previous_runs: previous, current_runs: current, delta },
    })
  }
  return alerts
}

// ─── Rule: course_fee_drop ──────────────────────────────────────────────────────
// fee_change decrease >=15%, sourced from course_changes (written by
// courses/intelligence.ts's detectCourseChanges). Dedup key includes the
// sf_ref_no so multiple courses from the same competitor don't suppress
// each other, matching the "avoid duplicate alerts for same event" ask.
async function ruleCourseFeeDrop(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: rows, error } = await supabase
    .from('course_changes')
    .select('competitor_id, provider_name, course_title, sf_ref_no, old_value, new_value, change_percentage, detected_at')
    .eq('change_type', 'fee_change')
    .gte('detected_at', daysAgoIso(2))
    .lte('change_percentage', -15)

  if (error || !rows) return []

  const alerts: NewAlert[] = []
  for (const row of rows) {
    const subKey = `fee_drop:${row.sf_ref_no}`
    if (await alreadyAlerted(supabase, 'course_fee_drop', row.competitor_id as string | null, subKey)) continue

    alerts.push({
      competitor_id: (row.competitor_id as string) ?? null,
      alert_type: 'course_fee_drop',
      severity: 'medium',
      title: `${row.provider_name ?? 'Competitor'} lowered course fee`,
      description: `"${row.course_title}" fee dropped from $${row.old_value} to $${row.new_value} (${row.change_percentage}%).`,
      recommended_action: 'Review Hustle SG pricing for the equivalent course category.',
      data_source: 'myskillsfuture',
      evidence: { sf_ref_no: row.sf_ref_no, old_value: row.old_value, new_value: row.new_value, change_percentage: row.change_percentage },
      metadata: { dedup_sub_key: subKey },
    })
  }
  return alerts
}

// ─── Rule: new_high_demand_course ───────────────────────────────────────────────
// A new_course change whose course now has demand_score >= 75.
async function ruleNewHighDemandCourse(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: changeRows, error } = await supabase
    .from('course_changes')
    .select('competitor_id, provider_name, course_title, category, sf_ref_no, detected_at')
    .eq('change_type', 'new_course')
    .gte('detected_at', daysAgoIso(2))

  if (error || !changeRows || changeRows.length === 0) return []

  const refNos = changeRows.map((r) => r.sf_ref_no as string).filter(Boolean)
  if (refNos.length === 0) return []

  const { data: courseRows, error: courseErr } = await supabase
    .from('sf_courses')
    .select('sf_ref_no, demand_score')
    .in('sf_ref_no', refNos)
    .gte('demand_score', 75)

  if (courseErr || !courseRows || courseRows.length === 0) return []

  const demandByRef = new Map(courseRows.map((r) => [r.sf_ref_no as string, r.demand_score as number]))

  const alerts: NewAlert[] = []
  for (const row of changeRows) {
    const sfRefNo = row.sf_ref_no as string
    const demandScore = demandByRef.get(sfRefNo)
    if (demandScore === undefined) continue

    const subKey = `new_high_demand:${sfRefNo}`
    if (await alreadyAlerted(supabase, 'new_high_demand_course', row.competitor_id as string | null, subKey)) continue

    alerts.push({
      competitor_id: (row.competitor_id as string) ?? null,
      alert_type: 'new_high_demand_course',
      severity: 'high',
      title: `New high-demand course: ${row.course_title}`,
      description: `${row.provider_name ?? 'A competitor'} launched "${row.course_title}" (${row.category ?? 'uncategorized'}) with a demand score of ${demandScore}/100.`,
      recommended_action: 'Assess whether Hustle SG should launch a competing offering in this category.',
      data_source: 'myskillsfuture',
      evidence: { sf_ref_no: sfRefNo, demand_score: demandScore, category: row.category },
      metadata: { dedup_sub_key: subKey },
    })
  }
  return alerts
}

// ─── Rule: hustle_overtaken ──────────────────────────────────────────────────────
// For priority>=75 categories, a competitor's category runs newly exceed
// Hustle's, comparing the latest two snapshot days.
async function ruleHustleOvertaken(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: categoryRows, error: catErr } = await supabase
    .from('course_categories')
    .select('name, priority')
    .gte('priority', 75)
  if (catErr || !categoryRows || categoryRows.length === 0) return []
  const highPriorityCategories = new Set(categoryRows.map((r) => r.name as string))

  const { data: competitorsRaw, error: compErr } = await supabase
    .from('competitors')
    .select('id, name, is_hustle')
    .eq('active', true)
    .is('archived_at', null)
  if (compErr || !competitorsRaw) return []
  const hustle = competitorsRaw.find((c) => c.is_hustle as boolean) as { id: string; name: string } | undefined
  if (!hustle) return []

  const { data: snapshotRows, error: snapErr } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, provider_name, competitor_id, category_breakdown')
    .order('snapshot_date', { ascending: false })
    .limit(2000)
  if (snapErr || !snapshotRows) return []

  const dates = Array.from(new Set(snapshotRows.map((r) => r.snapshot_date as string))).sort().reverse()
  if (dates.length < 2) return []
  const [latestDate, priorDate] = dates

  function runsFor(date: string, providerName: string, category: string): number {
    const row = snapshotRows!.find((r) => r.snapshot_date === date && r.provider_name === providerName)
    if (!row) return 0
    const breakdown = (row.category_breakdown ?? {}) as Record<string, { runs: number }>
    return breakdown[category]?.runs ?? 0
  }

  const alerts: NewAlert[] = []
  const competitorNames = competitorsRaw.filter((c) => !(c.is_hustle as boolean)).map((c) => ({ id: c.id as string, name: c.name as string }))

  for (const category of highPriorityCategories) {
    const hustleLatest = runsFor(latestDate, hustle.name, category)
    const hustlePrior = runsFor(priorDate, hustle.name, category)

    for (const comp of competitorNames) {
      const compLatest = runsFor(latestDate, comp.name, category)
      const compPrior = runsFor(priorDate, comp.name, category)

      const wasOvertaken = compPrior <= hustlePrior
      const isOvertaken = compLatest > hustleLatest
      if (!(wasOvertaken && isOvertaken && compLatest > 0)) continue

      const subKey = `overtaken:${comp.id}:${category}`
      if (await alreadyAlerted(supabase, 'hustle_overtaken', comp.id, subKey)) continue

      alerts.push({
        competitor_id: comp.id,
        alert_type: 'hustle_overtaken',
        severity: 'high',
        title: `Provider overtook Hustle in key category`,
        description: `${comp.name} now runs ${compLatest} upcoming ${category} sessions vs Hustle's ${hustleLatest} (was ${compPrior} vs ${hustlePrior} on ${priorDate}).`,
        recommended_action: `Review Hustle's ${category} scheduling and marketing — this is a strategic priority category.`,
        data_source: 'myskillsfuture',
        evidence: { category, competitor_runs: compLatest, hustle_runs: hustleLatest, prior_competitor_runs: compPrior, prior_hustle_runs: hustlePrior },
        metadata: { dedup_sub_key: subKey },
      })
    }
  }
  return alerts
}

// ─── Rule: category_crowding ─────────────────────────────────────────────────────
// A category reaches >=4 providers with runs growth >=30% (latest two snapshot days).
async function ruleCategoryCrowding(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: snapshotRows, error } = await supabase
    .from('course_intelligence_snapshots')
    .select('snapshot_date, provider_name, category_breakdown')
    .order('snapshot_date', { ascending: false })
    .limit(2000)
  if (error || !snapshotRows) return []

  const dates = Array.from(new Set(snapshotRows.map((r) => r.snapshot_date as string))).sort().reverse()
  if (dates.length < 2) return []
  const [latestDate, priorDate] = dates

  const latestByCategory = new Map<string, { providers: Set<string>; runs: number }>()
  const priorRunsByCategory = new Map<string, number>()

  for (const row of snapshotRows) {
    const breakdown = (row.category_breakdown ?? {}) as Record<string, { runs: number; courses: number }>
    const date = row.snapshot_date as string
    const provider = row.provider_name as string
    for (const [category, v] of Object.entries(breakdown)) {
      if (date === latestDate) {
        const entry = latestByCategory.get(category) ?? { providers: new Set<string>(), runs: 0 }
        if ((v.runs ?? 0) > 0) entry.providers.add(provider)
        entry.runs += v.runs ?? 0
        latestByCategory.set(category, entry)
      } else if (date === priorDate) {
        priorRunsByCategory.set(category, (priorRunsByCategory.get(category) ?? 0) + (v.runs ?? 0))
      }
    }
  }

  const alerts: NewAlert[] = []
  for (const [category, latest] of latestByCategory) {
    if (latest.providers.size < 4) continue
    const priorRuns = priorRunsByCategory.get(category) ?? 0
    if (priorRuns <= 0) continue
    const pct = ((latest.runs - priorRuns) / priorRuns) * 100
    if (pct < 30) continue

    const subKey = `crowding:${category}`
    if (await alreadyAlerted(supabase, 'category_crowding', null, subKey)) continue

    alerts.push({
      competitor_id: null,
      alert_type: 'category_crowding',
      severity: 'low',
      title: 'Category becoming crowded',
      description: `${category} now has ${latest.providers.size} active providers with upcoming runs growing ${pct.toFixed(0)}% (${priorRuns} to ${latest.runs}) since ${priorDate}.`,
      recommended_action: 'Monitor differentiation and pricing pressure in this category.',
      data_source: 'myskillsfuture',
      evidence: { category, providers_count: latest.providers.size, prior_runs: priorRuns, current_runs: latest.runs, growth_pct: Math.round(pct) },
      metadata: { dedup_sub_key: subKey },
    })
  }
  return alerts
}

// ─── Rule: meta_ads_change + review_growth (share the same snapshot query) ─────
async function ruleMarketingSnapshotChanges(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: rows, error } = await supabase
    .from('marketing_snapshots')
    .select('competitor_id, snapshot_date, meta_ads, google_reviews')
    .order('snapshot_date', { ascending: false })

  if (error || !rows) return []

  const byCompetitor = new Map<string, typeof rows>()
  for (const row of rows) {
    const cid = row.competitor_id as string
    const list = byCompetitor.get(cid) ?? []
    if (list.length < 2) list.push(row)
    byCompetitor.set(cid, list)
  }

  const alerts: NewAlert[] = []

  for (const [competitorId, snapshots] of byCompetitor) {
    if (snapshots.length < 2) continue
    const [latest, previous] = snapshots

    // meta_ads_change
    if (latest.meta_ads !== null && previous.meta_ads !== null && previous.meta_ads > 0) {
      const delta = latest.meta_ads - previous.meta_ads
      const pct = (delta / previous.meta_ads) * 100
      if (Math.abs(pct) >= 25) {
        const severity: 'high' | 'medium' = (pct >= 50 && delta >= 5) ? 'high' : 'medium'
        if (!(await alreadyAlerted(supabase, 'meta_ads_change', competitorId))) {
          const isGrowth = delta > 0
          alerts.push({
            competitor_id: competitorId,
            alert_type: 'meta_ads_change',
            severity,
            title: `Meta ad count ${isGrowth ? 'up' : 'down'} ${Math.abs(pct).toFixed(0)}%`,
            description: `Active Meta ads changed from ${previous.meta_ads} to ${latest.meta_ads} (${isGrowth ? '+' : ''}${delta}, ${isGrowth ? '+' : ''}${pct.toFixed(0)}%) between ${previous.snapshot_date} and ${latest.snapshot_date}.`,
            recommended_action: isGrowth
              ? 'Review their current Meta ad creatives and offers for competitive response.'
              : undefined,
            data_source: 'meta_ad_library',
            evidence: { previous: previous.meta_ads, current: latest.meta_ads, previous_date: previous.snapshot_date, current_date: latest.snapshot_date },
          })
        }
      }
    }

    // review_growth
    if (latest.google_reviews !== null && previous.google_reviews !== null && previous.google_reviews > 0) {
      const delta = latest.google_reviews - previous.google_reviews
      const pct = (delta / previous.google_reviews) * 100
      if (delta >= 10 && pct >= 10) {
        if (!(await alreadyAlerted(supabase, 'review_growth', competitorId))) {
          alerts.push({
            competitor_id: competitorId,
            alert_type: 'review_growth',
            severity: 'medium',
            title: `Google reviews grew ${pct.toFixed(0)}%`,
            description: `Google review count grew from ${previous.google_reviews} to ${latest.google_reviews} (+${delta}, +${pct.toFixed(0)}%) between ${previous.snapshot_date} and ${latest.snapshot_date}.`,
            data_source: 'google_business',
            evidence: { previous: previous.google_reviews, current: latest.google_reviews, previous_date: previous.snapshot_date, current_date: latest.snapshot_date },
          })
        }
      }
    }
  }

  return alerts
}

// ─── Rule: hiring_spike ─────────────────────────────────────────────────────────
function inferHiringNote(titles: string[]): string | null {
  const joined = titles.join(' | ')
  if (/sales|business development/i.test(joined)) return 'possible B2B push'
  if (/trainer|instructor/i.test(joined)) return 'possible course expansion'
  if (/curriculum|instructional/i.test(joined)) return 'possible new course development'
  if (/marketing|growth/i.test(joined)) return 'likely acquisition push'
  return null
}

async function ruleHiringSpike(supabase: SupabaseClient): Promise<NewAlert[]> {
  const { data: rows, error } = await supabase
    .from('job_postings')
    .select('competitor_id, title, source, scraped_at')
    .gte('scraped_at', daysAgoIso(NEW_COURSE_WINDOW_DAYS))
    .not('competitor_id', 'is', null)

  if (error || !rows) return []

  const byCompetitor = new Map<string, Array<{ title: string; source: string }>>()
  for (const row of rows) {
    const cid = row.competitor_id as string
    const list = byCompetitor.get(cid) ?? []
    list.push({ title: row.title as string, source: row.source as string })
    byCompetitor.set(cid, list)
  }

  const alerts: NewAlert[] = []
  for (const [competitorId, jobs] of byCompetitor) {
    if (jobs.length < 3) continue
    if (await alreadyAlerted(supabase, 'hiring_spike', competitorId)) continue

    const titles = jobs.map((j) => j.title)
    const note = inferHiringNote(titles)
    const sources = Array.from(new Set(jobs.map((j) => j.source)))

    alerts.push({
      competitor_id: competitorId,
      alert_type: 'hiring_spike',
      severity: 'medium',
      title: `${jobs.length} new job postings in the last ${NEW_COURSE_WINDOW_DAYS} days`,
      description: `${jobs.length} new roles posted: ${titles.slice(0, 5).join(', ')}${titles.length > 5 ? ', …' : ''}.${note ? ` (${note})` : ''}`,
      recommended_action: note ? `Monitor for ${note}.` : undefined,
      data_source: sources.join(','),
      evidence: { titles, sources },
    })
  }
  return alerts
}

// ─── Rule: data_quality ─────────────────────────────────────────────────────────
const DATA_QUALITY_MODULES = ['sf_courses', 'runcounts', 'marketing', 'hiring', 'social'] as const

async function ruleDataQuality(supabase: SupabaseClient): Promise<NewAlert[]> {
  const alerts: NewAlert[] = []

  for (const module of DATA_QUALITY_MODULES) {
    const { data: logs, error } = await supabase
      .from('data_refresh_logs')
      .select('status, started_at, error_message')
      .eq('module', module)
      .order('started_at', { ascending: false })
      .limit(20)

    if (error || !logs || logs.length === 0) continue

    const latest = logs[0]

    if (latest.status === 'failed') {
      const subKey = `failed:${module}`
      if (!(await alreadyAlerted(supabase, 'data_quality', null, subKey))) {
        alerts.push({
          competitor_id: null,
          alert_type: 'data_quality',
          severity: 'critical',
          title: `${module} refresh failed`,
          description: `The most recent ${module} refresh job failed: ${latest.error_message ?? 'no error message recorded'}.`,
          recommended_action: 'Check the cron logs and re-run the job manually.',
          data_source: module,
          evidence: { error_message: latest.error_message, started_at: latest.started_at },
          metadata: { dedup_sub_key: subKey, module },
        })
      }
      continue
    }

    const lastSuccess = logs.find((l) => l.status === 'success' || l.status === 'partial')
    const stale = !lastSuccess || new Date(lastSuccess.started_at).getTime() < Date.now() - STALE_HOURS * 60 * 60 * 1000
    if (stale) {
      const subKey = `stale:${module}`
      if (!(await alreadyAlerted(supabase, 'data_quality', null, subKey))) {
        alerts.push({
          competitor_id: null,
          alert_type: 'data_quality',
          severity: 'high',
          title: `${module} data is stale`,
          description: `No successful ${module} refresh in the last ${STALE_HOURS} hours.`,
          recommended_action: 'Check the cron schedule and job health for this module.',
          data_source: module,
          evidence: { last_success_at: lastSuccess?.started_at ?? null },
          metadata: { dedup_sub_key: subKey, module },
        })
      }
    }
  }

  // google_ads_transparency is permanently 'manual_only' — never mark it
  // working/failed/partial. Just bump the checked timestamp so the data
  // source registry reflects that we looked at it during this alert pass.
  try {
    await updateSourceStatus('google_ads_transparency', { last_checked_at: new Date().toISOString() })
  } catch (err) {
    console.error('Failed to bump google_ads_transparency last_checked_at:', err)
  }

  // Manual Google Ads verification overdue
  const { data: mktRows, error: mktErr } = await supabase
    .from('competitor_marketing_data')
    .select('competitor_id, google_ads, google_ads_verified_at')
    .not('google_ads', 'is', null)

  if (!mktErr && mktRows) {
    for (const row of mktRows) {
      const verifiedAt = row.google_ads_verified_at as string | null
      const isOverdue = !verifiedAt || new Date(verifiedAt).getTime() < Date.now() - GOOGLE_ADS_STALE_DAYS * 24 * 60 * 60 * 1000
      if (!isOverdue) continue

      const competitorId = row.competitor_id as string
      if (await alreadyAlerted(supabase, 'data_quality', competitorId, 'manual_data_overdue')) continue

      alerts.push({
        competitor_id: competitorId,
        alert_type: 'data_quality',
        severity: 'low',
        title: 'Google Ads estimate overdue for verification',
        description: verifiedAt
          ? `Google Ads figure was last verified on ${verifiedAt.split('T')[0]}, more than ${GOOGLE_ADS_STALE_DAYS} days ago.`
          : 'Google Ads figure has never been manually verified.',
        recommended_action: 'Manually check Google Ads Transparency Center and update the verified_at timestamp.',
        data_source: 'google_ads',
        evidence: { google_ads_verified_at: verifiedAt },
        metadata: { dedup_sub_key: 'manual_data_overdue' },
      })
    }
  }

  return alerts
}

// ─── Main entry point ───────────────────────────────────────────────────────────
export async function generateDataAlerts(): Promise<GenerateAlertsResult> {
  const supabase = await createServiceClient()

  const ruleResults = await Promise.all([
    ruleNewCompetitorCourse(supabase),
    ruleCourseRemoved(supabase),
    ruleRunCountSurge(supabase),
    ruleCourseFeeDrop(supabase),
    ruleNewHighDemandCourse(supabase),
    ruleHustleOvertaken(supabase),
    ruleCategoryCrowding(supabase),
    ruleMarketingSnapshotChanges(supabase),
    ruleHiringSpike(supabase),
    ruleDataQuality(supabase),
  ])

  const allAlerts = ruleResults.flat()

  let created = 0
  for (const alert of allAlerts) {
    const ok = await insertAlert(supabase, alert)
    if (ok) created++
  }

  return { created }
}
