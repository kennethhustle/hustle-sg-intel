/**
 * Search Intelligence — Market Demand Intelligence Dashboard
 *
 * Answers 5 strategic questions:
 * 1. Which keywords are competitors targeting?
 * 2. Which categories are crowded?
 * 3. Which competitors dominate AI search demand?
 * 4. What keywords should Hustle attack?
 * 5. Which opportunities are underserved?
 *
 * Data sourced from: competitor websites, course titles, Meta ad copy,
 * Google search ads, MySkillsFuture course titles, page titles, meta descriptions.
 * Last reviewed: 22 Jun 2026
 */

import type { ReactNode } from 'react'
import { AppLayout } from '@/components/layout/app-layout'

export const revalidate = 3600

// ─── Types ───────────────────────────────────────────────────────────────────
type Competition = 'HIGH' | 'MEDIUM' | 'LOW'
type Intent      = 'Commercial' | 'Informational' | 'Brand'
type HustlePos   = 'Strong' | 'Emerging' | 'Weak' | 'Absent'
type Severity    = 'critical' | 'high' | 'medium'

// ─── Category Leaders ─────────────────────────────────────────────────────────
interface Category {
  name: string
  icon: string
  owner: string
  ownerColor: string
  competitors: { name: string; color: string }[]
  competition: Competition
  hustleStatus: HustlePos
}

const CATEGORIES: Category[] = [
  {
    name: 'AI & GenAI',
    icon: '🤖',
    owner: 'Info-Tech Academy',
    ownerColor: '#06b6d4',
    competitors: [
      { name: 'Info-Tech Academy', color: '#06b6d4' },
      { name: 'Vertical Institute', color: '#f59e0b' },
      { name: 'ASK Training',       color: '#ef4444' },
      { name: 'Heicoders Academy',  color: '#ec4899' },
      { name: 'Skills Dev Academy', color: '#3b82f6' },
    ],
    competition: 'HIGH',
    hustleStatus: 'Emerging',
  },
  {
    name: 'Digital Marketing',
    icon: '📣',
    owner: 'ASK Training',
    ownerColor: '#ef4444',
    competitors: [
      { name: 'ASK Training',    color: '#ef4444' },
      { name: 'Equinet Academy', color: '#14b8a6' },
      { name: 'BELLS Institute', color: '#f97316' },
      { name: 'Hustle SG',       color: '#6366f1' },
    ],
    competition: 'HIGH',
    hustleStatus: 'Weak',
  },
  {
    name: 'Data Analytics',
    icon: '📊',
    owner: 'Vertical Institute',
    ownerColor: '#f59e0b',
    competitors: [
      { name: 'Vertical Institute',  color: '#f59e0b' },
      { name: 'Heicoders Academy',   color: '#ec4899' },
      { name: 'Info-Tech Academy',   color: '#06b6d4' },
      { name: 'BELLS Institute',     color: '#f97316' },
    ],
    competition: 'HIGH',
    hustleStatus: 'Absent',
  },
  {
    name: 'SEO',
    icon: '🔍',
    owner: 'Equinet Academy',
    ownerColor: '#14b8a6',
    competitors: [
      { name: 'Equinet Academy', color: '#14b8a6' },
      { name: 'ASK Training',    color: '#ef4444' },
      { name: 'OOm Pte Ltd',     color: '#8b5cf6' },
    ],
    competition: 'MEDIUM',
    hustleStatus: 'Absent',
  },
  {
    name: 'Photography',
    icon: '📷',
    owner: 'Hustle SG',
    ownerColor: '#6366f1',
    competitors: [
      { name: 'Hustle SG',       color: '#6366f1' },
      { name: 'Happy Together',  color: '#10b981' },
    ],
    competition: 'LOW',
    hustleStatus: 'Strong',
  },
  {
    name: 'Design & Creative',
    icon: '🎨',
    owner: 'Hustle SG',
    ownerColor: '#6366f1',
    competitors: [
      { name: 'Hustle SG',      color: '#6366f1' },
      { name: 'Happy Together', color: '#10b981' },
      { name: 'ASK Training',   color: '#ef4444' },
    ],
    competition: 'LOW',
    hustleStatus: 'Strong',
  },
  {
    name: 'Cybersecurity',
    icon: '🔐',
    owner: 'Info-Tech Academy',
    ownerColor: '#06b6d4',
    competitors: [
      { name: 'Info-Tech Academy', color: '#06b6d4' },
      { name: 'BELLS Institute',   color: '#f97316' },
    ],
    competition: 'MEDIUM',
    hustleStatus: 'Absent',
  },
  {
    name: 'Productivity & AI Tools',
    icon: '⚡',
    owner: 'ASK Training',
    ownerColor: '#ef4444',
    competitors: [
      { name: 'ASK Training',       color: '#ef4444' },
      { name: 'Hustle SG',          color: '#6366f1' },
      { name: 'Skills Dev Academy', color: '#3b82f6' },
      { name: 'BELLS Institute',    color: '#f97316' },
    ],
    competition: 'MEDIUM',
    hustleStatus: 'Emerging',
  },
  {
    name: 'Career Development',
    icon: '🏆',
    owner: 'BELLS Institute',
    ownerColor: '#f97316',
    competitors: [
      { name: 'BELLS Institute',    color: '#f97316' },
      { name: 'Skills Dev Academy', color: '#3b82f6' },
      { name: 'ASK Training',       color: '#ef4444' },
    ],
    competition: 'MEDIUM',
    hustleStatus: 'Absent',
  },
]

