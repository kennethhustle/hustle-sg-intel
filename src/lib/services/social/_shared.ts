/**
 * Shared helpers for fixed-permalink social profile scraping.
 *
 * These scrapers visit the EXACT profile URL stored in `social_profiles`
 * (the 10 fixed competitors) using the existing Puppeteer browser service,
 * then extract publicly-visible follower/subscriber counts. No fabrication:
 * if a count cannot be found the caller returns `unavailable` cleanly.
 */
import { withBrowser } from '@/lib/services/scraper/browser'

export interface PageContent {
  /** Full rendered HTML (page.content()) */
  html: string
  /** <title> text */
  title: string
  /** meta[name=description] (falls back to og:description) */
  metaDescription: string
  /** meta[property=og:title] */
  ogTitle: string
  /** meta[property=og:description] */
  ogDescription: string
  /** document.body.innerText, capped */
  bodyText: string
}

/**
 * Loads the exact URL in a real (headless) browser, waits for the page to
 * settle, and returns the rendered HTML plus the most useful text signals.
 *
 * Client-rendered sites (Instagram) put the rounded `og:description` in the
 * static SSR <head> (available immediately) but only expose the precise
 * follower data — embedded `follower_count` JSON and the visible "30.7K" body
 * header — AFTER React hydrates. Reading after a fixed delay therefore often
 * captures only the rounded meta value. Pass `waitUntilReady` to poll the page
 * until the precise data has hydrated (or `settleMs` elapses) before capturing.
 */
export async function loadPageContent(
  url: string,
  opts: {
    waitMs?: number
    timeoutMs?: number
    /**
     * Hydration gate. When provided, after navigation the page is polled every
     * `pollMs` until this predicate returns true or `settleMs` elapses, instead
     * of using the fixed `waitMs`. Receives lightweight html/bodyText snapshots.
     */
    waitUntilReady?: (snap: { html: string; bodyText: string }) => boolean
    /** Max time to spend polling for `waitUntilReady`. Default 18s. */
    settleMs?: number
    /** Poll interval for `waitUntilReady`. Default 600ms. */
    pollMs?: number
  } = {}
): Promise<PageContent> {
  const {
    waitMs = 3500,
    timeoutMs = 20_000,
    waitUntilReady,
    settleMs = 18_000,
    pollMs = 600,
  } = opts

  const readBodyText = (page: import('puppeteer-core').Page) =>
    page.evaluate(() => (document.body?.innerText || '').slice(0, 20_000))

  return withBrowser(async (page) => {
    page.setDefaultNavigationTimeout(timeoutMs)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    } catch (err) {
      // Sites with persistent / streaming connections (notably TikTok) keep the
      // navigation "pending" past the timeout even though the DOM and the
      // embedded JSON are already available. Swallow pure timeouts and read
      // whatever loaded; re-throw anything else (DNS failure, crash, etc.).
      const msg = err instanceof Error ? err.message : String(err)
      if (!/timeout/i.test(msg)) throw err
    }

    if (waitUntilReady) {
      // Hydration-gated wait: poll until the precise data has rendered. A gentle
      // scroll nudges Instagram into hydrating the profile header.
      const deadline = Date.now() + settleMs
      await page.evaluate(() => window.scrollBy(0, 800)).catch(() => {})
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const [html, bodyText] = await Promise.all([
          page.content(),
          readBodyText(page),
        ])
        if (waitUntilReady({ html, bodyText }) || Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, pollMs))
        await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {})
      }
    } else {
      // Give client-rendered content a moment to populate.
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }

    const html = await page.content()
    const title = await page.title()

    const meta = await page.evaluate(() => {
      const attr = (sel: string) =>
        (document.querySelector(sel) as HTMLMetaElement | null)?.content || ''
      return {
        metaDescription:
          attr('meta[name="description"]') ||
          attr('meta[property="og:description"]'),
        ogTitle: attr('meta[property="og:title"]'),
        ogDescription: attr('meta[property="og:description"]'),
        bodyText: (document.body?.innerText || '').slice(0, 20_000),
      }
    })

    return { html, title, ...meta }
  })
}

/**
 * Parses a human-readable count into an integer.
 *   "1.2K"   -> 1200
 *   "15,891" -> 15891
 *   "2M"     -> 2000000
 *   "1.5B"   -> 1500000000
 *   12345    -> 12345
 * Returns null when nothing numeric can be parsed.
 */
export function parseCount(
  raw: string | number | null | undefined
): number | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? Math.round(raw) : null
  }

  const s = raw.trim().toLowerCase().replace(/,/g, '')
  if (!s) return null

  const m = s.match(/^([\d]+(?:\.\d+)?)\s*([kmb])?/)
  if (!m) return null

  const num = parseFloat(m[1])
  if (!Number.isFinite(num)) return null

  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1
  return Math.round(num * mult)
}

