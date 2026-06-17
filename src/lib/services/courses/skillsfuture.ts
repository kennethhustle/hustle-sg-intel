import type { ScraperResult } from '@/lib/types'

interface SkillsFutureCourse {
  title: string
  category: string | null
  sub_category: string | null
  price: number | null
  currency: string
  duration_hours: number | null
  is_skillsfuture_claimable: boolean
  skillsfuture_credit: number | null
  source: string
  source_url: string | null
  raw_data: Record<string, unknown>
}

interface SFDoc {
  Course_Title: string
  Course_Ref_No: string
  Course_Funding: string | string[] | null
  Tol_Cost_of_Trn_Per_Trainee: number | null
  Area_of_Training: string[] | null
  Organisation_Name: string | null
  TP_ALIAS: string | null
  Mode_of_Training_text: string | null
  EXT_Course_Ref_No?: string
}

export async function scrapeSkillsFuture(
  companyName: string
): Promise<ScraperResult<SkillsFutureCourse[]>> {
  const scraped_at = new Date().toISOString()
  const today = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')

  // Use the correct portal search endpoint (same one the browser uses)
  const solrQuery = [
    'rows=100',
    'fq=IsValid:true',
    `fq=Course_Supp_Period_To_1:[${today} TO *]`,
    `q=${encodeURIComponent(companyName)}`,
  ].join('&')

  const url = `https://www.myskillsfuture.gov.sg/services/tex/individual/course-search?query=${encodeURIComponent(solrQuery)}&jumpstart=true&client_id=944a4464-b321-4751-9020-ed87393cb465`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://www.myskillsfuture.gov.sg/',
      },
      next: { revalidate: 0 },
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      throw new Error(`SkillsFuture API HTTP ${res.status}: ${res.statusText}`)
    }

    const data = await res.json()
    return processPortalResponse(data, companyName, url, scraped_at)
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err instanceof Error ? err.message : String(err),
      scraped_at,
      source: url,
    }
  }
}

function processPortalResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  companyName: string,
  url: string,
  scraped_at: string
): ScraperResult<SkillsFutureCourse[]> {
  // Response is grouped by GroupID (course run groups)
  const groups: Array<{ doclist: { docs: SFDoc[] } }> =
    data?.grouped?.GroupID?.groups || []

  if (groups.length === 0) {
    return { success: true, data: [], error: null, scraped_at, source: url }
  }

  const nameUpper = companyName.toUpperCase()
  const nameWords = nameUpper.split(/\s+/).filter((w) => w.length > 2)
  const seen = new Set<string>()
  const courses: SkillsFutureCourse[] = []

  for (const group of groups) {
    const doc: SFDoc = group.doclist?.docs?.[0]
    if (!doc) continue

    // Filter to match this training provider
    const providerName = (doc.Organisation_Name || doc.TP_ALIAS || '').toUpperCase()
    const matches = nameWords.some((word) => providerName.includes(word))
    if (!matches) continue

    const ref = doc.Course_Ref_No
    if (!ref || seen.has(ref)) continue
    seen.add(ref)

    const funding = Array.isArray(doc.Course_Funding)
      ? doc.Course_Funding
      : doc.Course_Funding
      ? [doc.Course_Funding]
      : []
    const isSFC = funding.some((f) => f.toUpperCase().includes('SFC'))

    courses.push({
      title: doc.Course_Title || '',
      category: doc.Area_of_Training?.[0] ?? null,
      sub_category: null,
      price: doc.Tol_Cost_of_Trn_Per_Trainee ?? null,
      currency: 'SGD',
      duration_hours: null,
      is_skillsfuture_claimable: isSFC,
      skillsfuture_credit: isSFC ? 1 : null, // presence flag; exact amount not in this API
      source: 'skillsfuture',
      source_url: `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${ref}`,
      raw_data: doc as unknown as Record<string, unknown>,
    })
  }

  return {
    success: true,
    data: courses,
    error: null,
    scraped_at,
    source: url,
  }
}
