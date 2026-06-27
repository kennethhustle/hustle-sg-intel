import { GoogleGenAI } from '@google/genai'
import type { StrategicInsight, SocialRankingEntry, JobPosting, GenerationSource, InsightType, InsightModule, SeoCategory, AlertSeverity } from '@/lib/types'

const GEMINI_MODEL = 'gemini-2.5-flash'

/**
 * Maps each SEO presentation category to an insight_type that the
 * strategic_insights CHECK constraint allows. SEO insights are stored with the
 * base type here and their real category in metadata.seo_category — no new
 * insight_type values are ever inserted, so the schema/constraint is untouched.
 */
const SEO_CATEGORY_TO_TYPE: Record<SeoCategory, InsightType> = {
  keyword_opportunity: 'opportunity',
  seo_threat: 'threat',
  content_opportunity: 'opportunity',
  competitor_search_position: 'market_position',
  recommended_landing_page: 'recommendation',
  high_demand_topic: 'opportunity',
  missing_content_category: 'recommendation',
  search_growth: 'growth_analysis',
}

/**
 * Lazily construct the Gemini client so a missing key never crashes module
 * import (GET/list routes keep working). A clear error is thrown only when an
 * AI generation is actually attempted without a configured key, and it surfaces
 * through the existing cron/POST error JSON and the Regenerate error UI.
 */
function getClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error('AI provider not configured (GEMINI_API_KEY missing)')
  }
  return new GoogleGenAI({ apiKey })
}

interface IntelligencePayload {
  socialRanking: SocialRankingEntry[]
  recentJobs: JobPosting[]
  courseCount: Record<string, number>
  alerts: string[]
}

type InsightDraft = Omit<StrategicInsight, 'id' | 'created_at'>

export async function generateStrategicInsights(
  payload: IntelligencePayload
): Promise<InsightDraft[]> {
  const prompt = `You are a competitive intelligence analyst for Hustle SG, a Singapore training and upskilling company.

Analyze this competitive data and generate exactly 8 strategic insights:
2x threat analysis, 2x opportunity analysis, 2x strategic recommendations, 1x market position summary, 1x growth analysis.

SOCIAL RANKING DATA:
${JSON.stringify(
  payload.socialRanking.map((e) => ({
    name: e.competitor.name,
    is_hustle: e.competitor.is_hustle,
    rank: e.rank,
    total_followers: e.total_followers,
    platforms: Object.fromEntries(
      Object.entries(e.metrics).map(([k, v]) => [
        k,
        v?.followers ?? 'DATA UNAVAILABLE',
      ])
    ),
  })),
  null,
  2
)}

RECENT HIRING ACTIVITY (last 30 days):
${JSON.stringify(payload.recentJobs.slice(0, 20), null, 2)}

COURSE CATALOG SIZE:
${JSON.stringify(payload.courseCount, null, 2)}

RECENT ALERTS:
${payload.alerts.slice(0, 10).join('\n')}

Return a JSON array of insight objects with these fields:
- insight_type: 'threat'|'opportunity'|'recommendation'|'market_position'|'growth_analysis'|'social_insight'|'hiring_intel'|'course_intel'
- title: string (max 80 chars, action-oriented)
- body: string (200-400 words, specific, actionable, data-driven — reference actual numbers from the data provided)
- severity: 'low'|'medium'|'high'|'critical'
- competitor_ids: array of competitor names mentioned (or null)
- model_version: 'gemini-2.5-flash'

Rules:
- Only reference numbers that were actually provided in the data above
- If a metric shows DATA UNAVAILABLE, do not speculate about it
- Be specific about which competitors are referenced
- Focus on actionable intelligence, not generic advice

Only output the JSON array, no other text, no markdown fences.`

  const response = await getClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  })

  const text = response.text ?? '[]'

  let parsed: InsightDraft[]
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${text.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini returned non-array response')
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return parsed.map((insight) => ({
    ...insight,
    competitor_ids: null, // schema column is uuid[]; model emits names — store null until UUID mapping exists
    generated_by: 'gemini',
    model_version: GEMINI_MODEL,
    expires_at: expiresAt,
  }))
}

/**
 * Data passed to {@link generateSeoInsights}. Every field is sourced from the
 * existing internal database (no external SEO/search API). The model is told to
 * reason only from these numbers so it never invents Google rankings.
 */
export interface SeoPayload {
  competitors: { name: string; is_hustle: boolean; total_followers: number }[]
  // Top demand course topics (MySkillsFuture upcoming run counts) per provider.
  demandTopics: { provider: string; course: string; upcoming_runs: number; competitor: string | null }[]
  // Course catalog titles grouped by competitor (content / landing-page gaps).
  competitorCourses: Record<string, string[]>
  // SkillsFuture course categories with aggregate demand (respondents / runs).
  categoryDemand: { category: string; courses: number; respondents: number }[]
  // Recent hiring titles — signal of skills the market is investing in.
  hiringTitles: string[]
}