// ─── Competitor Keywords ──────────────────────────────────────────────────────
interface KeywordEntry {
  term: string
  intent: Intent
  competition: Competition
}

interface CompetitorKeywords {
  name: string
  color: string
  keywords: KeywordEntry[]
}

const COMPETITOR_KEYWORDS: CompetitorKeywords[] = [
  {
    name: 'ASK Training',
    color: '#ef4444',
    keywords: [
      { term: 'digital marketing course singapore',  intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'google analytics course singapore',   intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'seo course singapore',                intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'ai marketing course singapore',       intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'social media marketing course',       intent: 'Commercial',     competition: 'HIGH'   },
    ],
  },
  {
    name: 'BELLS Institute',
    color: '#f97316',
    keywords: [
      { term: 'cybersecurity course singapore',       intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'project management course singapore',  intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'data analytics course singapore',      intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'microsoft office course singapore',    intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'it training singapore',                intent: 'Commercial',     competition: 'HIGH'   },
    ],
  },
  {
    name: 'Info-Tech Academy',
    color: '#06b6d4',
    keywords: [
      { term: 'generative ai course singapore',      intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'chatgpt course singapore',            intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'ai tools training singapore',         intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'cloud computing course singapore',    intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'data analytics course singapore',     intent: 'Commercial',     competition: 'HIGH'   },
    ],
  },
  {
    name: 'Vertical Institute',
    color: '#f59e0b',
    keywords: [
      { term: 'data analytics course singapore',    intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'python course singapore',            intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'ai course singapore',                intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'marketing analytics course',         intent: 'Commercial',     competition: 'LOW'    },
      { term: 'machine learning course singapore',  intent: 'Commercial',     competition: 'LOW'    },
    ],
  },
  {
    name: 'Equinet Academy',
    color: '#14b8a6',
    keywords: [
      { term: 'seo course singapore',               intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'google ads course singapore',        intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'digital marketing certification',    intent: 'Commercial',     competition: 'HIGH'   },
      { term: 'content marketing course singapore', intent: 'Informational',  competition: 'LOW'    },
      { term: 'facebook ads course singapore',      intent: 'Commercial',     competition: 'MEDIUM' },
    ],
  },
  {
    name: 'Heicoders Academy',
    color: '#ec4899',
    keywords: [
      { term: 'python course singapore',            intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'data science course singapore',      intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'machine learning singapore',         intent: 'Informational',  competition: 'LOW'    },
      { term: 'ai bootcamp singapore',              intent: 'Commercial',     competition: 'LOW'    },
      { term: 'ai course singapore',                intent: 'Commercial',     competition: 'HIGH'   },
    ],
  },
  {
    name: 'Skills Dev Academy',
    color: '#3b82f6',
    keywords: [
      { term: 'microsoft office course singapore',  intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'administrative skills training',     intent: 'Commercial',     competition: 'LOW'    },
      { term: 'workplace productivity training',    intent: 'Commercial',     competition: 'LOW'    },
      { term: 'excel training singapore',           intent: 'Commercial',     competition: 'MEDIUM' },
      { term: 'office skills course singapore',     intent: 'Commercial',     competition: 'LOW'    },
    ],
  },
  {
    name: 'Hustle SG',
    color: '#6366f1',
    keywords: [
      { term: 'photography course singapore',       intent: 'Commercial',     competition: 'LOW'    },
      { term: 'ai tools for beginners singapore',   intent: 'Commercial',     competition: 'LOW'    },
      { term: 'content creation course singapore',  intent: 'Commercial',     competition: 'LOW'    },
      { term: 'chatgpt for business singapore',     intent: 'Commercial',     competition: 'LOW'    },
      { term: 'ai for creatives singapore',         intent: 'Commercial',     competition: 'LOW'    },
    ],
  },
]

