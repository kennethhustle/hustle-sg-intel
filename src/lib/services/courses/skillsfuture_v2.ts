// SkillsFuture scraper v3 — provider-specific filter + pagination.
// Uses the Solr {!tag=TP_ALIAS_Suggest} localparams API discovered from the SkillsFuture website.
//
// Grouped response structure:
//   grouped.GroupID.groups[]        → one entry per unique course
//     .doclist.numFound             → total number of course runs for this course
//     .doclist.docs[0]              → first course run doc (carries course metadata)
//     .doclist.docs[0].Course_Quality_NumberOfRespondents → "Number Attended" on SF website
//
const SF_API = 'https://www.myskillsfuture.gov.sg/services/tex/individual/course-search'
const PAGE_SIZE = 24 // server-enforced maximum per page (= groups per page)

export interface SFCourse {
  sfRefNo: string
  title: string
  providerName: string
  category: string
  totalCost: number | null
  popularityScore: number
  respondents: number       // = "Number Attended" shown on MySkillsFuture course page
  rating: number
  hasActiveRuns: boolean
  modeOfTraining: string | null
  upcomingRunCount: number  // = doclist.numFound per group = scheduled course runs
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

function parseDoc(doc: Record<string, unknown>, runCount: number): SFCourse | null {
  const sfRefNo = String(doc['Course_Ref_No'] ?? '').trim()
  if (!sfRefNo) return null
  const title = String(doc['Course_Title'] ?? '').trim()
  const providerName = String(doc['TP_ALIAS'] ?? doc['Organisation_Name'] ?? '').trim()
  const categoryArr = doc['Area_of_Training_text'] as string[] | undefined
  const category = categoryArr?.[0] ?? ''
  const respondents = Number(doc['Course_Quality_NumberOfRespondents'] ?? 0)
  const rating = Number(doc['Course_Quality_Stars_Rating'] ?? 0)
  const hasRuns = Boolean(doc['HasCourseRun'])
  const totalCost = doc['Tol_Cost_of_Trn_Per_Trainee'] != null
    ? Number(doc['Tol_Cost_of_Trn_Per_Trainee']) : null
  const modeArr = doc['Mode_of_Training_text'] as string[] | undefined
  const modeOfTraining = modeArr?.[0] ?? null
  return {
    sfRefNo, title, providerName, category,
    totalCost, popularityScore: popScore(respondents, rating, hasRuns),
    respondents, rating, hasActiveRuns: hasRuns, modeOfTraining,
    upcomingRunCount: runCount,
  }
}

function buildSolrQuery(tpAliasName: string, start: number): string {
  const today = new Date().toISOString().split('T')[0] + 'T00:00:00Z'
  return [
    `rows=${PAGE_SIZE}`,
    `start=${start}`,
    'facet=true',
    'facet.mincount=1',
    'json.nl=map',
    'facet.field={!ex=TP_ALIAS_Suggest}TP_ALIAS_Suggest',
    'q=*:*',
    `fq=Course_Supp_Period_To_1:[${today} TO *]`,
    'fq=IsValid:true',
    `fq={!tag=TP_ALIAS_Suggest}TP_ALIAS_Suggest:("${tpAliasName}")`,
    'filtersearch=TP_ALIAS_Suggest:',
  ].join('&')
}

export async function scrapeSkillsFutureByProvider(
  tpAliasName: string,
  maxCourses = 300,
): Promise<SFScrapeResult> {
  const allCourses: SFCourse[] = []
  let start = 0
  let totalFound = 0
  const sourceUrl = `${SF_API}?provider=${encodeURIComponent(tpAliasName)}`

  do {
    const query = buildSolrQuery(tpAliasName, start)
    const url = `${SF_API}?query=${encodeURIComponent(query)}&jumpstart=true`
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www.myskillsfuture.gov.sg/',
        'User-Agent': 'Mozilla/5.0 (compatible; HustleSGIntel/3.0)',
      },
      next: { revalidate: 0 },
    })
    if (!res.ok) throw new Error(`SkillsFuture API returned ${res.status}: ${res.statusText}`)
    const json = await res.json() as Record<string, unknown>
    const grouped = (json['grouped'] as Record<string, unknown> | undefined)?.['GroupID'] as Record<string, unknown> | undefined
    const groups = (grouped?.['groups'] as Array<Record<string, unknown>> | undefined) ?? []
    totalFound = Number(grouped?.['ngroups'] ?? 0)

    for (const group of groups) {
      const doclist = group['doclist'] as Record<string, unknown> | undefined
      // doclist.numFound = total run count for this course (from Solr grouped response)
      const runCount = Number(doclist?.['numFound'] ?? 0)
      const docs = (doclist?.['docs'] as Array<Record<string, unknown>> | undefined) ?? []
      if (docs.length > 0) {
        const course = parseDoc(docs[0], runCount)
        if (course) allCourses.push(course)
      }
    }

    start += PAGE_SIZE
    if (start < totalFound && allCourses.length < maxCourses) {
      await new Promise<void>(r => setTimeout(r, 300))
    }
  } while (start < totalFound && allCourses.length < maxCourses)

  return { courses: allCourses, sourceUrl, totalFound }
}

// Legacy export for backward compatibility
export const scrapeSkillsFutureV2 = scrapeSkillsFutureByProvider
