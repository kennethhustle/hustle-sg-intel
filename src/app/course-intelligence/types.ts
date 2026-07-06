/**
 * Re-exports of the course-intelligence backend contract types
 * (src/lib/services/courses/intelligence.ts) plus a couple of small
 * UI-local helper types. Prefer importing types directly from the backend
 * module so shapes never drift from the real implementation.
 */
export type {
  CourseMarketSnapshot,
  CourseRowDto,
  ProviderLeaderboardEntry,
  CategoryIntelligenceEntry,
  HustleGapAnalysis,
  CourseChangeRow,
} from '@/lib/services/courses/intelligence'

export interface AiInsightRow {
  id: string
  insight_type: string
  title: string
  body: string | null
  severity: string | null
  confidence: string | null
  evidence: string[]
  recommended_action: string | null
  suggested_owner: string | null
  timeframe: string | null
  related_categories: string[]
  data_sources: string[]
  created_at: string
}

/** Safely normalize an `unknown` JSONB breakdown field (array or object) into rows for display. */
export function breakdownEntries(b: unknown): { factor: string; value: string }[] {
  if (!b) return []
  if (Array.isArray(b)) {
    return b.map((row) => {
      if (row && typeof row === 'object') {
        const r = row as Record<string, unknown>
        const factor = String(r.factor ?? r.name ?? '')
        const value = r.score !== undefined ? `${r.input ?? ''} → ${r.score}` : String(r.value ?? r.input ?? '')
        return { factor, value }
      }
      return { factor: '', value: String(row) }
    })
  }
  if (typeof b === 'object') {
    return Object.entries(b as Record<string, unknown>).map(([factor, value]) => {
      if (value && typeof value === 'object') {
        const v = value as Record<string, unknown>
        const parts: string[] = []
        if (v.input !== undefined) parts.push(String(v.input))
        if (v.score !== undefined) parts.push(`score ${v.score}`)
        else if (v.normalized !== undefined) parts.push(`norm ${v.normalized}`)
        return { factor, value: parts.length > 0 ? parts.join(' · ') : JSON.stringify(value) }
      }
      return { factor, value: String(value) }
    })
  }
  return []
}

/** Safely normalize an `unknown` JSONB evidence field into a string array. */
export function evidenceList(e: unknown): string[] {
  if (!e) return []
  if (Array.isArray(e)) return e.map((x) => String(x))
  return []
}