// ─── Keyword Market Share ─────────────────────────────────────────────────────
interface MarketKeyword {
  keyword: string
  category: string
  competitors: { name: string; color: string }[]
  owner: string | null
  ownerColor: string | null
  competition: Competition
}

const MARKET_KEYWORDS: MarketKeyword[] = [
  {
    keyword: 'ai course singapore',
    category: 'AI & GenAI',
    competitors: [
      { name: 'Info-Tech', color: '#06b6d4' },
      { name: 'Vertical',  color: '#f59e0b' },
      { name: 'Heicoders', color: '#ec4899' },
      { name: 'ASK',       color: '#ef4444' },
      { name: 'Skills Dev', color: '#3b82f6' },
    ],
    owner: null,
    ownerColor: null,
    competition: 'HIGH',
  },
  {
    keyword: 'data analytics course singapore',
    category: 'Data Analytics',
    competitors: [
      { name: 'Vertical',  color: '#f59e0b' },
      { name: 'Heicoders', color: '#ec4899' },
      { name: 'Info-Tech', color: '#06b6d4' },
      { name: 'BELLS',     color: '#f97316' },
    ],
    owner: 'Vertical',
    ownerColor: '#f59e0b',
    competition: 'HIGH',
  },
  {
    keyword: 'digital marketing course singapore',
    category: 'Digital Marketing',
    competitors: [
      { name: 'ASK',     color: '#ef4444' },
      { name: 'Equinet', color: '#14b8a6' },
      { name: 'BELLS',   color: '#f97316' },
      { name: 'Hustle',  color: '#6366f1' },
    ],
    owner: 'ASK',
    ownerColor: '#ef4444',
    competition: 'HIGH',
  },
  {
    keyword: 'chatgpt course singapore',
    category: 'AI & GenAI',
    competitors: [
      { name: 'Info-Tech', color: '#06b6d4' },
      { name: 'Vertical',  color: '#f59e0b' },
      { name: 'ASK',       color: '#ef4444' },
    ],
    owner: 'Info-Tech',
    ownerColor: '#06b6d4',
    competition: 'MEDIUM',
  },
  {
    keyword: 'seo course singapore',
    category: 'SEO',
    competitors: [
      { name: 'Equinet', color: '#14b8a6' },
      { name: 'ASK',     color: '#ef4444' },
      { name: 'OOm',     color: '#8b5cf6' },
    ],
    owner: 'Equinet',
    ownerColor: '#14b8a6',
    competition: 'MEDIUM',
  },
  {
    keyword: 'python course singapore',
    category: 'Data Analytics',
    competitors: [
      { name: 'Heicoders', color: '#ec4899' },
      { name: 'Vertical',  color: '#f59e0b' },
    ],
    owner: 'Heicoders',
    ownerColor: '#ec4899',
    competition: 'MEDIUM',
  },
  {
    keyword: 'photography course singapore',
    category: 'Photography',
    competitors: [
      { name: 'Hustle',         color: '#6366f1' },
      { name: 'Happy Together', color: '#10b981' },
    ],
    owner: 'Hustle',
    ownerColor: '#6366f1',
    competition: 'LOW',
  },
  {
    keyword: 'generative ai course singapore',
    category: 'AI & GenAI',
    competitors: [
      { name: 'Info-Tech', color: '#06b6d4' },
      { name: 'ASK',       color: '#ef4444' },
    ],
    owner: 'Info-Tech',
    ownerColor: '#06b6d4',
    competition: 'MEDIUM',
  },
  {
    keyword: 'content creation course singapore',
    category: 'Creative',
    competitors: [
      { name: 'Hustle',         color: '#6366f1' },
      { name: 'Happy Together', color: '#10b981' },
    ],
    owner: 'Hustle',
    ownerColor: '#6366f1',
    competition: 'LOW',
  },
  {
    keyword: 'ai for business singapore',
    category: 'AI & GenAI',
    competitors: [
      { name: 'Hustle',    color: '#6366f1' },
      { name: 'Info-Tech', color: '#06b6d4' },
    ],
    owner: null,
    ownerColor: null,
    competition: 'LOW',
  },
  {
    keyword: 'google ads course singapore',
    category: 'Digital Marketing',
    competitors: [
      { name: 'Equinet', color: '#14b8a6' },
      { name: 'ASK',     color: '#ef4444' },
    ],
    owner: 'Equinet',
    ownerColor: '#14b8a6',
    competition: 'MEDIUM',
  },
  {
    keyword: 'ai tools course singapore',
    category: 'AI & GenAI',
    competitors: [
      { name: 'Hustle',    color: '#6366f1' },
      { name: 'Info-Tech', color: '#06b6d4' },
      { name: 'ASK',       color: '#ef4444' },
    ],
    owner: null,
    ownerColor: null,
    competition: 'MEDIUM',
  },
]

