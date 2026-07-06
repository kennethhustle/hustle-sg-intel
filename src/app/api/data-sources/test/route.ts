import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { updateSourceStatus, type SourceStatus } from '@/lib/services/data-sources'

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-20241022'

interface TestOutcome {
  ok: boolean
  status: SourceStatus
  response_time_ms: number
  message: string
  key_configured: boolean | null
}

/** fetch() with an 8s or 10s timeout via AbortController, for lib-target safety. */
function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer))
}

// ─── Per-source test implementations ───────────────────────────────────────

async function testMySkillsFutureApi(): Promise<TestOutcome> {
  const started = Date.now()
  try {
    const query = ['rows=1', 'q=training', 'json.nl=map'].join('&')
    const url = `https://www.myskillsfuture.gov.sg/services/tex/individual/course-search?query=${encodeURIComponent(query)}&jumpstart=true`
    const res = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0 (compatible; HustleSGIntel/3.0)' },
    }, 10_000)
    const responseTime = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: null }
    }
    const json = await res.json() as Record<string, unknown>
    const grouped = (json['grouped'] as Record<string, unknown> | undefined)?.['GroupID']
    if (grouped) {
      return { ok: true, status: 'working', response_time_ms: responseTime, message: 'Course search API responded with grouped results', key_configured: null }
    }
    return { ok: false, status: 'failed', response_time_ms: responseTime, message: 'Response missing expected grouped/docs structure', key_configured: null }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: null }
  }
}

async function testMetaAdLibrary(): Promise<TestOutcome> {
  const started = Date.now()
  const token = process.env.META_AD_LIBRARY_ACCESS_TOKEN
  try {
    const params = new URLSearchParams({
      ad_type: 'ALL',
      ad_reached_countries: 'SG',
      search_terms: 'test',
      fields: 'id',
      limit: '1',
    })
    if (token) params.set('access_token', token)
    const url = `https://graph.facebook.com/v19.0/ads_archive?${params}`
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10_000)
    const responseTime = Date.now() - started
    const json = await res.json().catch(() => ({})) as { error?: { message?: string; code?: number } }

    if (json.error) {
      const msg = (json.error.message ?? '').toLowerCase()
      if (msg.includes('rate') || json.error.code === 4 || json.error.code === 17 || json.error.code === 32) {
        return { ok: false, status: 'partial', response_time_ms: responseTime, message: `Rate-limited by Meta Ad Library: ${json.error.message}`, key_configured: Boolean(token) }
      }
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: json.error.message ?? 'Meta Ad Library returned an error', key_configured: Boolean(token) }
    }
    if (!res.ok) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: Boolean(token) }
    }
    return { ok: true, status: 'working', response_time_ms: responseTime, message: 'Ad Library API responded without error', key_configured: Boolean(token) }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: Boolean(token) }
  }
}

async function testGooglePlaces(): Promise<TestOutcome> {
  const key = process.env.GOOGLE_PLACES_API_KEY
  if (!key) {
    return { ok: false, status: 'not_configured', response_time_ms: 0, message: 'Add GOOGLE_PLACES_API_KEY to enable review tracking', key_configured: false }
  }
  const started = Date.now()
  try {
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${new URLSearchParams({
      input: 'Hustle Singapore training',
      inputtype: 'textquery',
      fields: 'place_id',
      key,
    })}`
    const res = await fetchWithTimeout(url, {}, 10_000)
    const responseTime = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: true }
    }
    const json = await res.json() as { candidates?: unknown[] }
    if (Array.isArray(json.candidates)) {
      return { ok: true, status: 'working', response_time_ms: responseTime, message: 'Places API returned candidates', key_configured: true }
    }
    return { ok: false, status: 'failed', response_time_ms: responseTime, message: 'Response missing candidates array', key_configured: true }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: true }
  }
}

async function testMyCareersFuture(): Promise<TestOutcome> {
  const started = Date.now()
  try {
    const url = 'https://api.mycareersfuture.gov.sg/v2/jobs?search=training&limit=1'
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 10_000)
    const responseTime = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: null }
    }
    const json = await res.json() as { results?: unknown[] }
    if (Array.isArray(json.results)) {
      return { ok: true, status: 'working', response_time_ms: responseTime, message: 'MyCareersFuture API returned results', key_configured: null }
    }
    return { ok: false, status: 'failed', response_time_ms: responseTime, message: 'Response missing results array', key_configured: null }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: null }
  }
}

async function testYoutubeApi(): Promise<TestOutcome> {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) {
    return { ok: false, status: 'not_configured', response_time_ms: 0, message: 'Add YOUTUBE_API_KEY to enable YouTube tracking', key_configured: false }
  }
  const started = Date.now()
  try {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=youtube&key=${apiKey}`
    const res = await fetchWithTimeout(url, {}, 10_000)
    const responseTime = Date.now() - started
    if (!res.ok) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: true }
    }
    const json = await res.json() as { items?: unknown[] }
    if (Array.isArray(json.items)) {
      return { ok: true, status: 'working', response_time_ms: responseTime, message: 'YouTube Data API returned items', key_configured: true }
    }
    return { ok: false, status: 'failed', response_time_ms: responseTime, message: 'Response missing items array', key_configured: true }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: true }
  }
}

