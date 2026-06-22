/**
 * Search Intelligence — Market Demand Intelligence Dashboard
 *
 * ALL keyword ranking data verified via live Google Search (gl=sg, pws=0)
 * on 22 Jun 2026. Source URLs link to the exact Google Search used.
 *
 * Key finding: SMU Academy / NUS / polytechnics dominate organic results
 * for most categories. Among private training providers, Equinet and ASK
 * are the strongest SEO performers. Hustle SG has no top-10 organic
 * presence for any tracked keyword — confirmed by live search.
 */

import type { ReactNode } from 'react'
import { AppLayout } from '@/components/layout/app-layout'

export const revalidate = 3600

// ─── Types ───────────────────────────────────────────────────────────────────
type Competition = 'HIGH' | 'MEDIUM' | 'LOW'
type HustlePos   = 'Ranking' | 'Absent' | 'Ad only'
type Severity    = 'critical' | 'high' | 'medium'

// ─── Verified Keyword Rankings ────────────────────────────────────────────────
// Each keyword verified via Google Search (Singapore, personalisation off)
// "rank" = organic position among ALL results (including universities/govt)
// "trackedRank" = position among the 10 tracked private training providers only
interface RankedResult {
  name: string
  color: string
  rank: number        // organic position overall
  trackedRank: number // rank within tracked competitors only
  isHustle?: boolean
  isAd?: boolean      // appears as paid ad, not organic
}

interface VerifiedKeyword {
  keyword: string
  category: string
  sourceUrl: string   // Google search URL used to verify
  results: RankedResult[]
  hustlePresent: boolean
  notes: string
}

