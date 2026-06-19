import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 300

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface SFCourseRow {
  id: string
  sf_ref_no: string
  provider_name: string
  competitor_id: string | null
  title: string
  category_text: string | null
  course_fee: number | null
  has_active_runs: boolean
  respondent_count: number | null
  quality_rating: number | null
  popularity_score: number | null
  upcoming_run_count: number | null
  scraped_at: string
}

interface ProviderStats {
  provider_name: string
  competitor_id: string | null
  total_courses: number
  active_courses: number
  top_category: string | null
  top_category_count: number
  avg_course_fee: number | null
  total_attendees: number
  total_run_count: number
  top_course_by_attendees: string | null
  top_course_by_runs: string | null
  top_course_attendees: number
  top_course_run_count: number
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3: Snapshot today's sf_courses → course_snapshots
// ─────────────────────────────────────────────────────────────────────────────

async function stepSnapshot(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  snapshotDate: string,
  courses: SFCourseRow[]
): Promise<number> {
  if (courses.length === 0) return 0

  const rows = courses.map(c => ({
    snapshot_date: snapshotDate,
    sf_ref_no: c.sf_ref_no,
    provider_name: c.provider_name,
    competitor_id: c.competitor_id,
    course_name: c.title,
    category: c.category_text,
    course_fee: c.course_fee,
    has_active_runs: c.has_active_runs,
    popularity_score: c.popularity_score ? Math.round(Number(c.popularity_score)) : 0,
    quality_rating: c.quality_rating,
    schedule_count: c.upcoming_run_count ?? (c.has_active_runs ? 1 : 0),
  }))

  const { error, data } = await supabase
    .from('course_snapshots')
    .upsert(rows, { onConflict: 'snapshot_date,sf_ref_no', ignoreDuplicates: false })
    .select('id')

  if (error) throw new Error(`course_snapshots upsert failed: ${error.message}`)
  return data?.length ?? rows.length
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4: Diff vs yesterday → course_changes
// ─────────────────────────────────────────────────────────────────────────────

async function stepDiff(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  snapshotDate: string,
  todayCourses: SFCourseRow[]
): Promise<number> {
  const yesterday = new Date(snapshotDate)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  // Fetch yesterday's snapshot
  const { data: yesterdayRows, error: yErr } = await supabase
    .from('course_snapshots')
    .select('sf_ref_no, provider_name, competitor_id, course_name, category, has_active_runs')
    .eq('snapshot_date', yesterdayStr)

  if (yErr) {
    console.warn('Could not fetch yesterday snapshot, skipping diff:', yErr.message)
    return 0
  }

  if (!yesterdayRows || yesterdayRows.length === 0) {
    // First run — no diff possible
    return 0
  }

  const yesterdayMap = new Map(yesterdayRows.map(r => [r.sf_ref_no, r]))
  const todayMap = new Map(todayCourses.map(c => [c.sf_ref_no, c]))

  const changes: {
    change_type: string
    sf_ref_no: string
    provider_name: string
    competitor_id: string | null
    course_name: string | null
    category: string | null
    old_value: string | null
    new_value: string | null
    significance: string
  }[] = []

  // New courses (in today but not yesterday)
  for (const [sfRef, course] of todayMap) {
    if (!yesterdayMap.has(sfRef)) {
      changes.push({
        change_type: 'new_course',
        sf_ref_no: sfRef,
        provider_name: course.provider_name,
        competitor_id: course.competitor_id,
        course_name: course.title,
        category: course.category_text,
        old_value: null,
        new_value: course.title,
        significance: 'high',
      })
    }
  }

  // Removed courses (in yesterday but not today)
  for (const [sfRef, row] of yesterdayMap) {
    if (!todayMap.has(sfRef)) {
      changes.push({
        change_type: 'course_removed',
        sf_ref_no: sfRef,
        provider_name: row.provider_name,
        competitor_id: row.competitor_id,
        course_name: row.course_name,
        category: row.category,
        old_value: row.course_name,
        new_value: null,
        significance: 'medium',
      })
    }
  }

  // Schedule status changes (active → inactive or vice versa)
  for (const [sfRef, course] of todayMap) {
    const prev = yesterdayMap.get(sfRef)
    if (prev && prev.has_active_runs !== course.has_active_runs) {
      changes.push({
        change_type: 'schedule_change',
        sf_ref_no: sfRef,
        provider_name: course.provider_name,
        competitor_id: course.competitor_id,
        course_name: course.title,
        category: course.category_text,
        old_value: prev.has_active_runs ? 'active' : 'inactive',
        new_value: course.has_active_runs ? 'active' : 'inactive',
        significance: 'medium',
      })
    }
  }

  if (changes.length === 0) return 0

  const { error } = await supabase.from('course_changes').insert(changes)
  if (error) throw new Error(`course_changes insert failed: ${error.message}`)
  return changes.length
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 5: Aggregate per provider → provider_summary
// ─────────────────────────────────────────────────────────────────────────────

function computeProviderStats(courses: SFCourseRow[]): ProviderStats[] {
  const byProvider = new Map<string, SFCourseRow[]>()

  for (const c of courses) {
    const existing = byProvider.get(c.provider_name) ?? []
    existing.push(c)
    byProvider.set(c.provider_name, existing)
  }

  const stats: ProviderStats[] = []

  for (const [providerName, provCourses] of byProvider) {
    const active = provCourses.filter(c => c.has_active_runs)

    // Top category by active course count
    const catCounts = new Map<string, number>()
    for (const c of active) {
      if (c.category_text) {
        catCounts.set(c.category_text, (catCounts.get(c.category_text) ?? 0) + 1)
      }
    }
    let topCategory: string | null = null
    let topCategoryCount = 0
    for (const [cat, count] of catCounts) {
      if (count > topCategoryCount) { topCategory = cat; topCategoryCount = count }
    }

    // Average course fee
    const fees = provCourses.map(c => c.course_fee).filter((f): f is number => f !== null && f > 0)
    const avgFee = fees.length > 0 ? fees.reduce((a, b) => a + b, 0) / fees.length : null

    // Totals
    const totalAttendees = provCourses.reduce((s, c) => s + (c.respondent_count ?? 0), 0)
    const totalRunCount = provCourses.reduce((s, c) => s + (c.upcoming_run_count ?? 0), 0)

    // Top course by attendees
    const byAttendees = [...provCourses].sort((a, b) => (b.respondent_count ?? 0) - (a.respondent_count ?? 0))
    const topByAttendees = byAttendees[0]

    // Top course by run count
    const byRuns = [...provCourses].sort((a, b) => (b.upcoming_run_count ?? 0) - (a.upcoming_run_count ?? 0))
    const topByRuns = byRuns[0]

    stats.push({
      provider_name: providerName,
      competitor_id: provCourses[0]?.competitor_id ?? null,
      total_courses: provCourses.length,
      active_courses: active.length,
      top_category: topCategory,
      top_category_count: topCategoryCount,
      avg_course_fee: avgFee,
      total_attendees: totalAttendees,
      total_run_count: totalRunCount,
      top_course_by_attendees: topByAttendees?.title ?? null,
      top_course_by_runs: topByRuns?.title ?? null,
      top_course_attendees: topByAttendees?.respondent_count ?? 0,
      top_course_run_count: topByRuns?.upcoming_run_count ?? 0,
    })
  }

  return stats
}

async function stepProviderSummary(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  snapshotDate: string,
  courses: SFCourseRow[],
  changesCount: number
): Promise<{ rows: number; stats: ProviderStats[] }> {
  const stats = computeProviderStats(courses)
  const totalActive = stats.reduce((sum, s) => sum + s.active_courses, 0)

  const rows = stats.map((s) => ({
    snapshot_date: snapshotDate,
    provider_name: s.provider_name,
    competitor_id: s.competitor_id,
    total_courses: s.total_courses,
    active_courses: s.active_courses,
    total_schedules: s.total_run_count,
    top_category: s.top_category,
    top_category_count: s.top_category_count,
    avg_course_fee: s.avg_course_fee,
    market_share_pct: totalActive > 0
      ? Math.round((s.active_courses / totalActive) * 1000) / 10
      : 0,
    activity_score: s.active_courses,
    new_courses_7d: 0,
    removed_courses_7d: 0,
    schedule_change_7d: 0,
    total_attendees: s.total_attendees,
    total_run_count: s.total_run_count,
    top_course_by_attendees: s.top_course_by_attendees,
    top_course_by_runs: s.top_course_by_runs,
    top_course_attendees: s.top_course_attendees,
    top_course_run_count: s.top_course_run_count,
    last_updated: new Date().toISOString(),
  }))

  // Fetch 7-day change counts per provider
  const sevenDaysAgo = new Date(snapshotDate)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const { data: recentChanges } = await supabase
    .from('course_changes')
    .select('provider_name, change_type')
    .gte('detected_at', sevenDaysAgo.toISOString())

  if (recentChanges && recentChanges.length > 0) {
    const newMap = new Map<string, number>()
    const removedMap = new Map<string, number>()
    const scheduleMap = new Map<string, number>()

    for (const change of recentChanges) {
      const p = change.provider_name
      if (change.change_type === 'new_course') newMap.set(p, (newMap.get(p) ?? 0) + 1)
      if (change.change_type === 'course_removed') removedMap.set(p, (removedMap.get(p) ?? 0) + 1)
      if (change.change_type === 'schedule_change') scheduleMap.set(p, (scheduleMap.get(p) ?? 0) + 1)
    }

    for (const row of rows) {
      row.new_courses_7d = newMap.get(row.provider_name) ?? 0
      row.removed_courses_7d = removedMap.get(row.provider_name) ?? 0
      row.schedule_change_7d = scheduleMap.get(row.provider_name) ?? 0
    }
  }

  const { error, data } = await supabase
    .from('provider_summary')
    .upsert(rows, { onConflict: 'snapshot_date,provider_name', ignoreDuplicates: false })
    .select('id')

  if (error) throw new Error(`provider_summary upsert failed: ${error.message}`)
  return { rows: data?.length ?? rows.length, stats }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 6: Generate market_alerts
// ─────────────────────────────────────────────────────────────────────────────

async function stepAlerts(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  snapshotDate: string,
  stats: ProviderStats[]
): Promise<number> {
  const alerts: {
    alert_type: string
    severity: string
    provider_name: string | null
    competitor_id: string | null
    category: string | null
    title: string
    description: string
    recommendation: string | null
    data_points: Record<string, unknown>
    snapshot_date: string
  }[] = []

  // Rank providers by active courses
  const ranked = [...stats].sort((a, b) => b.active_courses - a.active_courses)
  const totalActive = ranked.reduce((s, r) => s + r.active_courses, 0)

  // Alert: dominant provider (>30% market share)
  for (const provider of ranked) {
    const share = totalActive > 0 ? (provider.active_courses / totalActive) * 100 : 0
    if (share >= 30) {
      alerts.push({
        alert_type: 'market_dominance',
        severity: 'high',
        provider_name: provider.provider_name,
        competitor_id: provider.competitor_id,
        category: provider.top_category,
        title: `${provider.provider_name} controls ${share.toFixed(1)}% of active schedules`,
        description: `With ${provider.active_courses} active courses, this provider holds a dominant market position in the SkillsFuture ecosystem.`,
        recommendation: `Review their ${provider.top_category ?? 'top'} course offerings and identify differentiation opportunities.`,
        data_points: { active_courses: provider.active_courses, market_share_pct: share },
        snapshot_date: snapshotDate,
      })
    }
  }

  // Alert: provider with zero active courses
  for (const provider of stats) {
    if (provider.active_courses === 0 && provider.total_courses > 0) {
      alerts.push({
        alert_type: 'provider_inactive',
        severity: 'medium',
        provider_name: provider.provider_name,
        competitor_id: provider.competitor_id,
        category: null,
        title: `${provider.provider_name} has no active schedules`,
        description: `This provider has ${provider.total_courses} courses listed but none with active scheduled runs.`,
        recommendation: 'Monitor for re-activation. Potential pricing or capacity adjustment opportunity.',
        data_points: { total_courses: provider.total_courses, active_courses: 0 },
        snapshot_date: snapshotDate,
      })
    }
  }

  // Market overview alert (always generated)
  const activeProviders = stats.filter(s => s.active_courses > 0).length
  alerts.push({
    alert_type: 'market_overview',
    severity: 'low',
    provider_name: null,
    competitor_id: null,
    category: null,
    title: `Daily refresh: ${totalActive} active schedules across ${activeProviders} providers`,
    description: `MySkillsFuture daily snapshot completed. ${stats.reduce((s, r) => s + r.total_courses, 0)} total courses tracked across ${stats.length} providers.`,
    recommendation: null,
    data_points: { total_active: totalActive, active_providers: activeProviders, total_providers: stats.length },
    snapshot_date: snapshotDate,
  })

  if (alerts.length === 0) return 0

  const { error } = await supabase.from('market_alerts').insert(alerts)
  if (error) throw new Error(`market_alerts insert failed: ${error.message}`)
  return alerts.length
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 7: Log to data_refresh_logs
// ─────────────────────────────────────────────────────────────────────────────

async function stepLog(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  snapshotDate: string,
  status: 'success' | 'error',
  counts: {
    rows_collected: number
    rows_inserted: number
    changes_detected: number
    alerts_generated: number
    duration_ms: number
    error_message?: string
  }
): Promise<void> {
  const { error } = await supabase.from('data_refresh_logs').insert({
    source: 'myskillsfuture',
    status,
    snapshot_date: snapshotDate,
    rows_collected: counts.rows_collected,
    rows_inserted: counts.rows_inserted,
    rows_updated: 0,
    changes_detected: counts.changes_detected,
    alerts_generated: counts.alerts_generated,
    duration_ms: counts.duration_ms,
    error_message: counts.error_message ?? null,
    metadata: { pipeline: 'steps_3_to_7' },
    started_at: new Date(Date.now() - counts.duration_ms).toISOString(),
    completed_at: new Date().toISOString(),
  })

  if (error) {
    console.error('Failed to write data_refresh_logs:', error.message)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const authHeader = request.headers.get('Authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const startTime = Date.now()
  const snapshotDate = new Date().toISOString().split('T')[0]
  const supabase = await createServiceClient()

  try {
    // Load all current courses from sf_courses
    const { data: courses, error: coursesErr } = await supabase
      .from('sf_courses')
      .select('id,sf_ref_no,provider_name,competitor_id,title,category_text,course_fee,has_active_runs,respondent_count,quality_rating,popularity_score,upcoming_run_count,scraped_at')
      .eq('is_valid', true)

    if (coursesErr) throw new Error(`Failed to load sf_courses: ${coursesErr.message}`)
    if (!courses || courses.length === 0) {
      return NextResponse.json({ success: false, error: 'sf_courses is empty — run sf-refresh first' }, { status: 400 })
    }

    const rows_collected = courses.length

    // Step 3: Snapshot
    const snapshotCount = await stepSnapshot(supabase, snapshotDate, courses as SFCourseRow[])

    // Step 4: Diff
    const changesCount = await stepDiff(supabase, snapshotDate, courses as SFCourseRow[])

    // Step 5: Provider summary
    const { rows: summaryRows, stats } = await stepProviderSummary(
      supabase, snapshotDate, courses as SFCourseRow[], changesCount
    )

    // Step 6: Alerts
    const alertsCount = await stepAlerts(supabase, snapshotDate, stats)

    const duration_ms = Date.now() - startTime

    // Step 7: Log success
    await stepLog(supabase, snapshotDate, 'success', {
      rows_collected,
      rows_inserted: snapshotCount,
      changes_detected: changesCount,
      alerts_generated: alertsCount,
      duration_ms,
    })

    return NextResponse.json({
      success: true,
      snapshot_date: snapshotDate,
      rows_collected,
      snapshots_written: snapshotCount,
      changes_detected: changesCount,
      provider_summaries_written: summaryRows,
      alerts_generated: alertsCount,
      duration_ms,
      providers: stats.map(s => ({
        name: s.provider_name,
        total_courses: s.total_courses,
        active_courses: s.active_courses,
      })),
    })
  } catch (err) {
    const duration_ms = Date.now() - startTime
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error('myskillsfuture-refresh pipeline error:', errorMessage)

    await stepLog(supabase, snapshotDate, 'error', {
      rows_collected: 0,
      rows_inserted: 0,
      changes_detected: 0,
      alerts_generated: 0,
      duration_ms,
      error_message: errorMessage,
    })

    return NextResponse.json(
      { success: false, error: errorMessage, duration_ms },
      { status: 500 }
    )
  }
}
