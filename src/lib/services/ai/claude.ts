import { GoogleGenAI } from '@google/genai'
import type { StrategicInsight, SocialRankingEntry, JobPosting } from '@/lib/types'

const GEMINI_MODEL = 'gemini-2.5-flash'

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