async function testClaudeApi(): Promise<TestOutcome> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return { ok: false, status: 'not_configured', response_time_ms: 0, message: 'Add ANTHROPIC_API_KEY to enable AI insights', key_configured: false }
  }
  const started = Date.now()
  try {
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: MODEL,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    })
    return { ok: true, status: 'working', response_time_ms: Date.now() - started, message: 'Claude API responded successfully', key_configured: true }
  } catch (err) {
    const responseTime = Date.now() - started
    const status = (err as { status?: number })?.status
    if (status === 401) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: 'Invalid API key', key_configured: true }
    }
    if (status === 429) {
      return { ok: false, status: 'partial', response_time_ms: responseTime, message: 'Rate limited', key_configured: true }
    }
    return { ok: false, status: 'failed', response_time_ms: responseTime, message: err instanceof Error ? err.message : String(err), key_configured: true }
  }
}

async function testSupabaseCache(): Promise<TestOutcome> {
  const started = Date.now()
  try {
    const supabase = await createServiceClient()
    const { error } = await supabase.from('competitors').select('id', { count: 'exact', head: true })
    const responseTime = Date.now() - started
    if (error) {
      return { ok: false, status: 'failed', response_time_ms: responseTime, message: error.message, key_configured: true }
    }
    return { ok: true, status: 'working', response_time_ms: responseTime, message: 'Supabase query succeeded', key_configured: true }
  } catch (err) {
    return { ok: false, status: 'failed', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: true }
  }
}

// Scraper-type sources: lightweight GET of the target homepage.
const SCRAPER_HOMEPAGES: Record<string, string> = {
  jobstreet_scraper: 'https://www.jobstreet.com.sg',
  indeed_scraper: 'https://sg.indeed.com',
  facebook_scraper: 'https://www.facebook.com',
  instagram_scraper: 'https://www.instagram.com',
  linkedin_scraper: 'https://www.linkedin.com',
  tiktok_scraper: 'https://www.tiktok.com',
  mysf_run_scraper: 'https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory.html',
}

// Sources with no single testable target — best-effort description instead
// of a real network check.
const NO_SINGLE_TARGET: Record<string, string> = {
  career_pages_scraper: 'Not directly testable — target depends on each competitor\'s own career page URL',
  company_courses_scraper: 'Not directly testable — target depends on each competitor\'s own website',
}

async function testScraperHomepage(sourceKey: string): Promise<TestOutcome> {
  const noTargetMessage = NO_SINGLE_TARGET[sourceKey]
  if (noTargetMessage) {
    return { ok: true, status: 'connected', response_time_ms: 0, message: noTargetMessage, key_configured: null }
  }

  const homepage = SCRAPER_HOMEPAGES[sourceKey]
  if (!homepage) {
    return { ok: false, status: 'unavailable', response_time_ms: 0, message: 'No test target configured for this source', key_configured: null }
  }

  const started = Date.now()
  try {
    const res = await fetchWithTimeout(homepage, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }, 8_000)
    const responseTime = Date.now() - started
    if (res.ok) {
      return { ok: true, status: 'connected', response_time_ms: responseTime, message: 'Site reachable — scrape reliability depends on bot detection', key_configured: null }
    }
    if (res.status === 403 || (res.status >= 400 && res.status < 500)) {
      return { ok: false, status: 'unavailable', response_time_ms: responseTime, message: `Site returned HTTP ${res.status} — likely blocked`, key_configured: null }
    }
    return { ok: false, status: 'unavailable', response_time_ms: responseTime, message: `HTTP ${res.status}`, key_configured: null }
  } catch (err) {
    return { ok: false, status: 'unavailable', response_time_ms: Date.now() - started, message: err instanceof Error ? err.message : String(err), key_configured: null }
  }
}

