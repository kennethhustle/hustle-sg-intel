/**
 * Course category clustering — maps raw MySkillsFuture category text and
 * course titles into Hustle's strategic category clusters. Used by course
 * intelligence, opportunity scoring, and the AI payload.
 *
 * Rules are evaluated IN ORDER — more specific clusters must come first
 * (e.g. tool-specific AI courses before the general AI cluster).
 * The category registry is also seeded into the `course_categories` table
 * (migration 011) for transparency; this file is the classification authority.
 */

export const CATEGORY_CLUSTERS = [
  'ChatGPT / Claude / Copilot Tools',
  'AI / Generative AI',
  'Social Media Marketing',
  'Digital Marketing',
  'Canva / Design',
  'Videography / Photography / Content Creation',
  'Cybersecurity',
  'Coding / Data / Analytics',
  'Finance / Accounting',
  'Culinary',
  'Wellness / Lifestyle',
  'Leadership / Management',
  'Communication / Soft Skills',
  'Business Productivity',
  'Other',
] as const

export type CategoryCluster = (typeof CATEGORY_CLUSTERS)[number]

const RULES: Array<{ cluster: CategoryCluster; patterns: RegExp[] }> = [
  {
    cluster: 'ChatGPT / Claude / Copilot Tools',
    patterns: [/chatgpt/i, /\bclaude\b/i, /\bgemini\b/i, /copilot/i, /midjourney/i, /prompt engineering/i],
  },
  {
    cluster: 'AI / Generative AI',
    patterns: [/\bai\b/i, /artificial intelligence/i, /gen(erative)?\s*ai/i, /machine learning/i, /\bllm\b/i, /deep learning/i, /automation with ai/i],
  },
  {
    cluster: 'Social Media Marketing',
    patterns: [/social media/i, /tiktok/i, /instagram/i, /facebook marketing/i, /linkedin marketing/i, /influencer/i, /xiaohongshu/i, /rednote/i],
  },
  {
    cluster: 'Digital Marketing',
    patterns: [/digital marketing/i, /\bseo\b/i, /\bsem\b/i, /google ads/i, /meta ads/i, /content marketing/i, /e-?commerce/i, /email marketing/i, /performance marketing/i, /marketing analytic/i, /branding/i],
  },
  {
    cluster: 'Canva / Design',
    patterns: [/canva/i, /graphic design/i, /illustrator/i, /photoshop/i, /figma/i, /ui\/?ux/i, /\bdesign\b/i],
  },
  {
    cluster: 'Videography / Photography / Content Creation',
    patterns: [/video/i, /photo/i, /film/i, /premiere/i, /capcut/i, /media production/i, /podcast/i, /drone/i, /content creat/i, /youtube/i, /livestream/i],
  },
  {
    cluster: 'Cybersecurity',
    patterns: [/cyber ?security/i, /ethical hack/i, /penetration test/i, /information security/i, /data protection/i, /pdpa/i],
  },
  {
    cluster: 'Coding / Data / Analytics',
    patterns: [/python/i, /coding/i, /programming/i, /data analytic/i, /data science/i, /\bsql\b/i, /excel/i, /power bi/i, /tableau/i, /web development/i, /javascript/i, /blockchain/i, /cloud/i, /\bdata\b/i],
  },
  {
    cluster: 'Finance / Accounting',
    patterns: [/finance/i, /accounting/i, /bookkeep/i, /investment/i, /financial/i, /xero/i, /quickbooks/i, /tax/i],
  },
  {
    cluster: 'Culinary',
    patterns: [/culinary/i, /cooking/i, /baking/i, /\bfood\b/i, /barista/i, /pastry/i, /cuisine/i, /bartend/i],
  },
  {
    cluster: 'Wellness / Lifestyle',
    patterns: [/wellness/i, /yoga/i, /fitness/i, /mindfulness/i, /nutrition/i, /beauty/i, /floristry/i, /lifestyle/i, /craft/i],
  },
  {
    cluster: 'Leadership / Management',
    patterns: [/leadership/i, /management skill/i, /people manage/i, /coaching/i, /team lead/i, /supervis/i, /strategic/i],
  },
  {
    cluster: 'Communication / Soft Skills',
    patterns: [/communication/i, /presentation/i, /public speaking/i, /soft skill/i, /emotional intelligence/i, /negotiation/i, /interpersonal/i, /customer service/i],
  },
  {
    cluster: 'Business Productivity',
    patterns: [/business/i, /productivity/i, /project management/i, /entrepreneur/i, /sales/i, /admin/i, /notion/i, /operations/i, /hr\b/i, /workplace/i],
  },
]

/** Classify a course into a strategic cluster from its title + raw category. */
export function classifyCourse(title: string | null, rawCategory: string | null): CategoryCluster {
  const text = `${title ?? ''} ${rawCategory ?? ''}`
  for (const rule of RULES) {
    if (rule.patterns.some((p) => p.test(text))) return rule.cluster
  }
  return 'Other'
}

/** Legacy cluster names (pre-migration-011) mapped to current ones, so old
 *  DB rows remain groupable until the next refresh reclassifies them. */
export const LEGACY_CLUSTER_MAP: Record<string, CategoryCluster> = {
  'Videography / Photography / Media': 'Videography / Photography / Content Creation',
  'Business / Productivity': 'Business Productivity',
  'Leadership / Soft Skills': 'Leadership / Management',
}

export function normalizeCluster(value: string | null): CategoryCluster {
  if (!value) return 'Other'
  if ((CATEGORY_CLUSTERS as readonly string[]).includes(value)) return value as CategoryCluster
  return LEGACY_CLUSTER_MAP[value] ?? 'Other'
}
