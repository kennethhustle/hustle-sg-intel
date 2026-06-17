// SkillsFuture scraper v2 — real data only.
// Source: https://www.myskillsfuture.gov.sg/services/tex/individual/course-search
// STRICT DATA RULE: Never return mock/sample data. Return empty array if source unavailable.

const SF_API = 'https://www.myskillsfuture.gov.sg/services/tex/individual/course-search'

export interface SFCourse {
  sfRefNo: string
  title: string
  providerName: string
  category: string
  durationHours: number | null
  fundingStart: string | null
  fundingEnd: string | null
  totalCost: number | null
  popularityScore: number
  respondents: number
  rating: number
  activeRunCount: number
  modeOfTraining: string | null
}

export interface SFScrapeResult {
  courses: SFCourse[]
  sourceUrl: string
  totalFound: number
}

function popScore(respondents: number, rating: number, hasRuns: boolean): number {
  const score = Math.log10(respondents + 1) * 20 + rating * 10 + (hasRuns ? 20 : 0)
  return Math.min(100, Math.round(score * 10) / 10)
}

function parseDoc(doc: Record<string, unknown>): SFCourse | null {
  const refNo = doc['course_ref'] as string || doc['sf_ref_no'] as string
  const title = doc['course_title'] as string || doc['title_name'] as string
  if (!refNo || !title) return null

  const respondents = Number(doc['total_enrolled'] ?? doc['respondents'] ?? 0)
  const rating = Number(doc['average_rating'] ?? doc['rating'] ?? 0)
  const runs = doc['active_run_count'] ?? doc['runs']
  const activeRunCount = Array.isArray(runs) ? runs.length : Number(runs ?? 0)

  return {
    sfRefNo: String(refNo).trim(),
    title: String(title).trim(),
    providerName: String(doc['training_provider_name'] ?? doc['provider_name'] ?? '').trim(),
    category: String(doc['tsg_occupational_category'] ?? doc['category'] ?? '').trim(),
    durationHours: doc['total_training_duration_hour'] != null
      ? Number(doc['total_training_duration_hour'])
      : null,
    fundingStart: doc['funding_validity_start']
      ? String(doc['funding_validity_start'])
      : null,
    fundingEnd: doc['funding_validity_end']
      ? String(doc['funding_validity_end'])
      : null,
    totalCost: doc['total_cost_without_gst'] != null
      ? Number(doc['total_cost_without_gst'])
      : null,
    popularityScore: popScore(respondents, rating, activeRunCount > 0),
    respondents,
    rating,
    activeRunCount,
    modeOfTraining: doc['mode_of_training']
      ? String(doc['mode_of_training'])
      : null,
  }
}

export async function scrapeSkillsFutureV2(
  searchTerm: string,
  pageSize = 100,
): Promise<SFScrapeResult> {
  const params = new URLSearchParams({
    keyword: searchTerm,
    pageIndex: '0',
    pageSize: String(pageSize),
    sortBy: 'relevance',
    filters: JSON.stringify({}),
  })
  const url = `${SF_API}?${params.toString()}`

  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; HustleSGIntel/2.0)',
      'Referer': 'https://www.myskillsfuture.gov.sg/',
    },
    next: { revalidate: 0 },
  })

  if (!res.ok) {
    throw new Error(`SkillsFuture API returned ${res.status}: ${res.statusText}`)
  }

  const json = await res.json() as Record<string, unknown>
  const responseBody = (json['body'] ?? json) as Record<string, unknown>
  const solrResponse = (responseBody['response'] ?? responseBody) as Record<string, unknown>
  const docs = (solrResponse['docs'] ?? responseBody['data'] ?? []) as Record<string, unknown>[]
  const numFound = Number(solrResponse['numFound'] ?? docs.length)

  const courses: SFCourse[] = []
  for (const doc of docs) {
    const course = parseDoc(doc)
    if (course) courses.push(course)
  }

  return { courses, sourceUrl: url, totalFound: numFound }
}
