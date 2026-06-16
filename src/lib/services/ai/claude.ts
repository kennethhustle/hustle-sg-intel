import Anthropic from '@anthropic-ai/sdk'
import type { StrategicInsight, SocialRankingEntry, JobPosting } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

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
- model_version: 'claude-3-5-sonnet-20241022'

Rules:
- Only reference numbers that were actually provided in the data above
- If a metric shows DATA UNAVAILABLE, do not speculate about it
- Be specific about which competitors are referenced
- Focus on actionable intelligence, not generic advice

Only output the JSON array, no other text, no markdown fences.`

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  })

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '[]'

  let parsed: InsightDraft[]
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim()
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`Failed to parse Claude response as JSON: ${text.substring(0, 200)}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Claude returned non-array response')
  }

  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  return parsed.map((insight) => ({
    ...insight,
    generated_by: 'claude',
    expires_at: expiresAt,
  }))
}

export async function generateAlertSummary(alerts: string[]): Promise<string> {
  if (alerts.length === 0) return 'No recent alerts to summarize.'

  const response = await client.messages.create({
    model: 'claude-3-5-sonnet-20241022',
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