// ─── Search Opportunities ─────────────────────────────────────────────────────
interface Opportunity {
  keyword: string
  category: string
  why: string
  potential: 'HIGH' | 'MEDIUM'
}

const OPPORTUNITIES: Opportunity[] = [
  { keyword: 'AI for marketers',                category: 'AI & Digital Marketing', why: 'Crossover of Hustle\'s two strongest areas — no competitor owns this niche',        potential: 'HIGH'   },
  { keyword: 'AI for content creators',         category: 'AI & Creative',          why: 'Hustle already owns "content creation" — layering AI is a natural extension',       potential: 'HIGH'   },
  { keyword: 'AI for SMEs Singapore',           category: 'AI & Business',          why: '0 competitors targeting SME-specific AI training. Large addressable market',        potential: 'HIGH'   },
  { keyword: 'Prompt engineering for business', category: 'AI & GenAI',             why: 'Practical framing differentiates from academic AI courses. Underserved segment',    potential: 'HIGH'   },
  { keyword: 'AI for photographers',            category: 'AI & Photography',       why: 'Combines Hustle\'s category ownership in photography with AI — zero competition',   potential: 'HIGH'   },
  { keyword: 'Generative AI workshop Singapore',category: 'AI & GenAI',             why: 'Workshop format (1-day) outperforms courses in SkillsFuture search volume',        potential: 'MEDIUM' },
  { keyword: 'AI productivity course',          category: 'Productivity & AI',      why: 'Skills Dev Academy owns "productivity" but ignores AI — gap for Hustle to fill',   potential: 'MEDIUM' },
  { keyword: 'Content automation Singapore',    category: 'AI & Marketing',         why: 'Emerging search term, no training provider has staked a claim yet',                potential: 'MEDIUM' },
  { keyword: 'ChatGPT for business Singapore',  category: 'AI & Business',          why: 'High commercial intent, Info-Tech\'s version is IT-focused — Hustle can own biz POV', potential: 'HIGH' },
  { keyword: 'AI for small business',           category: 'AI & Business',          why: 'SME-angled AI training — completely uncontested by any tracked competitor',         potential: 'MEDIUM' },
]

// ─── Search Threats ───────────────────────────────────────────────────────────
interface Threat {
  competitor: string
  color: string
  owns: string
  signal: string
  severity: Severity
}

