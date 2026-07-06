import Anthropic from '@anthropic-ai/sdk'
import { z } from 'zod'
import type { IntelligencePayload } from '@/lib/services/ai/payload'
import type { OpportunityScore } from '@/lib/services/scoring/opportunity'
import { CATEGORY_CLUSTERS } from '@/lib/services/courses/categories'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

/**
 * Model selection: defaults to 'claude-3-5-sonnet-20241022'. Override via the
 * ANTHROPIC_MODEL env var (e.g. to point at a newer Claude model) without a
 * code change/redeploy.
 */
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'

export const ALLOWED_INSIGHT_TYPES = [
  'threat',
  'opportunity',
  'defensive_action',
  'course_launch_idea',
  'seo_opportunity',
  'marketing_opportunity',
  'hiring_signal',
  'market_shift',
] as const

const ALLOWED_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const
const ALLOWED_CONFIDENCE = ['low', 'medium', 'high'] as const
const ALLOWED_OWNERS = ['Marketing', 'Course Development', 'Sales', 'Management'] as const
const ALLOWED_TIMEFRAMES = ['Immediate', 'This week', 'This month', 'Monitor'] as const

const insightSchema = z.object({
  insight_type: z.enum(ALLOWED_INSIGHT_TYPES),
  title: z.string().max(80),
  body: z.string(),
  severity: z.enum(ALLOWED_SEVERITIES),
  confidence: z.enum(ALLOWED_CONFIDENCE),
  evidence: z.array(z.string()).min(2).max(5),
  recommended_action: z.string(),
  suggested_owner: z.enum(ALLOWED_OWNERS),
  timeframe: z.enum(ALLOWED_TIMEFRAMES),
  related_categories: z.array(z.string()),
  data_sources: z.array(z.string()),
  competitor_names: z.array(z.string()).nullable().optional(),
  opportunity_score: z.number().nullable().optional(),
})

const insightsArraySchema = z.array(insightSchema).min(1).max(8)

export type ValidatedInsight = z.infer<typeof insightSchema>

/**
 * DB row shape for strategic_insights. Note: the `competitor_ids` column in
 * the database is UUID[], but Claude can only reliably reference competitors
 * by name (it never sees UUIDs). We store the resolved UUIDs here when a
 * name match is found against the payload's competitor overview; unmatched
 * or absent names resolve to null. `metadata` carries the raw competitor
 * names Claude returned for traceability even where a UUID match fails.
 */
export interface StrategicInsightRow {
  insight_type: (typeof ALLOWED_INSIGHT_TYPES)[number]
  title: string
  body: string
  severity: (typeof ALLOWED_SEVERITIES)[number]
  confidence: (typeof ALLOWED_CONFIDENCE)[number]
  evidence: string[]
  recommended_action: string
  suggested_owner: (typeof ALLOWED_OWNERS)[number]
  timeframe: (typeof ALLOWED_TIMEFRAMES)[number]
  related_categories: string[]
  data_sources: string[]
  competitor_ids: string[] | null
  opportunity_score: number | null
  generated_by: string
  model_version: string
  created_at?: string
  expires_at: string
  metadata: Record<string, unknown> | null
}

