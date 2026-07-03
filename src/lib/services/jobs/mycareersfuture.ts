import type { ScraperResult } from '@/lib/types'
import { companyMatches } from '@/lib/services/jobs/employer'

interface MCFJob {
  title: string
  department: string | null
  location: string | null
  job_type: string | null
  source: string
  source_url: string | null
  posted_at: string | null
  salary_min: number | null
  salary_max: number | null
  currency: string
  raw_data: Record<string, unknown>
}

interface MCFAPIResponse {
  total: number
  results: MCFAPIJob[]
}

interface MCFAPIJob {
  uuid: string
  title: string
  postedDate: string
  expiryDate: string
  salary: {
    minimum: number
    maximum: number
    type: string
    currency: string
  }
  company: {
    name: string
    registrationNumber: string
  }
  // Actual employer on MyCareersFuture v2. `postedCompany` is the advertiser;
  // `hiringCompany` is populated for agency-posted roles. Used for employer
  // validation so unrelated companies are never attributed to a competitor.
  postedCompany?: {
    name?: string
  }
  hiringCompany?: {
    name?: string
  }
  metadata: {
    newPostingDate: string
    originalPostingDate: string
  }
  categories: Array<{
    code: string
    description: string
  }>
  positionLevels: Array<{
    code: string
    description: string
  }>
  employmentTypes: Array<{
    code: string
    description: string
  }>
  workplaceArrangements: Array<{
    code: string
    description: string
  }>
  address: {
    building: string
    street: string
    city: string
    country: string
    postalCode: string
  }
}

// Some competitors are indexed on MyCareersFuture under a fuller legal name
// than the internal display name (e.g. "Skills Dev Academy" is listed as
// "Skills Development Academy"). The alias affects ONLY the search keyword;
// companyMatches still validates against the real competitor name, so employer
// matching behaviour is unchanged. Keyed by the competitor's display name.
const MCF_SEARCH_ALIASES: Record<string, string> = {
  'Skills Dev Academy': 'Skills Development Academy',
}

export async function scrapeMyCareersFuture(
  companyName: string
): Promise<ScraperResult<MCFJob[]>> {
  const scraped_at = new Date().toISOString()
  const searchTerm = MCF_SEARCH_ALIASES[companyName] ?? companyName
  if (searchTerm !== companyName) {
    console.log(
      `[MyCareersFuture] Using search alias "${searchTerm}" for competitor "${companyName}"`
    )
  }
  const encodedName = encodeURIComponent(searchTerm)
  const url = `https://api.mycareersfuture.gov.sg/v2/jobs?search=${encodedName}&limit=20&sortBy=new_posting_date`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      throw new Error(`MCF API HTTP ${res.status}: ${res.statusText}`)
    }

    const data: MCFAPIResponse = await res.json()

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error('MCF API returned unexpected response format')
    }

    // Fail closed: keep only postings whose employer positively matches the
    // competitor. Missing/unverifiable employer ⇒ discarded.
    const fetched = data.results
    const validated = fetched.filter((job) =>
      companyMatches(
        companyName,
        job.postedCompany?.name ?? job.hiringCompany?.name ?? null
      )
    )
    const rejected = fetched.length - validated.length
    console.log(
      `[MyCareersFuture]\nCompetitor: ${companyName}\n\n` +
        `Fetched: ${fetched.length}\nValidated: ${validated.length}\nRejected: ${rejected}` +
        (rejected > 0 ? `\n\nReason:\nEmployer mismatch` : '')
    )

    const jobs: MCFJob[] = validated.map((job: MCFAPIJob) => ({
      title: job.title,
      department:
        job.categories?.map((c) => c.description).join(', ') || null,
      location:
        job.address?.city ||
        job.address?.street ||
        'Singapore',
      job_type:
        job.employmentTypes?.map((e) => e.description).join(', ') || null,
      source: 'mycareersfuture',
      source_url: `https://www.mycareersfuture.gov.sg/job/${job.uuid}`,
      posted_at:
        job.metadata?.newPostingDate ||
        job.metadata?.originalPostingDate ||
        job.postedDate ||
        null,
      salary_min: job.salary?.minimum || null,
      salary_max: job.salary?.maximum || null,
      currency: job.salary?.currency || 'SGD',
      raw_data: job as unknown as Record<string, unknown>,
    }))

    return {
      success: true,
      data: jobs,
      error: null,
      scraped_at,
      source: url,
    }
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