/** Raw shape the model returns for each SEO insight before mapping to a DB-safe insight_type. */
interface SeoInsightRaw {
  seo_category: SeoCategory
  title: string
  body: string
  severity: AlertSeverity
  competitor_ids: string[] | null
}

export async function generateSeoInsights(payload: SeoPayload): Promise<InsightDraft[]> {
  const prompt = `You are an SEO and content strategist for Hustle SG, a Singapore training and upskilling company.

Using ONLY the internal data below, generate exactly 8 evidence-based SEO intelligence insights:
1x keyword_opportunity, 1x seo_threat, 1x content_opportunity, 1x competitor_search_position,
1x recommended_landing_page, 1x high_demand_topic, 1x missing_content_category, 1x search_growth.

COMPETITORS & AUDIENCE REACH (followers as a proxy for brand search demand):
${JSON.stringify(payload.competitors, null, 2)}

HIGH-DEMAND COURSE TOPICS (MySkillsFuture upcoming run counts — real enrolment demand):
${JSON.stringify(payload.demandTopics.slice(0, 40), null, 2)}

COMPETITOR COURSE CATALOG (titles each competitor already ranks/markets for):
${JSON.stringify(payload.competitorCourses, null, 2)}

COURSE CATEGORY DEMAND (aggregate respondents per SkillsFuture category):
${JSON.stringify(payload.categoryDemand.slice(0, 30), null, 2)}

RECENT HIRING TITLES (skills the market is investing in):
${JSON.stringify(payload.hiringTitles.slice(0, 30), null, 2)}

Return a JSON array of insight objects with these fields:
- seo_category: 'keyword_opportunity'|'seo_threat'|'content_opportunity'|'competitor_search_position'|'recommended_landing_page'|'high_demand_topic'|'missing_content_category'|'search_growth'
- title: string (max 80 chars, action-oriented)
- body: string (150-350 words, specific, actionable — reference actual course titles, run counts, follower numbers, or categories from the data above)
- severity: 'low'|'medium'|'high'|'critical'
- competitor_ids: array of competitor names mentioned (or null)

Rules:
- Only reference course titles, numbers and categories that actually appear in the data above.
- NEVER invent Google search rankings, keyword search volumes, or positions — that data is not provided.
- Frame keyword/content ideas from real high-demand topics and competitor gaps in the data.
- Be specific about which competitors and which course topics are referenced.

Only output the JSON array, no other text, no markdown fences.`

  const response = await getClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: 'application/json' },
  })

  const text = response.text ?? '[]'

  let parsed: SeoInsightRaw[]
  try {
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Failed to parse Gemini response as JSON: ${text.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini returned non-array response')
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return parsed.map((raw) => {
    // Reuse an allowed base insight_type; keep the real SEO category in metadata
    // so the DB CHECK constraint is never violated and the UI can still label it.
    const seoCategory: SeoCategory = SEO_CATEGORY_TO_TYPE[raw.seo_category] ? raw.seo_category : 'keyword_opportunity'
    return {
      insight_type: SEO_CATEGORY_TO_TYPE[seoCategory],
      title: raw.title,
      body: raw.body,
      severity: raw.severity,
      competitor_ids: null, // schema column is uuid[]; model emits names — store null until UUID mapping exists
      generated_by: 'gemini',
      model_version: GEMINI_MODEL,
      expires_at: expiresAt,
      metadata: { seo_category: seoCategory } as InsightDraft['metadata'],
    }
  })
}

/**
 * Stamp a batch of freshly generated insight drafts with a shared Generation
 * Session so each run is grouped and never overwritten. Session metadata is
 * stored in the existing `strategic_insights.metadata` JSONB column (no schema
 * change). Returns the generated session id alongside the stamped drafts.
 */
export function stampInsightsWithSession(
  insights: InsightDraft[],
  opts: { source: GenerationSource; durationMs: number; module?: InsightModule }
): { sessionId: string; generatedAt: string; insights: InsightDraft[] } {
  const sessionId = crypto.randomUUID()
  const generatedAt = new Date().toISOString()
  const stamped = insights.map((insight) => ({
    ...insight,
    metadata: {
      ...insight.metadata, // preserve per-insight fields (e.g. seo_category)
      session_id: sessionId,
      source: opts.source,
      duration_ms: opts.durationMs,
      generated_at: generatedAt,
      model: insight.model_version ?? GEMINI_MODEL,
      insight_count: insights.length,
      module: opts.module ?? 'strategic',
    },
  }))
  return { sessionId, generatedAt, insights: stamped }
}

export async function generateAlertSummary(alerts: string[]): Promise<string> {
  if (alerts.length === 0) return 'No recent alerts to summarize.'

  const response = await getClient().models.generateContent({
    model: GEMINI_MODEL,
    contents: `Summarize these competitive intelligence alerts for Hustle SG in 2-3 sentences. Focus on the most actionable items:

${alerts.join('\n')}

Only output the summary text, no other content.`,
  })

  return response.text ?? ''
}
