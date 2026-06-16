import { AppLayout } from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { formatRelativeTime, getPlatformLabel, cn } from '@/lib/utils'
import { Clock, Database, Globe, User, Shield } from 'lucide-react'
import type { Platform } from '@/lib/types'

export const revalidate = 60

const CRON_SCHEDULE = [
  { name: 'Social Refresh', path: '/api/cron/social-refresh', schedule: '0 23 * * *', time: '7:00am SGT', description: 'Scrapes social follower counts for all competitors' },
  { name: 'Hiring Refresh', path: '/api/cron/hiring-refresh', schedule: '0 0 * * *', time: '8:00am SGT', description: 'Scrapes job postings from MCF, JobStreet, Indeed, career pages' },
  { name: 'Courses Refresh', path: '/api/cron/courses-refresh', schedule: '0 1 * * *', time: '9:00am SGT', description: 'Scrapes SkillsFuture API and company course pages' },
  { name: 'AI Insights', path: '/api/cron/ai-insights', schedule: '0 2 * * *', time: '10:00am SGT', description: 'Generates strategic insights using Claude AI' },
]

const PLATFORMS: Platform[] = ['instagram', 'facebook', 'linkedin', 'tiktok', 'youtube']

async function getSettingsData() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: userData } = user ? await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .maybeSingle() : { data: null }

  const { data: competitors } = await supabase
    .from('competitors')
    .select('id, name, slug, website, is_hustle, active, tier, color')
    .order('name')

  const { data: profiles } = await supabase
    .from('social_profiles')
    .select('competitor_id, platform, handle, active')

  const { data: lastMetric } = await supabase
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

  // Build profile map: competitor_id -> platform -> handle
  const profileMap = new Map<string, Map<Platform, string | null>>()
  for (const p of (profiles ?? [])) {
    if (!profileMap.has(p.competitor_id)) {
      profileMap.set(p.competitor_id, new Map())
    }
    profileMap.get(p.competitor_id)!.set(p.platform as Platform, p.handle)
  }

  return {
    user,
    userData,
    competitors: competitors ?? [],
    profileMap,
    lastRun: {
      social: lastMetric?.scraped_at ?? null,
      jobs: lastJob?.scraped_at ?? null,
      courses: lastCourse?.scraped_at ?? null,
    }
  }
}