async function testManualSource(sourceKey: string): Promise<TestOutcome> {
  const supabase = await createServiceClient()
  const { data } = await supabase
    .from('data_sources')
    .select('status')
    .eq('source_key', sourceKey)
    .single()

  const currentStatus = (data?.status as SourceStatus | undefined) ?? 'manual_only'
  return { ok: true, status: currentStatus, response_time_ms: 0, message: 'Manual source — nothing to test', key_configured: null }
}

async function testSeoRankApi(): Promise<TestOutcome> {
  return { ok: false, status: 'not_configured', response_time_ms: 0, message: 'Not connected', key_configured: false }
}

// ─── Dispatcher ─────────────────────────────────────────────────────────────

async function runTest(sourceKey: string): Promise<TestOutcome> {
  switch (sourceKey) {
    case 'myskillsfuture_api':
      return testMySkillsFutureApi()
    case 'meta_ad_library':
      return testMetaAdLibrary()
    case 'google_places':
      return testGooglePlaces()
    case 'mycareersfuture_api':
      return testMyCareersFuture()
    case 'youtube_api':
      return testYoutubeApi()
    case 'claude_api':
      return testClaudeApi()
    case 'supabase_cache':
      return testSupabaseCache()
    case 'jobstreet_scraper':
    case 'indeed_scraper':
    case 'facebook_scraper':
    case 'instagram_scraper':
    case 'linkedin_scraper':
    case 'tiktok_scraper':
    case 'mysf_run_scraper':
    case 'career_pages_scraper':
    case 'company_courses_scraper':
      return testScraperHomepage(sourceKey)
    case 'google_ads_transparency':
    case 'seo_manual_snapshot':
    case 'social_manual':
      return testManualSource(sourceKey)
    case 'seo_rank_api':
      return testSeoRankApi()
    default:
      throw new Error(`Unknown source_key: ${sourceKey}`)
  }
}

/**
 * POST /api/data-sources/test — admin-only. Runs a lightweight connectivity
 * check for a single source and persists the outcome to data_sources.
 * Never logs or returns raw key values — only presence booleans.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (!userData || userData.role !== 'admin') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }

  let sourceKey: string
  try {
    const body = await request.json() as { source_key?: string }
    if (!body.source_key) {
      return NextResponse.json({ error: 'invalid_body', message: 'source_key is required.' }, { status: 400 })
    }
    sourceKey = body.source_key
  } catch {
    return NextResponse.json({ error: 'invalid_body', message: 'Request body must be valid JSON.' }, { status: 400 })
  }

  let outcome: TestOutcome
  try {
    outcome = await runTest(sourceKey)
  } catch (err) {
    return NextResponse.json(
      { error: 'test_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    )
  }

  // Persist the outcome — manual/static/not_configured sources are reported
  // as-is (no last_success/last_failed churn); everything else records a
  // success or failure timestamp alongside the status and response time.
  const now = new Date().toISOString()
  if (outcome.status === 'manual_only' || outcome.status === 'static_only' || outcome.status === 'not_configured') {
    await updateSourceStatus(sourceKey, {
      status: outcome.status,
      last_checked_at: now,
      last_response_time_ms: outcome.response_time_ms || undefined,
    })
  } else if (outcome.ok) {
    await updateSourceStatus(sourceKey, {
      status: outcome.status,
      last_success_at: now,
      last_checked_at: now,
      last_response_time_ms: outcome.response_time_ms,
      error_message: null,
    })
  } else {
    await updateSourceStatus(sourceKey, {
      status: outcome.status,
      last_failed_at: now,
      last_checked_at: now,
      last_response_time_ms: outcome.response_time_ms,
      error_message: outcome.message.slice(0, 500),
    })
  }

  return NextResponse.json({
    source_key: sourceKey,
    ok: outcome.ok,
    status: outcome.status,
    response_time_ms: outcome.response_time_ms,
    message: outcome.message,
    key_configured: outcome.key_configured,
  })
}
