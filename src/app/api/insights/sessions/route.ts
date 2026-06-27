import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { GenerationSession, GenerationSource, InsightMetadata } from '@/lib/types'

/**
 * List AI Generation Sessions, derived by grouping strategic_insights on the
 * session_id stamped into their metadata. Each session reports generated_at,
 * model, duration, source and insight count. Rows from before this feature
 * (no session metadata) are bucketed by minute and labelled "legacy" so no
 * past run is hidden. Previous runs are never overwritten.
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { searchParams } = new URL(request.url)
  const limit = parseInt(searchParams.get('limit') ?? '2000', 10)
  const isSeo = searchParams.get('module') === 'seo'

  let rowsQuery = supabase
    .from('strategic_insights')
    .select('insight_type, model_version, generated_by, created_at, metadata')
    .order('created_at', { ascending: false })
    .limit(limit)

  // Keep SEO and strategic generation histories isolated. SEO rows are tagged
  // metadata.module = 'seo'; everything else (incl. legacy rows) is strategic.
  rowsQuery = isSeo
    ? rowsQuery.filter('metadata->>module', 'eq', 'seo')
    : rowsQuery.or('metadata->>module.is.null,metadata->>module.neq.seo')

  const { data: rows, error } = await rowsQuery

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const groups = new Map<string, GenerationSession>()

  for (const row of rows ?? []) {
    const meta = (row.metadata ?? null) as Partial<InsightMetadata> | null
    const sessionId = meta?.session_id ?? `legacy:${String(row.created_at).slice(0, 16)}`

    let session = groups.get(sessionId)
    if (!session) {
      session = {
        session_id: sessionId,
        generated_at: meta?.generated_at ?? row.created_at,
        model: meta?.model ?? row.model_version ?? row.generated_by ?? null,
        duration_ms: meta?.duration_ms ?? null,
        source: (meta?.source ?? 'legacy') as GenerationSource,
        insight_count: 0,
        types: {},
      }
      groups.set(sessionId, session)
    }

    session.insight_count += 1
    session.types[row.insight_type] = (session.types[row.insight_type] ?? 0) + 1
    // Keep the earliest created_at as the session timestamp when none stamped.
    if (!meta?.generated_at && row.created_at < session.generated_at) {
      session.generated_at = row.created_at
    }
  }

  const sessions = Array.from(groups.values()).sort((a, b) =>
    b.generated_at.localeCompare(a.generated_at)
  )

  return NextResponse.json({ data: sessions })
}
