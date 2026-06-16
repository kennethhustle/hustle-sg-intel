import type { ScraperResult } from '@/lib/types'

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

export async function scrapeMyCareersFuture(
  companyName: string
): Promise<ScraperResult<MCFJob[]>> {
  const scraped_at = new Date().toISOString()
  const encodedName = encodeURIComponent(companyName)
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

    const jobs: MCFJob[] = data.results.map((job: MCFAPIJob) => ({
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