const THREATS: Threat[] = [
  {
    competitor: 'ASK Training',
    color: '#ef4444',
    owns: 'Digital Marketing search',
    signal: 'Bidding on "digital marketing course singapore", "google analytics", "seo course" — dominates commercial intent across all marketing categories. 400 Google ads confirm aggressive capture.',
    severity: 'critical',
  },
  {
    competitor: 'Vertical Institute',
    color: '#f59e0b',
    owns: 'Data Analytics search',
    signal: 'Category owner for "data analytics course singapore" and "python course". 2,754 reviews fuel organic ranking authority. Risk: expanding into AI marketing analytics.',
    severity: 'critical',
  },
  {
    competitor: 'Info-Tech Academy',
    color: '#06b6d4',
    owns: 'GenAI & ChatGPT search',
    signal: 'First mover on GenAI terms. Targeting "generative ai course", "chatgpt course", "cloud AI" with 5,163 reviews driving strong organic presence. Hustling into Hustle\'s potential AI territory.',
    severity: 'critical',
  },
  {
    competitor: 'Equinet Academy',
    color: '#14b8a6',
    owns: 'SEO training search',
    signal: 'Niche category ownership of "seo course singapore" and "google ads course". Small review count (151) but high Google Ads spend (~120 ads) compensates. Barriers to entry: brand authority built over years.',
    severity: 'high',
  },
  {
    competitor: 'Heicoders Academy',
    color: '#ec4899',
    owns: 'Python & Data Science search',
    signal: 'Emerging threat with 54 newly detected Meta ads and 3,569 reviews. Actively targeting "ai bootcamp singapore" — previously not a Meta advertiser. Fast mover in technical AI training.',
    severity: 'high',
  },
  {
    competitor: 'Skills Dev Academy',
    color: '#3b82f6',
    owns: 'Productivity & Office skills search',
    signal: '15,891 Google reviews create overwhelming organic authority across all search results. Even indirect searches will surface SDA over Hustle in many categories via review signals.',
    severity: 'high',
  },
]

// ─── Hustle Search Position ───────────────────────────────────────────────────
interface HustleCategory {
  category: string
  status: HustlePos
  icon: string
  ownedKeywords: string[]
  gaps: string[]
  action: string
}

const HUSTLE_POSITION: HustleCategory[] = [
  {
    category: 'Photography',
    status: 'Strong',
    icon: '📷',
    ownedKeywords: ['photography course singapore', 'photo editing course', 'content creation course'],
    gaps: ['videography course singapore', 'reels creation course'],
    action: 'Maintain leadership. Add short-form video content to expand this category.',
  },
  {
    category: 'AI & GenAI',
    status: 'Emerging',
    icon: '🤖',
    ownedKeywords: ['ai tools for beginners singapore', 'chatgpt for business', 'ai for creatives'],
    gaps: ['generative ai course singapore', 'ai for marketers', 'prompt engineering'],
    action: 'Launch 3 AI-specific landing pages targeting the listed gap keywords immediately.',
  },
  {
    category: 'Digital Marketing',
    status: 'Weak',
    icon: '📣',
    ownedKeywords: ['digital marketing course singapore'],
    gaps: ['google ads course', 'facebook ads course', 'performance marketing'],
    action: 'Differentiate: ASK owns generic digital marketing. Hustle should own "AI-powered digital marketing".',
  },
  {
    category: 'SEO',
    status: 'Absent',
    icon: '🔍',
    ownedKeywords: [],
    gaps: ['seo course singapore', 'on-page seo training', 'technical seo workshop'],
    action: 'Equinet owns SEO. Hustle\'s entry point: launch an AI+SEO hybrid course for content marketers.',
  },
  {
    category: 'Data Analytics',
    status: 'Absent',
    icon: '📊',
    ownedKeywords: [],
    gaps: ['data analytics for marketers', 'google analytics 4 course', 'marketing data course'],
    action: 'Too crowded for head-on entry. Hustle\'s angle: "analytics for creatives" or "GA4 for marketers".',
  },
  {
    category: 'Productivity & AI Tools',
    status: 'Emerging',
    icon: '⚡',
    ownedKeywords: ['ai tools course', 'chatgpt productivity', 'ai for beginners'],
    gaps: ['ai productivity for teams', 'chatgpt for business owners', 'workflow automation'],
    action: 'High priority. Build "AI Productivity for Business" as a flagship course. No competitor owns this.',
  },
]

// ─── UI Helpers ───────────────────────────────────────────────────────────────
const COMP_STYLE: Record<Competition, { badge: string; bar: string; label: string }> = {
  HIGH:   { badge: 'bg-red-950/60 text-red-400 border-red-800/50',       bar: 'bg-red-500',    label: 'HIGH'   },
  MEDIUM: { badge: 'bg-yellow-950/50 text-yellow-400 border-yellow-800/40', bar: 'bg-yellow-500', label: 'MED'    },
  LOW:    { badge: 'bg-emerald-950/50 text-emerald-400 border-emerald-800/40', bar: 'bg-emerald-500', label: 'LOW' },
}

const INTENT_STYLE: Record<Intent, string> = {
  Commercial:   'text-blue-400',
  Informational:'text-slate-400',
  Brand:        'text-purple-400',
}