function buildPrompt(
  payload: IntelligencePayload,
  topOpportunityScores: OpportunityScore[] | undefined,
  extraInstruction?: string
): string {
  const opportunitySection =
    topOpportunityScores && topOpportunityScores.length > 0
      ? `TOP OPPORTUNITY SCORES (rule-based, pre-computed — you may reference these and optionally set opportunity_score on a related insight to the matching total_score):
${JSON.stringify(
  topOpportunityScores.map((s) => ({
    category: s.category,
    demand_score: s.demand_score,
    competition_gap_score: s.competition_gap_score,
    hustle_fit_score: s.hustle_fit_score,
    urgency_score: s.urgency_score,
    total_score: s.total_score,
    evidence: s.evidence,
  })),
  null,
  2
)}`
      : 'TOP OPPORTUNITY SCORES: none computed this run.'

  return `You are a competitive intelligence analyst for Hustle SG, an adult training and upskilling company operating in the Singapore SkillsFuture market.

Analyze the competitive intelligence data below and generate BETWEEN 3 AND 8 strategic insights — only generate as many as the data honestly supports. Do not pad the output with generic or speculative insights just to reach a higher count.

COMPETITOR OVERVIEW:
${JSON.stringify(
  payload.competitorOverview.map(({ name, tier, website, is_hustle, top_category_clusters }) => ({
    name,
    tier,
    website,
    is_hustle,
    top_category_clusters,
  })),
  null,
  2
)}

COURSE INTELLIGENCE:
${JSON.stringify(payload.courseIntel, null, 2)}

MARKETING INTELLIGENCE (google_ads figures are MANUAL ESTIMATES — always caveat them explicitly when referenced):
${JSON.stringify(payload.marketingIntel, null, 2)}

SEO INTELLIGENCE:
${payload.seoIntel.available ? JSON.stringify(payload.seoIntel, null, 2) : 'SEO data not available.'}

HIRING INTELLIGENCE:
${JSON.stringify(payload.hiringIntel, null, 2)}

SOCIAL INTELLIGENCE (${payload.socialIntel.platforms_not_available_note}):
${JSON.stringify(payload.socialIntel.competitors, null, 2)}

RECENT ALERTS AND DATA REFRESH ISSUES:
${JSON.stringify(payload.alertsAndChanges, null, 2)}

DATA FRESHNESS BY MODULE:
${JSON.stringify(payload.dataFreshness, null, 2)}

DATA SOURCE OPERATIONAL STATUS (you are given the operational status of every data source — see rules below):
${JSON.stringify(payload.sourceStatus, null, 2)}

DATA INTENTIONALLY WEAK OR ABSENT RIGHT NOW (excluded/limited data — do not fill these gaps with speculation):
${JSON.stringify(payload.excludedData, null, 2)}

${opportunitySection}

TITLES ALREADY USED IN THE LAST 3 DAYS (do NOT repeat or closely rephrase any of these):
${JSON.stringify(payload.recentInsightTitles, null, 2)}

Return a JSON array of insight objects. Each object must have exactly these fields:
- insight_type: one of ${JSON.stringify(ALLOWED_INSIGHT_TYPES)}
- title: string, max 80 characters, action-oriented
- body: string, 100-250 words, MUST cite actual numbers from the data above
- severity: one of ${JSON.stringify(ALLOWED_SEVERITIES)}
- confidence: one of ${JSON.stringify(ALLOWED_CONFIDENCE)} — reflect the quality/staleness/completeness of the underlying data AND the reliability of the data sources backing this insight (per DATA SOURCE OPERATIONAL STATUS above): insights built on high-reliability, working sources should be 'high' confidence; insights leaning on medium-reliability, partial, or manual/static sources should be 'medium' at best; insights that can only be supported by low-reliability or stale sources should be 'low'
- evidence: array of 2-5 short bullet strings, each citing a specific data point (a number, a name, a date)
- recommended_action: string, 1-2 sentences, concrete and specific
- suggested_owner: one of ${JSON.stringify(ALLOWED_OWNERS)}
- timeframe: one of ${JSON.stringify(ALLOWED_TIMEFRAMES)}
- related_categories: array of strings, each one of ${JSON.stringify(CATEGORY_CLUSTERS)}
- data_sources: array of short strings identifying which data this insight drew on, e.g. ["myskillsfuture","meta_ad_library","google_reviews","job_postings","seo_manual_snapshot"]
- competitor_names: array of competitor NAMES (as they appear in COMPETITOR OVERVIEW above) mentioned in this insight, or null if none apply
- opportunity_score: a number matching one of the TOP OPPORTUNITY SCORES total_score values if this insight relates to that category, otherwise null

Strict rules:
- Never speculate about any metric that is marked unavailable, null, or absent in the data above (e.g. if SEO data is not available, do not generate an seo_opportunity insight).
- Be explicit in the body/evidence when data is stale (check DATA FRESHNESS) or manually sourced (e.g. Google Ads, SEO snapshot, verified_manual social entries) — use phrases like "manual estimate as of [date]" or "verified manually on [date]".
- Google Ads figures are manual estimates, not live data — always caveat them when cited.
- Social data is YouTube-only unless a specific entry has a verified manual source — do not claim Instagram/TikTok/Facebook figures unless present in the SOCIAL INTELLIGENCE data.
- Do NOT repeat any title (or a close rephrasing of one) from the TITLES ALREADY USED list above.
- Only reference competitors, numbers, and categories that actually appear in the data provided.
- Focus on actionable, specific intelligence — not generic advice.

You are given the operational status of every data source (see DATA SOURCE OPERATIONAL STATUS above). Rules for using it:
- Never make claims based on sources marked unavailable, failed, or not_configured.
- Treat manual and static_snapshot data as point-in-time estimates and say so explicitly when citing them (e.g. "as of [date]", "manually verified on [date]").
- Prioritise insights backed by high-reliability, working sources.
- Use low-reliability data only as supporting context, not as the sole basis for an insight.
- If the data backing a potential insight is stale (is_stale: true), either lower that insight's confidence to 'low' or skip the insight entirely.
- Explicitly mention data limitations in the body where relevant, especially for anything listed under DATA INTENTIONALLY WEAK OR ABSENT RIGHT NOW.

${extraInstruction ?? ''}

Only output the JSON array, no other text, no markdown fences, no commentary.`
}