export default async function SettingsPage() {
  const { user, userData, competitors, profileMap, lastRun } = await getSettingsData()

  return (
    <AppLayout title="Settings">
      <div className="space-y-6 max-w-5xl">
        {/* User Profile */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <User className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Your Profile</h2>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-xs text-slate-500 mb-1">Email</p>
              <p className="text-sm text-white">{user?.email ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Role</p>
              <span className={cn(
                'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
                userData?.role === 'admin'
                  ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                  : userData?.role === 'analyst'
                  ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                  : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
              )}>
                {userData?.role ?? 'viewer'}
              </span>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Company</p>
              <p className="text-sm text-white">{userData?.company ?? 'Hustle SG'}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 mb-1">Last active</p>
              <p className="text-sm text-slate-400">
                {userData?.last_seen_at ? formatRelativeTime(userData.last_seen_at) : 'Now'}
              </p>
            </div>
          </div>
        </section>

        {/* Cron Schedule */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Scraping Schedule</h2>
          </div>
          <div className="space-y-3">
            {CRON_SCHEDULE.map((cron) => (
              <div key={cron.path} className="flex items-start justify-between gap-4 p-3 bg-slate-800/50 rounded-lg border border-slate-700/50">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <p className="text-sm font-medium text-white">{cron.name}</p>
                    <span className="text-xs text-slate-500 font-mono bg-slate-800 px-1.5 py-0.5 rounded">
                      {cron.time}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">{cron.description}</p>
                  <p className="text-[11px] text-slate-600 mt-1 font-mono">{cron.path}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-mono text-slate-500">{cron.schedule}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { label: 'Last social scrape', value: lastRun.social },
              { label: 'Last jobs scrape', value: lastRun.jobs },
              { label: 'Last courses scrape', value: lastRun.courses },
            ].map(({ label, value }) => (
              <div key={label} className="bg-slate-800/50 rounded-lg p-3">
                <p className="text-xs text-slate-500">{label}</p>
                <p className="text-sm text-white mt-1">
                  {value ? formatRelativeTime(value) : 'Never run'}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* Competitor Management */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Globe className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Competitors</h2>
            <span className="text-xs text-slate-500">({competitors.filter((c) => c.active).length} active)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Name</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Website</th>
                  <th className="text-left py-2 px-3 text-xs font-medium text-slate-500">Tier</th>
                  {PLATFORMS.map((p) => (
                    <th key={p} className="text-center py-2 px-2 text-xs font-medium text-slate-500">
                      {getPlatformLabel(p).slice(0, 2)}
                    </th>
                  ))}
                  <th className="text-center py-2 px-3 text-xs font-medium text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody>
                {competitors.map((c) => {
                  const pm = profileMap.get(c.id)
                  return (
                    <tr key={c.id} className="border-b border-slate-800/40">
                      <td className="py-2.5 px-3">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: c.color }}
                          />
                          <span className={cn('text-sm', c.is_hustle ? 'text-indigo-300 font-medium' : 'text-white')}>
                            {c.name}
                          </span>
                          {c.is_hustle && (
                            <span className="text-[9px] font-bold text-indigo-400 uppercase">US</span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-xs text-slate-400">{c.website}</td>
                      <td className="py-2.5 px-3">
                        <span className="text-xs text-slate-400">{c.tier}</span>
                      </td>
                      {PLATFORMS.map((p) => (
                        <td key={p} className="py-2.5 px-2 text-center">
                          {pm?.get(p) ? (
                            <span className="text-[10px] text-emerald-400" title={pm.get(p)!}>
                              ✓
                            </span>
                          ) : (
                            <span className="text-slate-700 text-[10px]">—</span>
                          )}
                        </td>
                      ))}
                      <td className="py-2.5 px-3 text-center">
                        <span className={cn(
                          'text-[10px] px-1.5 py-0.5 rounded border',
                          c.active
                            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                            : 'bg-slate-500/10 text-slate-500 border-slate-700'
                        )}>
                          {c.active ? 'active' : 'inactive'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-600 mt-3">
            To modify competitors or social handles, update the database directly via Supabase dashboard.
          </p>
        </section>

        {/* Security */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-white">Security</h2>
          </div>
          <div className="space-y-3 text-sm text-slate-400">
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span>Authentication</span>
              <span className="text-emerald-400 text-xs font-medium">Supabase Auth</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span>Cron protection</span>
              <span className="text-emerald-400 text-xs font-medium">Bearer token (CRON_SECRET)</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span>Row Level Security</span>
              <span className="text-emerald-400 text-xs font-medium">Enabled on all tables</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-slate-800/50 rounded-lg">
              <span>Data retention</span>
              <span className="text-slate-400 text-xs">All history kept · No auto-deletion</span>
            </div>
          </div>
        </section>

        {/* Data integrity statement */}
        <section className="bg-slate-900/40 border border-slate-800/50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <Database className="h-4 w-4 text-slate-500" />
            <h2 className="text-sm font-semibold text-slate-300">Data Integrity Policy</h2>
          </div>
          <ul className="space-y-2 text-xs text-slate-500">
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
              All metrics are sourced from live scraping or official APIs — never estimated or fabricated
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
              When data cannot be retrieved, NULL is stored in the database and DATA UNAVAILABLE is shown in the UI
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
              Every metric displays its data source (scraped / api / verified) and last-updated timestamp
            </li>
            <li className="flex items-start gap-2">
              <span className="text-emerald-400 shrink-0 mt-0.5">✓</span>
              AI insights are generated only from verified data — the prompt instructs Claude not to speculate on unavailable metrics
            </li>
          </ul>
        </section>
      </div>
    </AppLayout>
  )
}