const POS_STYLE: Record<HustlePos, { badge: string; dot: string }> = {
  Strong:   { badge: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50', dot: 'bg-emerald-500' },
  Emerging: { badge: 'bg-blue-950/60 text-blue-400 border-blue-800/50',          dot: 'bg-blue-500'    },
  Weak:     { badge: 'bg-orange-950/50 text-orange-400 border-orange-800/40',    dot: 'bg-orange-500'  },
  Absent:   { badge: 'bg-slate-800 text-slate-500 border-slate-700',             dot: 'bg-slate-600'   },
}

const SEV_STYLE: Record<Severity, { border: string; label: string; labelClass: string }> = {
  critical: { border: 'border-red-800/50',    label: '🚨 CRITICAL', labelClass: 'text-red-400'    },
  high:     { border: 'border-orange-800/40', label: '⚠️ HIGH',     labelClass: 'text-orange-400' },
  medium:   { border: 'border-yellow-800/40', label: '📊 MEDIUM',   labelClass: 'text-yellow-400' },
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

function CompBadge({ level }: { level: Competition }) {
  const s = COMP_STYLE[level]
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide border ${s.badge}`}>
      {s.label}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
export default function SearchIntelligencePage() {
  const totalKeywords    = MARKET_KEYWORDS.length
  const crowdedKeywords  = MARKET_KEYWORDS.filter(k => k.competition === 'HIGH').length
  const ownedKeywords    = MARKET_KEYWORDS.filter(k => k.ownerColor === '#6366f1').length
  const opportunityCount = OPPORTUNITIES.filter(o => o.potential === 'HIGH').length

  return (
    <AppLayout>
      <div className="min-h-screen bg-slate-950 text-white p-6 space-y-6">

        {/* ── Page Header ── */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-black tracking-tight text-white">Search Intelligence</h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Keyword ownership · Category competition · Market opportunities · Last updated 22 Jun 2026
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-[11px] text-slate-400 font-medium">
              Sourced from course pages · ad copy · SF listings
            </span>
          </div>
        </div>

        {/* ── Summary KPIs ── */}
        <div className="grid grid-cols-4 gap-4">
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-slate-500 uppercase mb-2">Keywords Tracked</p>
            <p className="text-3xl font-black text-white">{totalKeywords}</p>
            <p className="text-xs text-slate-500 mt-1">across {CATEGORIES.length} categories</p>
          </Section>
          <Section>
            <p className="text-[10px] font-bold tracking-widest text-red-400 uppercase mb-2">Crowded Keywords</p>
            <p className="text-3xl font-black text-red-400">{crowdedKeywords}</p>
            <p className="text-xs text-slate-500 mt-1">3+ competitors fighting for same term</p>
          </Section>
          <Section className="border-indigo-800/50 bg-indigo-950/20">
            <p className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase mb-2">Hustle Owns</p>
            <p className="text-3xl font-black text-indigo-400">{ownedKeywords}</p>
            <p className="text-xs text-slate-500 mt-1">keyword categories with clear ownership</p>
          </Section>
          <Section className="border-emerald-800/40 bg-emerald-950/10">
            <p className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase mb-2">High-Value Gaps</p>
            <p className="text-3xl font-black text-emerald-400">{opportunityCount}</p>
            <p className="text-xs text-slate-500 mt-1">uncontested opportunities for Hustle</p>
          </Section>
        </div>

        {/* ── Section 1: Category Leaders ── */}
        <Section>
          <H2 sub="Who dominates each training category in Singapore search">Category Leaders</H2>
          <div className="grid grid-cols-3 gap-3">
            {CATEGORIES.map(cat => {
              const cs = COMP_STYLE[cat.competition]
              const ps = POS_STYLE[cat.hustleStatus]
              return (
                <div
                  key={cat.name}
                  className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/50 hover:border-slate-600/60 transition-colors"
                >
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{cat.icon}</span>
                      <span className="text-sm font-bold text-white">{cat.name}</span>
                    </div>
                    <CompBadge level={cat.competition} />
                  </div>

                  {/* Owner */}
                  <div className="mb-3">
                    <p className="text-[10px] text-slate-500 font-bold tracking-widest uppercase mb-1">Category Owner</p>
                    <div className="flex items-center gap-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: cat.ownerColor }} />
                      <span className="text-xs font-semibold text-white">{cat.owner}</span>
                    </div>
                  </div>

                  {/* Competitors */}
                  <div className="flex flex-wrap gap-1 mb-3">
                    {cat.competitors.map(c => (
                      <div
                        key={c.name}
                        className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-700/50 text-[10px] text-slate-300"
                      >
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c.color }} />
                        {c.name.split(' ')[0]}
                      </div>
                    ))}
                  </div>

                  {/* Hustle position */}
                  <div className="pt-2.5 border-t border-slate-700/50 flex items-center justify-between">
                    <span className="text-[10px] text-slate-500">Hustle position</span>
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${ps.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ps.dot}`} />
                      {cat.hustleStatus}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Section 2: Competitor Keywords ── */}
        <Section>
          <H2 sub="Top search terms each competitor is targeting — inferred from ad copy, course titles, and landing pages">
            Competitor Keywords
          </H2>
          <div className="space-y-0 divide-y divide-slate-800/60">
            {COMPETITOR_KEYWORDS.map((comp) => (
              <div key={comp.name} className="py-3 grid grid-cols-[180px_1fr] gap-4 items-start">
                {/* Competitor name */}
                <div className="flex items-center gap-2 pt-0.5">
                  <div className="w-2 h-2 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: comp.color }} />
                  <span className={`text-sm font-semibold ${comp.color === '#6366f1' ? 'text-indigo-300' : 'text-white'}`}>
                    {comp.name}
                    {comp.color === '#6366f1' && <span className="ml-1.5 text-[10px] text-indigo-500 font-normal">YOU</span>}
                  </span>
                </div>
                {/* Keywords */}
                <div className="flex flex-wrap gap-2">
                  {comp.keywords.map((kw) => {
                    const cs = COMP_STYLE[kw.competition]
                    return (
                      <div
                        key={kw.term}
                        className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/60 border border-slate-700/50 group"
                      >
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cs.bar}`} />
                        <span className="text-xs text-slate-200">{kw.term}</span>
                        <span className={`text-[10px] ${INTENT_STYLE[kw.intent]} ml-1`}>{kw.intent}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex items-center gap-4 text-[10px] text-slate-600">
            <span><span className="text-red-400 font-bold">●</span> HIGH competition</span>
            <span><span className="text-yellow-400 font-bold">●</span> MEDIUM competition</span>
            <span><span className="text-emerald-400 font-bold">●</span> LOW competition</span>
            <span className="ml-auto"><span className="text-blue-400">Commercial</span> · <span className="text-slate-400">Informational</span></span>
          </div>
        </Section>

        {/* ── Section 3: Keyword Market Share ── */}
        <Section>
          <H2 sub="Who owns the most valuable keywords — and what's still up for grabs">Keyword Market Share</H2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-slate-500 font-bold tracking-widest uppercase border-b border-slate-800">
                  <th className="text-left pb-3 pr-6">Keyword</th>
                  <th className="text-left pb-3 pr-6">Category</th>
                  <th className="text-left pb-3 pr-6">Competitors</th>
                  <th className="text-left pb-3 pr-6">Category Owner</th>
                  <th className="text-right pb-3">Competition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {MARKET_KEYWORDS.map((kw) => (
                  <tr key={kw.keyword} className="hover:bg-slate-800/20 transition-colors">
                    <td className="py-2.5 pr-6">
                      <span className="text-white text-xs font-medium">{kw.keyword}</span>
                    </td>
                    <td className="py-2.5 pr-6">
                      <span className="text-slate-400 text-xs">{kw.category}</span>
                    </td>
                    <td className="py-2.5 pr-6">
                      <div className="flex items-center gap-1">
                        {kw.competitors.map(c => (
                          <div
                            key={c.name}
                            title={c.name}
                            className="w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                            style={{ backgroundColor: c.color + '33', border: `1px solid ${c.color}60` }}
                          >
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                          </div>
                        ))}
                        <span className="text-slate-500 text-[10px] ml-1">{kw.competitors.length}</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-6">
                      {kw.owner ? (
                        <div className="flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: kw.ownerColor ?? '#fff' }} />
                          <span className="text-xs font-semibold" style={{ color: kw.ownerColor ?? '#fff' }}>
                            {kw.owner}
                          </span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-emerald-500 font-bold">CONTESTED — OPPORTUNITY</span>
                      )}
                    </td>
                    <td className="py-2.5 text-right">
                      <CompBadge level={kw.competition} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ── Section 4 + 5: Opportunities and Threats side by side ── */}
        <div className="grid grid-cols-2 gap-4">

          {/* Opportunities */}
          <Section className="border-emerald-800/40 bg-emerald-950/5">
            <H2 sub="Low-competition keywords Hustle should attack now">
              🟢 Search Opportunities
            </H2>
            <div className="space-y-2">
              {OPPORTUNITIES.map((opp) => (
                <div
                  key={opp.keyword}
                  className="p-3 rounded-lg bg-slate-800/40 border border-slate-700/50 hover:border-emerald-800/40 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div>
                      <span className="text-sm font-semibold text-white">{opp.keyword}</span>
                      <span className="ml-2 text-[10px] text-slate-500">{opp.category}</span>
                    </div>
                    <span className={`shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                      opp.potential === 'HIGH'
                        ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                        : 'bg-blue-950/50 text-blue-400 border-blue-800/40'
                    }`}>
                      {opp.potential}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">{opp.why}</p>
                </div>
              ))}
            </div>
          </Section>

          {/* Threats */}
          <Section>
            <H2 sub="Competitors with established keyword dominance that threaten Hustle">
              🚨 Search Threats
            </H2>
            <div className="space-y-3">
              {THREATS.map((threat) => {
                const ss = SEV_STYLE[threat.severity]
                return (
                  <div
                    key={threat.competitor}
                    className={`p-3 rounded-lg bg-slate-800/40 border ${ss.border} hover:bg-slate-800/60 transition-colors`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: threat.color }} />
                      <span className="text-sm font-bold text-white">{threat.competitor}</span>
                      <span className={`text-[9px] font-bold ml-auto ${ss.labelClass}`}>{ss.label}</span>
                    </div>
                    <p className="text-[11px] font-semibold text-slate-300 mb-1">Owns: {threat.owns}</p>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{threat.signal}</p>
                  </div>
                )
              })}
            </div>
          </Section>
        </div>

        {/* ── Section 6: Hustle Search Position ── */}
        <Section className="border-indigo-800/40 bg-indigo-950/10">
          <H2 sub="Where Hustle stands in each category — and what to do">Hustle Search Position</H2>
          <div className="grid grid-cols-3 gap-3">
            {HUSTLE_POSITION.map((pos) => {
              const ps = POS_STYLE[pos.status]
              return (
                <div key={pos.category} className="bg-slate-800/40 rounded-lg p-4 border border-slate-700/40">
                  {/* Header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span>{pos.icon}</span>
                      <span className="text-sm font-bold text-white">{pos.category}</span>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold border ${ps.badge}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${ps.dot}`} />
                      {pos.status}
                    </span>
                  </div>

                  {/* Owned keywords */}
                  {pos.ownedKeywords.length > 0 && (
                    <div className="mb-2">
                      <p className="text-[9px] font-bold tracking-widest text-slate-600 uppercase mb-1">Targeting</p>
                      <div className="space-y-0.5">
                        {pos.ownedKeywords.map(kw => (
                          <div key={kw} className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-indigo-500 shrink-0" />
                            <span className="text-[11px] text-slate-300">{kw}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Gaps */}
                  {pos.gaps.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[9px] font-bold tracking-widest text-orange-600 uppercase mb-1">Missing</p>
                      <div className="space-y-0.5">
                        {pos.gaps.map(g => (
                          <div key={g} className="flex items-center gap-1.5">
                            <div className="w-1 h-1 rounded-full bg-orange-500/60 shrink-0" />
                            <span className="text-[11px] text-slate-500">{g}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Recommendation */}
                  <div className="pt-2.5 border-t border-slate-700/40">
                    <p className="text-[10px] font-bold text-indigo-400 mb-1">Recommended Action</p>
                    <p className="text-[11px] text-slate-400 leading-relaxed">{pos.action}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </Section>

        {/* ── Data Sources Footer ── */}
        <div className="text-[10px] text-slate-700 flex flex-wrap gap-4 pb-2">
          <span>Sources: Competitor course pages · Meta ad copy · Google Ads Transparency · MySkillsFuture listings · Google search results · Blog titles · Meta descriptions</span>
          <span className="ml-auto">Updated: 22 Jun 2026</span>
        </div>

      </div>
    </AppLayout>
  )
}
