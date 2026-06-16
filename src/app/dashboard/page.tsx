import { AppLayout } from '@/components/layout/app-layout'
import { MetricCard } from '@/components/dashboard/metric-card'
import { CompetitorBadge } from '@/components/dashboard/competitor-badge'
import { DataUnavailable } from '@/components/dashboard/data-unavailable'
import { SocialBarChart } from '@/components/charts/social-bar-chart'
import { createClient } from '@/lib/supabase/server'
import { formatNumber, formatRelativeTime, getSeverityBgClass, cn } from '@/lib/utils'
import { Trophy, TrendingUp, Users, BookOpen, Bell, Building2, Zap } from 'lucide-react'
import Link from 'next/link'

export const revalidate = 300 // Revalidate every 5 minutes

async function getDashboardData() {
  const supabase = await createClient()

  const [summaryRes, rankingRes, alertsRes, insightsRes, lastSocialRes] = await Promise.all([
    supabase.rpc('get_competitor_dashboard_summary'),
    supabase.rpc('get_social_ranking'),
    supabase
      .from('alerts')
      .select(`id, alert_type, severity, title, description, created_at, competitors(id, name, slug, color)`)
      .eq('is_dismissed', false)
      .eq('is_read', false)
      .order('created_at', { ascending: false })
      .limit(5),
    supabase
      .from('strategic_insights')
      .select('id, insight_type, title, body, severity, created_at')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(3),
    supabase
      .from('social_metrics')
      .select('scraped_at')
      .order('scraped_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const summary = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data
  const ranking = rankingRes.data ?? []

  return {
    summary,
    ranking,
    alerts: alertsRes.data ?? [],
    insights: insightsRes.data ?? [],
    lastUpdated: lastSocialRes.data?.scraped_at ?? null,
  }
}

const insightTypeLabel: Record<string, string> = {
  threat: 'Threat',
  opportunity: 'Opportunity',
  recommendation: 'Recommendation',
  market_position: 'Market Position',
  growth_analysis: 'Growth Analysis',
  social_insight: 'Social',
  hiring_intel: 'Hiring',
  course_intel: 'Course Intel',
}

export default async function DashboardPage() {
  const { summary, ranking, alerts, insights, lastUpdated } = await getDashboardData()

  // Build bar chart data from ranking
  const barChartData = ranking.map((r: {
    competitor_name: string
    competitor_color: string
    is_hustle: boolean
    total_followers: number
  }) => ({
    name: r.competitor_name,
    followers: r.total_followers > 0 ? r.total_followers : null,
    color: r.competitor_color,
    is_hustle: r.is_hustle,
  }))

  // Find Hustle rank
  const hustleEntry = ranking.find((r: { is_hustle: boolean }) => r.is_hustle)

  return (
    <AppLayout title="Dashboard" lastUpdated={lastUpdated}>
      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <MetricCard
          label="Our Social Rank"
          value={summary?.hustle_social_rank ?? null}
          format="rank"
          source="scraped"
          lastUpdated={lastUpdated}
          icon={<Trophy className="h-4 w-4" />}
          highlight
          suffix={` of ${summary?.total_competitors ?? 10}`}
        />
        <MetricCard
          label="Total Social Reach"
          value={hustleEntry?.total_followers ?? null}
          source="scraped"
          lastUpdated={lastUpdated}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <MetricCard
          label="Active Job Postings"
          value={summary?.active_job_postings ?? null}
          source="scraped"
          icon={<Users className="h-4 w-4" />}
        />
        <MetricCard
          label="Unread Alerts"
          value={summary?.unread_alerts ?? null}
          source="system"
          icon={<Bell className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* Social Ranking Chart */}
        <div className="lg:col-span-2 bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-sm font-semibold text-white">Social Reach Ranking</h2>
              <p className="text-xs text-slate-500 mt-0.5">Total followers across all platforms</p>
            </div>
            <Link
              href="/social-intelligence"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View full →
            </Link>
          </div>
          {barChartData.length === 0 ? (
            <div className="flex items-center justify-center h-40">
              <DataUnavailable label="No social data collected yet" />
            </div>
          ) : (
            <SocialBarChart data={barChartData} />
          )}
          {lastUpdated && (
            <p className="text-[11px] text-slate-600 mt-3 text-right">
              Last scraped: {formatRelativeTime(lastUpdated)} · src:scraped
            </p>
          )}
        </div>

        {/* Competitor Count */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Competitors Tracked</h2>
            <Link
              href="/competitors"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all →
            </Link>
          </div>
          <div className="space-y-2">
            {ranking.slice(0, 8).map((r: {
              competitor_id: string
              competitor_name: string
              competitor_color: string
              is_hustle: boolean
              tier: string
              total_followers: number
              rank: number
            }) => (
              <div key={r.competitor_id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-slate-500 w-4 shrink-0">#{r.rank}</span>
                  <CompetitorBadge
                    name={r.competitor_name}
                    color={r.competitor_color}
                    is_hustle={r.is_hustle}
                    size="sm"
                  />
                </div>
                <span className="text-xs text-slate-400 shrink-0 ml-2">
                  {r.total_followers > 0 ? formatNumber(r.total_followers) : (
                    <DataUnavailable inline />
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Alerts */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-white">Recent Alerts</h2>
              {alerts.length > 0 && (
                <span className="inline-flex items-center justify-center h-4.5 min-w-[18px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                  {alerts.length}
                </span>
              )}
            </div>
            <Link
              href="/alerts"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all →
            </Link>
          </div>

          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Bell className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No unread alerts</p>
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((alert: {
                id: string
                title: string
                description: string | null
                severity: string
                created_at: string
                competitors: { name: string; color: string } | null
              }) => (
                <div
                  key={alert.id}
                  className="flex gap-3 p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
                >
                  <div
                    className={cn(
                      'w-1.5 rounded-full shrink-0 self-stretch',
                      alert.severity === 'critical' ? 'bg-red-500' :
                      alert.severity === 'high' ? 'bg-orange-500' :
                      alert.severity === 'medium' ? 'bg-blue-500' :
                      'bg-slate-500'
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white leading-snug">{alert.title}</p>
                    {alert.description && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{alert.description}</p>
                    )}
                    <p className="text-[11px] text-slate-600 mt-1">
                      {formatRelativeTime(alert.created_at)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* AI Insights Preview */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-indigo-400" />
              <h2 className="text-sm font-semibold text-white">AI Strategic Insights</h2>
            </div>
            <Link
              href="/opportunity-engine"
              className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              View all →
            </Link>
          </div>

          {insights.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-slate-500">
              <Zap className="h-8 w-8 mb-2 opacity-30" />
              <p className="text-sm">No insights generated yet</p>
              <p className="text-xs text-slate-600 mt-1">Run the AI cron to generate insights</p>
            </div>
          ) : (
            <div className="space-y-3">
              {insights.map((insight: {
                id: string
                insight_type: string
                title: string
                body: string
                severity: string
                created_at: string
              }) => (
                <div
                  key={insight.id}
                  className="p-3 rounded-lg bg-slate-800/50 border border-slate-700/50"
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn(
                      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border',
                      getSeverityBgClass(insight.severity)
                    )}>
                      {insightTypeLabel[insight.insight_type] ?? insight.insight_type}
                    </span>
                    <span className="text-[11px] text-slate-600">
                      {formatRelativeTime(insight.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-white leading-snug">{insight.title}</p>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">{insight.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <Building2 className="h-8 w-8 text-slate-600" />
          <div>
            <p className="text-2xl font-bold text-white">{summary?.total_competitors ?? '–'}</p>
            <p className="text-xs text-slate-400">Competitors tracked</p>
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <TrendingUp className="h-8 w-8 text-slate-600" />
          <div>
            <p className="text-2xl font-bold text-white">
              {summary?.total_social_reach ? formatNumber(summary.total_social_reach) : '–'}
            </p>
            <p className="text-xs text-slate-400">Combined reach (all competitors)</p>
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <BookOpen className="h-8 w-8 text-slate-600" />
          <div>
            <p className="text-2xl font-bold text-white">{summary?.total_courses ?? '–'}</p>
            <p className="text-xs text-slate-400">Courses catalogued</p>
          </div>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <Users className="h-8 w-8 text-slate-600" />
          <div>
            <p className="text-2xl font-bold text-white">{summary?.active_job_postings ?? '–'}</p>
            <p className="text-xs text-slate-400">Active job postings</p>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