/**
 * Context-aware extraction: finds a count value adjacent to a keyword such as
 * "followers", "subscribers" or "likes". Looks for the number both BEFORE the
 * keyword ("1.2K followers") and AFTER it ("followers 1,234").
 */
export function findCountByKeyword(
  text: string,
  keywords: string[]
): number | null {
  if (!text) return null

  for (const kw of keywords) {
    // number BEFORE keyword: "30.4K followers"
    const before = new RegExp(
      `([\\d][\\d.,]*\\s*[kmb]?)\\s*${kw}`,
      'i'
    ).exec(text)
    if (before) {
      const v = parseCount(before[1])
      if (v !== null) return v
    }

    // number AFTER keyword: "followers: 12,345"
    const after = new RegExp(
      `${kw}[^\\d]{0,15}([\\d][\\d.,]*\\s*[kmb]?)`,
      'i'
    ).exec(text)
    if (after) {
      const v = parseCount(after[1])
      if (v !== null) return v
    }
  }

  return null
}

/**
 * Extracts a numeric value from embedded JSON / script data, e.g.
 * `"followerCount":12345` or `"edge_followed_by":{"count":12345}`.
 */
export function extractJsonNumber(
  html: string,
  keys: string[]
): number | null {
  if (!html) return null

  for (const key of keys) {
    // "key": 12345  |  "key": "12345"
    const direct = new RegExp(`"${key}"\\s*:\\s*"?(\\d+)"?`, 'i').exec(html)
    if (direct) {
      const v = parseInt(direct[1], 10)
      if (Number.isFinite(v) && v > 0) return v
    }

    // "key":{"count":12345}
    const nested = new RegExp(
      `"${key}"\\s*:\\s*\\{[^}]*?"count"\\s*:\\s*(\\d+)`,
      'i'
    ).exec(html)
    if (nested) {
      const v = parseInt(nested[1], 10)
      if (Number.isFinite(v) && v > 0) return v
    }
  }

  return null
}

/**
 * Extracts the EXACT follower integer from a rendered Instagram profile page.
 *
 * Instagram never renders the precise count as visible text for large accounts:
 * the body header shows the ROUNDED "30.7K" and the og:description shows the even
 * rounder "31K". The exact integer (e.g. 30707) is only available from:
 *   1. Embedded JSON — `"follower_count":30707` / `"edge_followed_by":{"count":30707}`.
 *   2. The DOM `title` attribute on the followers control — Instagram stores the
 *      full number there (`title="30,707"`) while *displaying* "30.7K".
 * Small accounts (< 10k) render the full integer as visible text, but those are
 * handled by the caller's exact-body path; this helper covers the abbreviated case.
 *
 * Returns the exact integer, or null when the page was not hydrated (login wall /
 * throttled variant) so the caller can RETRY rather than store an approximation.
 */
export function extractExactFollowersFromHtml(html: string): number | null {
  if (!html) return null

  // 1) Embedded JSON — authoritative exact integer.
  const json = extractJsonNumber(html, [
    'follower_count',
    'edge_followed_by',
    'followerCount',
  ])
  if (json !== null) return json

  // 2) DOM title attribute anchored to the /followers/ control. The title holds
  //    the exact integer ("30,707") even when the visible text is "30.7K".
  const afterHref =
    /href="[^"]*\/followers\/?"[\s\S]{0,400}?title="([\d,]+)"/i.exec(html)
  if (afterHref) {
    const v = parseInt(afterHref[1].replace(/,/g, ''), 10)
    if (Number.isFinite(v) && v > 0) return v
  }

  // 3) Title attribute immediately preceding the "followers" label.
  const beforeLabel =
    /title="([\d,]+)"[\s\S]{0,200}?followers/i.exec(html)
  if (beforeLabel) {
    const v = parseInt(beforeLabel[1].replace(/,/g, ''), 10)
    if (Number.isFinite(v) && v > 0) return v
  }

  return null
}

/**
 * Explicit confidence ranking for a follower-count source. HIGHER always wins,
 * regardless of the order candidates are passed to {@link pickPreciseCount} /
 * {@link pickPreciseDetailed}. Selection no longer relies on argument order.
 *
 * Verified by live trace of @thehustlesg: the og/meta description ROUNDS
 * ("31K Followers" → 31000) while the visible body header is finer
 * ("30.7K" → 30700) and embedded JSON is exact ("follower_count":30702).
 *
 *   json (3) — authoritative exact integer from embedded JSON ("follower_count":30702)
 *   body (2) — visible page header, finer than meta ("30.7K")
 *   meta (1) — og:description / meta tag, which is ROUNDED ("31K")
 */
