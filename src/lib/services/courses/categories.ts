/**
 * Course category clustering — maps raw MySkillsFuture category text and
 * course titles into Hustle's strategic category clusters. Used by course
 * intelligence, opportunity scoring, and the AI payload.
 */

export const CATEGORY_CLUSTERS = [
  'AI / Generative AI',
  'Digital Marketing',
  'Canva / Design',
  'Videography / Photography / Media',
  'Coding / Data / Analytics',
  'Culinary',
  'Business / Productivity',
  'Leadership / Soft Skills',
  'Other',
] as const

export type CategoryCluster = (typeof CATEGORY_CLUSTERS)[number]

const RULES: Array<{ cluster: CategoryCluster; patterns: RegExp[] }> = [
  {
    cluster: 'AI / Generative AI',
    patterns: [/\bai\b/i, /artificial intelligence/i, /gen(erative)?\s*ai/i, /chatgpt/i, /claude/i, /copilot/i, /machine learning/i, /prompt/i, /llm/i],
  },
  {
    cluster: 'Digital Marketing',
    patterns: [/digital marketing/i, /seo\b/i, /social media marketing/i, /google ads/i, /meta ads/i, /facebook ads/i, /content marketing/i, /e-?commerce/i, /tiktok marketing/i, /email marketing/i],
  },
  {
    cluster: 'Canva / Design',
    patterns: [/canva/i, /graphic design/i, /\bdesign\b/i, /illustrator/i, /photoshop/i, /figma/i, /ui\/?ux/i],
  },
  {
    cluster: 'Videography / Photography / Media',
    patterns: [/video/i, /photo/i, /film/i, /premiere/i, /capcut/i, /media production/i, /podcast/i, /drone/i],
  },
  {
    cluster: 'Coding / Data / Analytics',
    patterns: [/python/i, /coding/i, /programming/i, /data analytic/i, /data science/i, /sql/i, /excel/i, /power bi/i, /tableau/i, /web development/i, /javascript/i, /cyber ?security/i, /blockchain/i, /cloud/i],
  },
  {
    cluster: 'Culinary',
    patterns: [/culinary/i, /cooking/i, /baking/i, /food/i, /barista/i, /pastry/i, /cuisine/i],
  },
  {
    cluster: 'Business / Productivity',
    patterns: [/business/i, /productivity/i, /project management/i, /finance/i, /accounting/i, /entrepreneur/i, /sales/i, /admin/i, /notion/i, /operations/i],
  },
  {
    cluster: 'Leadership / Soft Skills',
    patterns: [/leadership/i, /soft skill/i, /communication/i, /presentation/i, /coaching/i, /team/i, /management skill/i, /emotional intelligence/i, /negotiation/i, /people/i],
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