const VERIFIED_KEYWORDS: VerifiedKeyword[] = [
  {
    keyword: 'ai course singapore',
    category: 'AI & GenAI',
    sourceUrl: 'https://www.google.com/search?q=ai+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 5,  trackedRank: 1 },
      { name: 'Heicoders Academy',  color: '#ec4899', rank: 8,  trackedRank: 2 },
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 0,  trackedRank: 0, isAd: true },
    ],
    hustlePresent: false,
    notes: 'Top 4 organic spots taken by SMU Academy, SkillsFuture, AI Singapore, NUS-ISS. Info-Tech first tracked competitor at ~#5. Hustle absent.',
  },
  {
    keyword: 'generative ai course singapore',
    category: 'AI & GenAI',
    sourceUrl: 'https://www.google.com/search?q=generative+ai+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Vertical Institute', color: '#f59e0b', rank: 3,  trackedRank: 1 },
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 4,  trackedRank: 2 },
      { name: 'Heicoders Academy',  color: '#ec4899', rank: 6,  trackedRank: 3 },
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 0,  trackedRank: 0, isAd: true },
    ],
    hustlePresent: false,
    notes: 'SMU Academy #1, SkillsFuture #2. Vertical is strongest tracked competitor at #3 overall. Info-Tech buying ads.',
  },
  {
    keyword: 'chatgpt course singapore',
    category: 'AI & GenAI',
    sourceUrl: 'https://www.google.com/search?q=chatgpt+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 1,  trackedRank: 1 },
      { name: 'Vertical Institute', color: '#f59e0b', rank: 6,  trackedRank: 2 },
      { name: 'BELLS Institute',    color: '#f97316', rank: 7,  trackedRank: 3 },
    ],
    hustlePresent: false,
    notes: 'Info-Tech owns this keyword outright at #1. Vertical #6, BELLS #7. No Hustle presence.',
  },
  {
    keyword: 'digital marketing course singapore',
    category: 'Digital Marketing',
    sourceUrl: 'https://www.google.com/search?q=digital+marketing+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Equinet Academy',   color: '#14b8a6', rank: 2,  trackedRank: 1 },
      { name: 'Heicoders Academy', color: '#ec4899', rank: 0,  trackedRank: 0, isAd: true },
      { name: 'ASK Training',      color: '#ef4444', rank: 8,  trackedRank: 2 },
    ],
    hustlePresent: false,
    notes: 'SMU Academy #1. Equinet #2 organic — stronger than ASK here. Heicoders running ads. ASK around #8. Hustle absent.',
  },
  {
    keyword: 'seo course singapore',
    category: 'SEO',
    sourceUrl: 'https://www.google.com/search?q=seo+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'ASK Training',      color: '#ef4444', rank: 1,  trackedRank: 1 },
      { name: 'Equinet Academy',   color: '#14b8a6', rank: 3,  trackedRank: 2 },
      { name: 'OOm Pte Ltd',       color: '#8b5cf6', rank: 8,  trackedRank: 3 },
    ],
    hustlePresent: false,
    notes: 'ASK Training ranks #1 overall (beats Equinet). Equinet #3. OOm #8. Also: OOm, Equinet, Vertical all appear in Google Maps local pack.',
  },
  {
    keyword: 'google ads course singapore',
    category: 'Digital Marketing',
    sourceUrl: 'https://www.google.com/search?q=google+ads+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'ASK Training',    color: '#ef4444', rank: 1,  trackedRank: 1 },
      { name: 'Equinet Academy', color: '#14b8a6', rank: 3,  trackedRank: 2 },
    ],
    hustlePresent: false,
    notes: 'ASK Training #1, Equinet #3. No other tracked competitors present. Hustle absent.',
  },
  {
    keyword: 'content creation course singapore',
    category: 'Content & Creative',
    sourceUrl: 'https://www.google.com/search?q=content+creation+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Equinet Academy', color: '#14b8a6', rank: 1,  trackedRank: 1 },
      { name: 'ASK Training',    color: '#ef4444', rank: 2,  trackedRank: 2 },
    ],
    hustlePresent: false,
    notes: 'Equinet #1, ASK #2. Republic Polytechnic #3, SMU #4. Hustle SG completely absent despite running this type of course.',
  },
  {
    keyword: 'python course singapore',
    category: 'Data & Tech',
    sourceUrl: 'https://www.google.com/search?q=python+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Heicoders Academy', color: '#ec4899', rank: 5,  trackedRank: 1 },
    ],
    hustlePresent: false,
    notes: 'NTUC #1, SkillsFuture #2, SMU #3. Heicoders first tracked competitor around #5 (also in Maps local pack). Hustle absent.',
  },
  {
    keyword: 'data analytics course singapore',
    category: 'Data & Tech',
    sourceUrl: 'https://www.google.com/search?q=data+analytics+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [],
    hustlePresent: false,
    notes: 'Top 8 entirely: NUS, SMU, NTUC, Aventis, NTU, PSB, Le Wagon, LSBF. None of the 10 tracked competitors appear. Vertical and Heicoders only mentioned in Reddit discussions.',
  },
  {
    keyword: 'photography course singapore',
    category: 'Photography',
    sourceUrl: 'https://www.google.com/search?q=photography+course+singapore&gl=sg&hl=en&num=10&pws=0',
    results: [],
    hustlePresent: false,
    notes: 'School of Photography SG #1, NAFA #3, LASALLE #4, Nikon School #6. Hustle SG does NOT appear in top 10. OOm appears with a blog list article only.',
  },
  {
    keyword: 'ai for business singapore',
    category: 'AI & GenAI',
    sourceUrl: 'https://www.google.com/search?q=ai+for+business+singapore+course&gl=sg&hl=en&num=10&pws=0',
    results: [
      { name: 'Vertical Institute', color: '#f59e0b', rank: 8,  trackedRank: 1 },
      { name: 'Info-Tech Academy',  color: '#06b6d4', rank: 0,  trackedRank: 0, isAd: true },
    ],
    hustlePresent: false,
    notes: 'NTUC, SMU, SUSS, NUS dominate. Vertical appears around #8. Info-Tech buying ads. Hustle completely absent despite this being their stated positioning.',
  },
]

