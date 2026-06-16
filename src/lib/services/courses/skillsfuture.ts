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

interface SFAPIResponse {
  data: {
    courses: SFAPICourse[]
    total: number
  }
}

interface SFAPICourse {
  courseReferenceNumber: string
  title: string
  trainingProviderAlias: string
  category: {
    description: string
  }
  subCategory: {
    description: string
  }
  totalTrainingDuration: number
  totalTrainingDurationUOM: string
  totalCostOfTrainingPerTrainee: number
  sfcFunding: {
    maxSfcFunding: number
    minSfcFunding: number
  }
  courseStatus: string
  url: string
}

export async function scrapeSkillsFuture(
  companyName: string
): Promise<ScraperResult<SkillsFutureCourse[]>> {
  const scraped_at = new Date().toISOString()
  const encodedName = encodeURIComponent(companyName)
  const url = `https://api.myskillsfuture.gov.sg/individual/api/course/partner/search?keyword=${encodedName}&pageSize=20&pageIndex=0`

  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'X-API-KEY': 'mysf-anonymous',
      },
      next: { revalidate: 0 },
    })

    if (!res.ok) {
      // Try alternate endpoint
      const altUrl = `https://api.myskillsfuture.gov.sg/individual/api/course/search?keyword=${encodedName}&pageSize=20&pageIndex=0`
      const altRes = await fetch(altUrl, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        },
        next: { revalidate: 0 },
      })
      if (!altRes.ok) {
        throw new Error(`SkillsFuture API HTTP ${res.status}: ${res.statusText}`)
      }
      const altData = await altRes.json()
      return processSFResponse(altData, companyName, url, scraped_at)
    }

    const data: SFAPIResponse = await res.json()
    return processSFResponse(data, companyName, url, scraped_at)
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

function processSFResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any,
  companyName: string,
  url: string,
  scraped_at: string
): ScraperResult<SkillsFutureCourse[]> {
  const courses: SkillsFutureCourse[] = []
  const rawCourses: SFAPICourse[] =
    data?.data?.courses ||
    data?.courses ||
    data?.data ||
    []

  if (!Array.isArray(rawCourses)) {
    return {
      success: true,
      data: [],
      error: null,
      scraped_at,
      source: url,
    }
  }

  for (const course of rawCourses) {
    // Filter to only include courses from this training provider
    const providerName = (course.trainingProviderAlias || '').toLowerCase()
    const searchName = companyName.toLowerCase()
    const nameWords = searchName.split(' ').filter((w) => w.length > 2)
    const matchesProvider = nameWords.some((word) => providerName.includes(word))
    if (!matchesProvider && rawCourses.length > 5) continue

    // Convert duration to hours
    let durationHours: number | null = null
    if (course.totalTrainingDuration) {
      const uom = (course.totalTrainingDurationUOM || '').toLowerCase()
      if (uom.includes('hour')) {
        durationHours = course.totalTrainingDuration
      } else if (uom.includes('day')) {
        durationHours = course.totalTrainingDuration * 8
      } else if (uom.includes('minute')) {
        durationHours = Math.round(course.totalTrainingDuration / 60)
      }
    }

    const sfcMax = course.sfcFunding?.maxSfcFunding || null
    const isSFClaimable = sfcMax !== null && sfcMax > 0

    courses.push({
      title: course.title || '',
      category: course.category?.description || null,
      sub_category: course.subCategory?.description || null,
      price: course.totalCostOfTrainingPerTrainee || null,
      currency: 'SGD',
      duration_hours: durationHours,
      is_skillsfuture_claimable: isSFClaimable,
      skillsfuture_credit: sfcMax,
      source: 'skillsfuture',
      source_url: course.url
        ? `https://www.myskillsfuture.gov.sg/content/portal/en/training-exchange/course-directory/course-detail.html?courseReferenceNumber=${course.courseReferenceNumber}`
        : null,
      raw_data: course as unknown as Record<string, unknown>,
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