export const SOURCE_CONFIDENCE = {
  json: 3,
  body: 2,
  meta: 1,
} as const

/** Maps a numeric {@link SOURCE_CONFIDENCE} score to the `data_confidence`
 *  text label stored on `social_snapshots` (json→high, body→medium, meta→low). */
export function confidenceLabel(score: number): 'high' | 'medium' | 'low' {
  if (score >= SOURCE_CONFIDENCE.json) return 'high'
  if (score >= SOURCE_CONFIDENCE.body) return 'medium'
  return 'low'
}

/** Inverse of {@link confidenceLabel}: derives a numeric score from a stored
 *  `data_confidence` label so persistence can gate overwrites. Unknown/null → 0. */
export function confidenceFromLabel(label: string | null | undefined): number {
  switch (label) {
    case 'high':
      return SOURCE_CONFIDENCE.json
    case 'medium':
      return SOURCE_CONFIDENCE.body
    case 'low':
      return SOURCE_CONFIDENCE.meta
    default:
      return 0
  }
}

/**
 * A parsed count together with whether it was an EXACT raw integer and the
 * confidence of the source it came from. `exact === false` means the source
 * only gave an abbreviated value ("31K", "1.2M"); `confidence` ranks the source
 * (see {@link SOURCE_CONFIDENCE}).
 */
export interface CountResult {
  value: number
  exact: boolean
  confidence: number
}

function toCountResult(token: string, confidence: number): CountResult | null {
  const trimmed = token.trim()
  const value = parseCount(trimmed)
  if (value === null) return null
  // Abbreviated tokens carry a K/M/B suffix → not precise to the unit.
  return { value, exact: !/[kmb]/i.test(trimmed), confidence }
}

/**
 * Like {@link findCountByKeyword} but also reports whether the matched token
 * was an exact raw integer ("7,024") or an abbreviated value ("31K"), tagged
 * with the confidence of the source the `text` came from.
 */
export function findCountDetailed(
  text: string,
  keywords: string[],
  confidence: number = SOURCE_CONFIDENCE.body
): CountResult | null {
  if (!text) return null

  for (const kw of keywords) {
    const before = new RegExp(
      `([\\d][\\d.,]*\\s*[kmb]?)\\s*${kw}`,
      'i'
    ).exec(text)
    if (before) {
      const r = toCountResult(before[1], confidence)
      if (r) return r
    }

    const after = new RegExp(
      `${kw}[^\\d]{0,15}([\\d][\\d.,]*\\s*[kmb]?)`,
      'i'
    ).exec(text)
    if (after) {
      const r = toCountResult(after[1], confidence)
      if (r) return r
    }
  }

  return null
}

/** Wraps a known-exact integer (e.g. from embedded JSON) as a CountResult. */
export function exactCount(
  value: number | null | undefined,
  confidence: number = SOURCE_CONFIDENCE.json
): CountResult | null {
  return value === null || value === undefined
    ? null
    : { value, exact: true, confidence }
}

/**
 * Picks the highest-confidence count from the candidates.
 *
 * Selection is driven by an EXPLICIT confidence ranking, not argument order:
 *  1. Highest {@link SOURCE_CONFIDENCE} wins (json > body > meta).
 *  2. Tiebreak: an exact raw integer beats an abbreviated value.
 *  3. Tiebreak: the earlier candidate wins (stable).
 *
 * This guarantees the authoritative JSON integer is always preferred, the
 * finer body value is preferred over the rounded meta/og description, and a
 * 1-follower change is captured whenever an exact value is exposed.
 */
function selectByConfidence(
  candidates: (CountResult | null)[]
): CountResult | null {
  const present = candidates.filter((c): c is CountResult => c !== null)
  if (present.length === 0) return null
  return present.reduce((best, c) => {
    if (c.confidence !== best.confidence) return c.confidence > best.confidence ? c : best
    if (c.exact !== best.exact) return c.exact ? c : best
    return best
  })
}

export function pickPreciseCount(
  ...candidates: (CountResult | null)[]
): number | null {
  return selectByConfidence(candidates)?.value ?? null
}

/**
 * Like {@link pickPreciseCount} but returns the full {@link CountResult} so the
 * caller can tell whether the value is an exact raw integer. Used by scrapers
 * that retry the page load until an exact (non-abbreviated) value is found.
 */
export function pickPreciseDetailed(
  ...candidates: (CountResult | null)[]
): CountResult | null {
  return selectByConfidence(candidates)
}
