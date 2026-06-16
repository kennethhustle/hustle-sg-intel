import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  // Get aggregated summary from DB function
  const { data: summary, error: summaryError } = await supabase
    .rpc('get_competitor_dashboard_summary')

  if (summaryError) {
    return NextResponse.json({ error: summaryError.message }, { status: 500 })
  }

  const stats = Array.isArray(summary) && summary.length > 0 ? summary[0] : summary

  // Get top 5 by total reach for the bar chart
  const { data: ranking, error: rankingError } = await supabase
    .rpc('get_social_ranking')

  if (rankingError) {
    return NextResponse.json({ error: rankingError.message }, { status: 500 })
  }

  // Get last 5 unread alerts
  const { data: recentAlerts } = await supabase
    .from('alerts')
    .select(`
      id, alert_type, severity, title, description, created_at,
      competitors (id, name, slug, color)
    `)
    .eq('is_dismissed', false)
    .eq('is_read', false)
    .order('created_at', { ascending: false })
    .limit(5)

  // Get last 3 strategic insights
  const { data: recentInsights } = await supabase
    .from('strategic_insights')
    .select('id, insight_type, title, body, severity, created_at')
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false })
    .limit(3)

  // Get last refresh times from each data source
  const { data: lastSocialMetric } = await supabase
    .from('social_metrics')
    .select('scraped_at')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: lastJob } = await supabase
    .from('job_postings')
    .select('scraped_at')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: lastCourse } = await supabase
    .from('course_catalog')
    .select('scraped_at')
    .order('scraped_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  return NextResponse.json({
    summary: {
      total_competitors: stats?.total_competitors ?? 0,
      our_social_rank: stats?.hustle_social_rank ?? null,
      total_social_reach: stats?.total_social_reach ?? 0,
      active_job_postings: stats?.active_job_postings ?? 0,
      total_courses: stats?.total_courses ?? 0,
      unread_alerts: stats?.unread_alerts ?? 0,
    },
    ranking: (ranking ?? []).slice(0, 10),
    recent_alerts: recentAlerts ?? [],
    recent_insights: recentInsights ?? [],
    last_refresh: {
      social: lastSocialMetric?.scraped_at ?? null,
      jobs: lastJob?.scraped_at ?? null,
      courses: lastCourse?.scraped_at ?? null,
    },
  })
}