function extractJsonArray(text: string): unknown {
  const cleaned = text
    .replace(/^```(?:json)?\n?/m, '')
    .replace(/\n?```$/m, '')
    .trim()
  return JSON.parse(cleaned)
}

async function callClaude(prompt: string): Promise<string> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  return response.content[0].type === 'text' ? response.content[0].text : '[]'
}

/**
 * Generate strategic insights from the intelligence payload. Optionally pass
 * the current top opportunity scores so Claude can reference/anchor to them.
 *
 * Validates Claude's JSON response with zod. On validation failure, retries
 * once with an appended "Return ONLY valid JSON array" instruction; throws
 * if the retry also fails.
 */
export async function generateStrategicInsights(
  payload: IntelligencePayload,
  topOpportunityScores?: OpportunityScore[]
): Promise<StrategicInsightRow[]> {
  const prompt = buildPrompt(payload, topOpportunityScores)

  let rawText = await callClaude(prompt)
  let parsedJson: unknown
  let parseFailed = false
  try {
    parsedJson = extractJsonArray(rawText)
  } catch {
    parseFailed = true
  }

  let result = !parseFailed ? insightsArraySchema.safeParse(parsedJson) : insightsArraySchema.safeParse(undefined)

  if (!result.success) {
    const retryPrompt = buildPrompt(payload, topOpportunityScores, 'Return ONLY valid JSON array')
    rawText = await callClaude(retryPrompt)
    try {
      parsedJson = extractJsonArray(rawText)
    } catch {
      throw new Error(`Failed to parse Claude response as JSON after retry: ${rawText.substring(0, 200)}`)
    }
    result = insightsArraySchema.safeParse(parsedJson)
    if (!result.success) {
      throw new Error(`Claude response failed schema validation after retry: ${result.error.message}`)
    }
  }

  const validated: ValidatedInsight[] = result.data
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const competitorByName = new Map(
    (payload.competitorOverview ?? []).map((c) => [c.name.toLowerCase(), c] as const)
  )

  return validated.map((insight) => {
    const names = insight.competitor_names ?? []
    const matchedIds = names
      .map((name) => competitorByName.get(name.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id))

    return {
      insight_type: insight.insight_type,
      title: insight.title,
      body: insight.body,
      severity: insight.severity,
      confidence: insight.confidence,
      evidence: insight.evidence,
      recommended_action: insight.recommended_action,
      suggested_owner: insight.suggested_owner,
      timeframe: insight.timeframe,
      related_categories: insight.related_categories,
      data_sources: insight.data_sources,
      // strategic_insights.competitor_ids is UUID[] in the DB. We resolve
      // Claude's returned competitor names against payload.competitorOverview
      // (which carries ids) to populate real UUIDs; unmatched names are
      // dropped from the column but preserved verbatim in metadata.
      competitor_ids: matchedIds.length > 0 ? matchedIds : null,
      opportunity_score: insight.opportunity_score ?? null,
      generated_by: 'claude',
      model_version: MODEL,
      expires_at: expiresAt,
      metadata: names.length > 0 ? { competitor_names: names } : null,
    }
  })
}

/** Kept for potential future use (alert digest summaries) — not wired into any route currently. */
export async function generateAlertSummary(alerts: string[]): Promise<string> {
  if (alerts.length === 0) return 'No recent alerts to summarize.'

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Summarize these competitive intelligence alerts for Hustle SG in 2-3 sentences. Focus on the most actionable items:

${alerts.join('\n')}

Only output the summary text, no other content.`,
      },
    ],
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
}