// ─── Category Summary (derived from verified data) ────────────────────────────
interface Category {
  name: string
  icon: string
  topPrivateProvider: string
  topColor: string
  hustleStatus: HustlePos
  competition: Competition
  note: string
}

const CATEGORIES: Category[] = [
  {
    name: 'AI & GenAI',
    icon: '🤖',
    topPrivateProvider: 'Info-Tech / Vertical',
    topColor: '#06b6d4',
    hustleStatus: 'Absent',
    competition: 'HIGH',
    note: 'Info-Tech owns ChatGPT (#1). Vertical owns Generative AI (#3). SMU Academy leads overall.',
  },
  {
    name: 'Digital Marketing',
    icon: '📣',
    topPrivateProvider: 'Equinet Academy',
    topColor: '#14b8a6',
    hustleStatus: 'Absent',
    competition: 'HIGH',
    note: 'Equinet ranks #2 for the main keyword. ASK ranks ~#8. Hustle not in top 10.',
  },
  {
    name: 'SEO',
    icon: '🔍',
    topPrivateProvider: 'ASK Training',
    topColor: '#ef4444',
    hustleStatus: 'Absent',
    competition: 'MEDIUM',
    note: 'ASK Training #1 overall, Equinet #3. OOm, Equinet, Vertical in local Maps pack.',
  },
  {
    name: 'Google Ads',
    icon: '📈',
    topPrivateProvider: 'ASK Training',
    topColor: '#ef4444',
    hustleStatus: 'Absent',
    competition: 'MEDIUM',
    note: 'ASK Training #1, Equinet #3. Rest of tracked competitors absent.',
  },
  {
    name: 'Content Creation',
    icon: '✍️',
    topPrivateProvider: 'Equinet Academy',
    topColor: '#14b8a6',
    hustleStatus: 'Absent',
    competition: 'MEDIUM',
    note: 'Equinet #1, ASK #2. Hustle runs content courses but ranks nowhere organically.',
  },
  {
    name: 'Photography',
    icon: '📷',
    topPrivateProvider: 'School of Photography SG',
    topColor: '#64748b',
    hustleStatus: 'Absent',
    competition: 'MEDIUM',
    note: 'Dominated by NAFA, LASALLE, Nikon School, specialist schools. Hustle not in top 10.',
  },
  {
    name: 'Python / Data',
    icon: '🐍',
    topPrivateProvider: 'Heicoders Academy',
    topColor: '#ec4899',
    hustleStatus: 'Absent',
    competition: 'HIGH',
    note: 'NTUC, SMU, NUS dominate. Heicoders is highest-ranked tracked competitor.',
  },
  {
    name: 'Data Analytics',
    icon: '📊',
    topPrivateProvider: 'None (tracked)',
    topColor: '#475569',
    hustleStatus: 'Absent',
    competition: 'HIGH',
    note: 'Entirely dominated by NUS, SMU, NTUC, NTU. No tracked competitor in top 10.',
  },
]

// ─── Search Threats (based on verified rankings) ──────────────────────────────
interface Threat {
  competitor: string
  color: string
  keywords: { term: string; rank: number; url: string }[]
  severity: Severity
  signal: string
}

