import type { createServiceClient } from '@/lib/supabase/server'
import type { SeoPayload } from '@/lib/services/ai/claude'

type ServiceClient = Awaited<ReturnType<typeof createServiceClient>>

/**
 * Gather SEO intelligence inputs from the existing internal database only — no
 * external SEO/search API. Every field maps to data already scraped into
 * Supabase (social reach, MySkillsFuture demand, course catalog, hiring), so
 * the Gemini prompt can reason from real numbers and never invent rankings.
 */
export async function gatherSeoIntelligence(supabase: ServiceClient): Promise<SeoPayload> {
  // ── Competitors + audience reach (followers as a brand-search-demand proxy) ──
  const { data: ranking } = await supabase.rpc('get_social_ranking')
  const competitors: SeoPayload['competitors'] = (ranking ?? []).map((r: {
    competitor_name: string
    is_hustle: boolean
    total_followers: number | null
  }) => ({
    name: r.competitor_name,
    is_hustle: !!r.is_hustle,
    total_followers: r.total_followers ?? 0,
  }))

  // ── High-demand course topics (MySkillsFuture upcoming run counts) ──
  const { data: topRuns } = await supabase
    .from('provider_top_runs')
    .select('provider, course_name, upcoming_run_count, competitor_name')
    .order('upcoming_run_count', { ascending: false })
    .limit(60)
  const demandTopics: SeoPayload['demandTopics'] = (topRuns ?? []).map((r: {
    provider: string
    course_name: string
    upcoming_run_count: number | null
    competitor_name: string | null
  }) => ({
    provider: r.provider,
    course: r.course_name,
    upcoming_runs: r.upcoming_run_count ?? 0,
    competitor: r.competitor_name,
  }))

  // ── Competitor course catalog (titles each competitor already markets for) ──
  const { data: catalog } = await supabase
    .from('course_catalog')
    .select('title, competitor_id, is_active, competitors(name)')
    .eq('is_active', true)
    .limit(800)
  const competitorCourses: Record<string, string[]> = {}
  for (const row of (catalog ?? []) as Array<{
    title: string | null
    competitor_id: string
    competitors: { name: string } | { name: string }[] | null
  }>) {
    const compRaw = row.competitors
    const name = (Array.isArray(compRaw) ? compRaw[0] : compRaw)?.name ?? row.competitor_id
    if (!row.title) continue
    const list = (competitorCourses[name] ??= [])
    if (list.length < 25) list.push(row.title)
  }

  // ── SkillsFuture category demand (aggregate respondents per category) ──
  const { data: sfCourses } = await supabase
    .from('sf_courses')
    .select('category_text, respondent_count')
    .limit(2000)
  const categoryAgg = new Map<string, { courses: number; respondents: number }>()
  for (const row of (sfCourses ?? []) as Array<{
    category_text: string | null
    respondent_count: number | null
  }>) {
    const cat = row.category_text?.trim()
    if (!cat) continue
    const entry = categoryAgg.get(cat) ?? { courses: 0, respondents: 0 }
    entry.courses += 1
    entry.respondents += row.respondent_count ?? 0
    categoryAgg.set(cat, entry)
  }
  const categoryDemand: SeoPayload['categoryDemand'] = Array.from(categoryAgg.entries())
    .map(([category, v]) => ({ category, courses: v.courses, respondents: v.respondents }))
    .sort((a, b) => b.respondents - a.respondents)

  // ── Recent hiring titles (skills the market is investing in) ──
  const { data: jobs } = await supabase
    .from('job_postings')
    .select('title, is_active, scraped_at')
    .eq('is_active', true)
    .order('scraped_at', { ascending: false })
    .limit(40)
  const hiringTitles: string[] = (jobs ?? [])
    .map((j: { title: string | null }) => j.title)
    .filter((t: string | null): t is string => !!t)

  return { competitors, demandTopics, competitorCourses, categoryDemand, hiringTitles }
}