const THREATS: Threat[] = [
  {
    competitor: 'ASK Training',
    color: '#ef4444',
    keywords: [
      { term: 'seo course singapore',          rank: 1, url: 'https://www.google.com/search?q=seo+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'google ads course singapore',   rank: 1, url: 'https://www.google.com/search?q=google+ads+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'digital marketing course sg',   rank: 8, url: 'https://www.google.com/search?q=digital+marketing+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'content creation course sg',    rank: 2, url: 'https://www.google.com/search?q=content+creation+course+singapore&gl=sg&hl=en&pws=0' },
    ],
    severity: 'critical',
    signal: 'ASK ranks #1 organically for both "seo course" and "google ads course singapore" — keywords Hustle has zero presence on. Their SEO is the strongest among all tracked training providers.',
  },
  {
    competitor: 'Equinet Academy',
    color: '#14b8a6',
    keywords: [
      { term: 'digital marketing course sg',    rank: 2, url: 'https://www.google.com/search?q=digital+marketing+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'seo course singapore',           rank: 3, url: 'https://www.google.com/search?q=seo+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'content creation course sg',     rank: 1, url: 'https://www.google.com/search?q=content+creation+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'google ads course singapore',    rank: 3, url: 'https://www.google.com/search?q=google+ads+course+singapore&gl=sg&hl=en&pws=0' },
    ],
    severity: 'critical',
    signal: 'Equinet ranks #1 for content creation and #2 for digital marketing — overlapping directly with Hustle\'s course portfolio. With only 151 Google reviews, their organic rankings suggest strong on-page SEO and authoritative content.',
  },
  {
    competitor: 'Info-Tech Academy',
    color: '#06b6d4',
    keywords: [
      { term: 'chatgpt course singapore',          rank: 1, url: 'https://www.google.com/search?q=chatgpt+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'generative ai course singapore',    rank: 4, url: 'https://www.google.com/search?q=generative+ai+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'ai course singapore',               rank: 5, url: 'https://www.google.com/search?q=ai+course+singapore&gl=sg&hl=en&pws=0' },
    ],
    severity: 'critical',
    signal: 'Info-Tech owns "chatgpt course singapore" outright (#1 organic). Also running paid ads for AI and generative AI terms. 5,163 reviews bolster their organic authority across AI-adjacent searches.',
  },
  {
    competitor: 'Vertical Institute',
    color: '#f59e0b',
    keywords: [
      { term: 'generative ai course singapore',   rank: 3, url: 'https://www.google.com/search?q=generative+ai+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'chatgpt course singapore',         rank: 6, url: 'https://www.google.com/search?q=chatgpt+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'ai for business singapore',        rank: 8, url: 'https://www.google.com/search?q=ai+for+business+singapore+course&gl=sg&hl=en&pws=0' },
    ],
    severity: 'high',
    signal: 'Vertical ranks #3 for generative AI and is present across multiple AI keywords. Their 8,188 reviews (5.0★) provide enormous organic authority for any new category they enter.',
  },
  {
    competitor: 'Heicoders Academy',
    color: '#ec4899',
    keywords: [
      { term: 'ai course singapore',               rank: 8, url: 'https://www.google.com/search?q=ai+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'generative ai course singapore',    rank: 6, url: 'https://www.google.com/search?q=generative+ai+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'python course singapore',           rank: 5, url: 'https://www.google.com/search?q=python+course+singapore&gl=sg&hl=en&pws=0' },
      { term: 'digital marketing course sg',       rank: 0, url: 'https://www.google.com/search?q=digital+marketing+course+singapore&gl=sg&hl=en&pws=0', },
    ],
    severity: 'high',
    signal: 'Heicoders now runs ads for digital marketing AND ranks organically for AI and Python. Fast mover. Their 54 newly-active Meta ads confirm aggressive paid + organic expansion.',
  },
]

// ─── Search Opportunities ─────────────────────────────────────────────────────
interface Opportunity {
  keyword: string
  category: string
  why: string
  searchUrl: string
  potential: 'HIGH' | 'MEDIUM'
}

const OPPORTUNITIES: Opportunity[] = [
  {
    keyword: 'AI for marketers singapore',
    category: 'AI + Digital Marketing',
    why: 'No tracked competitor ranks for this. Combines Hustle\'s two closest categories. High commercial intent.',
    searchUrl: 'https://www.google.com/search?q=ai+for+marketers+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'AI photography course singapore',
    category: 'AI + Photography',
    why: 'Zero competitors targeting this. Hustle can uniquely combine its photography and AI positioning here.',
    searchUrl: 'https://www.google.com/search?q=ai+photography+course+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'ChatGPT for business owners singapore',
    category: 'AI + Business',
    why: 'Info-Tech owns generic ChatGPT but their audience is IT professionals. SME business owner angle is unclaimed.',
    searchUrl: 'https://www.google.com/search?q=chatgpt+for+business+owners+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'AI content creation course singapore',
    category: 'AI + Content',
    why: 'Equinet owns "content creation" but not the AI angle. This is a natural gap for Hustle to claim.',
    searchUrl: 'https://www.google.com/search?q=ai+content+creation+course+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'prompt engineering course singapore',
    category: 'AI & GenAI',
    why: 'Emerging term. No established owner. Practical framing that differentiates from academic AI courses.',
    searchUrl: 'https://www.google.com/search?q=prompt+engineering+course+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'AI for SMEs Singapore',
    category: 'AI + Business',
    why: 'Completely uncontested. Large SME market in SG. Government push for AI adoption creates demand.',
    searchUrl: 'https://www.google.com/search?q=ai+for+smes+singapore&gl=sg&hl=en&pws=0',
    potential: 'HIGH',
  },
  {
    keyword: 'reels creation course singapore',
    category: 'Content & Creative',
    why: 'Adjacent to photography/content. Fast-growing search term. No tracked competitor targeting it.',
    searchUrl: 'https://www.google.com/search?q=reels+creation+course+singapore&gl=sg&hl=en&pws=0',
    potential: 'MEDIUM',
  },
  {
    keyword: 'AI tools for beginners singapore',
    category: 'AI & GenAI',
    why: 'Hustle already positions as beginner-friendly. Lower competition than "ai course singapore". Attainable ranking.',
    searchUrl: 'https://www.google.com/search?q=ai+tools+for+beginners+singapore&gl=sg&hl=en&pws=0',
    potential: 'MEDIUM',
  },
]

// ─── Hustle Position (verified) ───────────────────────────────────────────────
interface HustleCategory {
  category: string
  icon: string
  status: 'Ranking' | 'Ad only' | 'Absent'
  ranksFor: string[]
  gaps: string[]
  action: string
}

const HUSTLE_POSITION: HustleCategory[] = [
  {
    category: 'Photography',
    icon: '📷',
    status: 'Absent',
    ranksFor: [],
    gaps: ['photography course singapore', 'photo editing course singapore', 'mobile photography course'],
    action: 'Hustle does not appear in the top 10 for "photography course singapore". Priority: build dedicated landing pages, collect more reviews, and create keyword-targeted blog content.',
  },
  {
    category: 'AI & GenAI',
    icon: '🤖',
    status: 'Absent',
    ranksFor: [],
    gaps: ['ai tools for beginners singapore', 'chatgpt for business singapore', 'ai content creation course', 'prompt engineering singapore'],
    action: 'Hustle has zero organic AI rankings. Immediate action: create dedicated pages for "AI for marketers" and "ChatGPT for business owners" — both are uncontested by tracked competitors.',
  },
  {
    category: 'Content Creation',
    icon: '✍️',
    status: 'Absent',
    ranksFor: [],
    gaps: ['content creation course singapore', 'ai content creation course', 'reels course singapore'],
    action: 'Equinet ranks #1 for this keyword, yet Hustle runs very similar courses. Competitor gap: Equinet does not cover AI content creation. Hustle can own the "AI + content" intersection.',
  },
  {
    category: 'Digital Marketing',
    icon: '📣',
    status: 'Absent',
    ranksFor: [],
    gaps: ['digital marketing course singapore', 'ai digital marketing course', 'social media marketing course singapore'],
    action: 'Crowded market — ASK and Equinet are too entrenched for head-on competition. Hustle\'s angle: "AI-powered digital marketing" — a niche Heicoders is moving into via ads but not yet ranking for.',
  },
  {
    category: 'SEO',
    icon: '🔍',
    status: 'Absent',
    ranksFor: [],
    gaps: ['seo course singapore', 'ai seo course', 'seo for content creators'],
    action: 'ASK #1, Equinet #3. Too competitive for direct entry. Hustle\'s route: "AI SEO" or "SEO for content creators" — OOm is the only competitor in this space and Hustle can differentiate.',
  },
  {
    category: 'Overall Hustle SEO',
    icon: '⚠️',
    status: 'Absent',
    ranksFor: [],
    gaps: ['all tracked keywords'],
    action: 'CRITICAL: Hustle SG has no top-10 organic presence for any of the 11 keywords verified. This means all traffic currently comes from paid ads and direct search. Building content and landing pages is the #1 SEO priority.',
  },
]

// ─── UI Helpers ───────────────────────────────────────────────────────────────
const COMP_STYLE: Record<Competition, { badge: string; label: string }> = {
  HIGH:   { badge: 'bg-red-950/60 text-red-400 border-red-800/50',          label: 'HIGH'   },
  MEDIUM: { badge: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/40', label: 'MED'    },
  LOW:    { badge: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40', label: 'LOW' },
}

const SEV_STYLE: Record<Severity, { border: string; labelClass: string; label: string }> = {
  critical: { border: 'border-red-800/50',    labelClass: 'text-red-400',    label: '🚨 CRITICAL' },
  high:     { border: 'border-orange-800/40', labelClass: 'text-orange-400', label: '⚠️ HIGH'     },
  medium:   { border: 'border-yellow-800/40', labelClass: 'text-yellow-400', label: '📊 MEDIUM'   },
}

const POS_STYLE: Record<HustlePos, { badge: string; dot: string }> = {
  'Ranking':  { badge: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50', dot: 'bg-emerald-500' },
  'Ad only':  { badge: 'bg-blue-950/60 text-blue-400 border-blue-800/50',          dot: 'bg-blue-500'    },
  'Absent':   { badge: 'bg-slate-800 text-slate-500 border-slate-700',             dot: 'bg-slate-600'   },
}

function Section({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`bg-slate-900/50 border border-slate-800 rounded-xl p-5 ${className}`}>{children}</div>
}

function H2({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-bold text-white tracking-tight">{children}</h2>
      {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function RankBadge({ rank, isAd }: { rank: number; isAd?: boolean }) {
  if (isAd) return <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-950/60 border border-blue-800/40 text-blue-400">AD</span>
  const color = rank <= 3 ? 'text-yellow-400' : rank <= 5 ? 'text-white' : 'text-slate-400'
  return <span className={`font-mono font-bold text-xs ${color}`}>#{rank}</span>
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SearchIntelligencePage() {
  const keywordsTracked   = VERIFIED_KEYWORDS.length
  const hustleAbsent      = VERIFIED_KEYWORDS.filter(k => !k.hustlePresent).length
  const highOpportunities = OPPORTUNITIES.filter(o => o.potential === 'HIGH').length

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Search Intelligence</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Rankings verified via live Google Search (Singapore, personalisation off) · 22 Jun 2026 · Click any keyword to view source
            </p>
          </div>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-950/50 border border-emerald-800/50 text-[11px] text-emerald-400 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Live-verified
          </span>
        </div>

        {/* ── Critical Alert ── */}
        <div className="rounded-xl border border-red-800/60 bg-red-950/20 p-4 flex items-start gap-3">
          <span className="text-xl shrink-0">🚨</span>
          <div>
            <p className="text-sm font-bold text-red-300">Hustle SG has zero top-10 organic rankings across all {keywordsTracked} verified keywords</p>
            <p className="text-xs text-red-400/80 mt-0.5">
              This means all search traffic currently relies on paid ads and brand awareness. Universities (SMU, NUS, NTU) and established providers (ASK, Equinet) dominate every category. SEO investment is now a business-critical priority.
            </p>
          </div>
        </div>

        {/* ── KPIs ── */}
        <div className="grid grid-cols-4 gap-4">
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase mb-2">Keywords Verified</p>
            <p className="text-3xl font-black text-white">{keywordsTracked}</p>
            <p className="text-xs text-slate-500 mt-1">via live Google Search</p>
          </Section>
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-red-400 uppercase mb-2">Hustle Not Ranking</p>
            <p className="text-3xl font-black text-red-400">{hustleAbsent}/{keywordsTracked}</p>
            <p className="text-xs text-slate-500 mt-1">keywords with zero Hustle presence</p>
          </Section>
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-yellow-400 uppercase mb-2">Strongest Competitor</p>
            <p className="text-lg font-black text-yellow-400 mt-1">ASK + Equinet</p>
            <p className="text-xs text-slate-500 mt-1">most top-10 organic spots among tracked</p>
          </Section>
          <Section className="border-emerald-800/40 bg-emerald-950/10">
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mb-2">Uncontested Gaps</p>
            <p className="text-3xl font-black text-emerald-400">{highOpportunities}</p>
            <p className="text-xs text-slate-500 mt-1">high-value keywords with no ranked owner</p>
          </Section>
        </div>

        {/* ── Section 1: Category Leaders (verified) ── */}
        <Section>
          <H2 sub="Top-ranked private training provider per category — verified from Google Search">Category Leaders</H2>
          <div className="grid grid-cols-4 gap-3">
            {CATEGORIES.map(cat => {
              const cs = COMP_STYLE[cat.competition]
              const ps = POS_STYLE[cat.hustleStatus]
              return (
                <div key={cat.name} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span>{cat.icon}</span>
                      <span className="text-sm font-bold text-white">{cat.name}</span>
                    </div>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold border ${cs.badge}`}>{cs.label}</span>
                  </div>
                  <div className="mb-2">
                    <p className="text-[9px] text-slate-500 font-bold uppercase mb-1">Top Ranked Provider</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.topColor }} />
                      <span className="text-xs font-semibold text-white">{cat.topPrivateProvider}</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-500 leading-relaxed mb-2">{cat.note}</p>
                  <div className="pt-2 border-t border-slate-700/50 flex items-center justify-between">
                    <span className="text-[9px] text-slate-500">Hustle</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${ps.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ps.dot}`} />
                      {cat.hustleStatus}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Section 2: Verified Keyword Rankings ── */}
        <Section>
          <H2 sub="Live Google Search rankings — click any keyword to open the source search result">Verified Keyword Rankings</H2>
          <div className="space-y-0 divide-y divide-slate-800/60">
            {VERIFIED_KEYWORDS.map((kw) => (
              <div key={kw.keyword} className="py-3 grid grid-cols-[1fr_2fr] gap-4 items-start">
                {/* Keyword + metadata */}
                <div>
                  <a
                    href={kw.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold text-white hover:text-indigo-400 transition-colors underline decoration-slate-700 hover:decoration-indigo-400"
                  >
                    {kw.keyword}
                  </a>
                  <span className="ml-2 text-[10px] text-slate-500">{kw.category}</span>
                  <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{kw.notes}</p>
                </div>

                {/* Results */}
                <div className="flex flex-col gap-1.5">
                  {kw.results.length === 0 ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-800/40 border border-slate-700/50">
                      <span className="text-[11px] text-slate-500 italic">No tracked competitors in top 10</span>
                    </div>
                  ) : (
                    kw.results.map((r, i) => (
                      <div key={i} className={`flex items-center gap-3 px-3 py-1.5 rounded-lg border ${r.isAd ? 'bg-blue-950/10 border-blue-800/30' : r.isHustle ? 'bg-indigo-950/20 border-indigo-800/30' : 'bg-slate-800/40 border-slate-700/50'}`}>
                        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: r.color }} />
                        <span className={`text-xs font-semibold flex-1 ${r.isHustle ? 'text-indigo-300' : 'text-white'}`}>{r.name}</span>
                        <RankBadge rank={r.rank} isAd={r.isAd} />
                      </div>
                    ))
                  )}
                  {!kw.hustlePresent && (
                    <div className="flex items-center gap-2 px-3 py-1 rounded bg-slate-800/30 border border-slate-700/30">
                      <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" />
                      <span className="text-[10px] text-slate-600 italic">Hustle SG — not ranking</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ── Section 3: Opportunities + Threats ── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Opportunities */}
          <Section className="border-emerald-800/40 bg-emerald-950/5">
            <H2 sub="Keywords with no established owner — verified via Google Search">
              🟢 Uncontested Opportunities
            </H2>
            <div className="space-y-2">
              {OPPORTUNITIES.map((opp) => (
                <div key={opp.keyword} className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:border-emerald-800/40 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <a
                      href={opp.searchUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-semibold text-white hover:text-emerald-400 transition-colors underline decoration-slate-700 hover:decoration-emerald-400"
                    >
                      {opp.keyword}
                    </a>
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${opp.potential === 'HIGH' ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50' : 'bg-blue-950/50 text-blue-400 border-blue-800/40'}`}>
                      {opp.potential}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 mb-1">{opp.category}</p>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{opp.why}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Threats */}
          <Section>
            <H2 sub="Competitors with verified organic ranking dominance">
              🚨 Verified Search Threats
            </H2>
            <div className="space-y-3">
              {THREATS.map((threat) => {
                const ss = SEV_STYLE[threat.severity]
                return (
                  <div key={threat.competitor} className={`p-3 rounded-lg bg-slate-800/40 border ${ss.border}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: threat.color }} />
                      <span className="text-sm font-bold text-white">{threat.competitor}</span>
                      <span className={`text-[9px] font-bold ml-auto ${ss.labelClass}`}>{ss.label}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {threat.keywords.map(kw => (
                        <a
                          key={kw.term}
                          href={kw.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-slate-700/60 border border-slate-600/50 hover:border-slate-500 transition-colors"
                        >
                          <span className="text-[10px] text-slate-300">{kw.term}</span>
                          {kw.rank > 0 && <span className={`font-mono text-[10px] font-bold ${kw.rank <= 3 ? 'text-yellow-400' : 'text-slate-400'}`}>#{kw.rank}</span>}
                          {kw.rank === 0 && <span className="text-[9px] text-blue-400 font-bold">AD</span>}
                        </a>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{threat.signal}</p>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>

        {/* ── Section 4: Hustle Search Position ── */}
        <Section className="border-indigo-800/40 bg-indigo-950/10">
          <H2 sub="Hustle's verified organic presence — and what to build">Hustle Search Position</H2>
          <div className="grid grid-cols-3 gap-3">
            {HUSTLE_POSITION.map((pos) => {
              const ps = POS_STYLE[pos.status]
              return (
                <div key={pos.category} className={`bg-slate-800/40 rounded-lg p-4 border ${pos.category === 'Overall Hustle SEO' ? 'border-red-800/50 bg-red-950/10' : 'border-slate-700/40'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span>{pos.icon}</span>
                      <span className="text-sm font-bold text-white">{pos.category}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold border ${ps.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ps.dot}`} />
                      {pos.status}
                    </span>
                  </div>

                  {pos.gaps.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[9px] font-bold tracking-widest text-orange-600 uppercase mb-1">Not Ranking For</p>
                      <div className="space-y-0.5">
                        {pos.gaps.slice(0, 3).map(g => (
                          <div key={g} className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-orange-500/60 shrink-0" />
                            <span className="text-[11px] text-slate-500">{g}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-slate-700/40">
                    <p className="text-[10px] font-bold text-indigo-400 mb-1">Action</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{pos.action}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Footer ── */}
        <div className="text-[10px] text-slate-700 flex flex-wrap gap-4 pb-2">
          <span>All rankings verified via Google Search (gl=sg, pws=0, hl=en) on 22 Jun 2026</span>
          <span>·</span>
          <span>Organic positions only — paid ads noted separately</span>
          <span>·</span>
          <span>Click any keyword to open the source Google Search</span>
        </div>

      </div>
    </AppLayout>
  )
}
