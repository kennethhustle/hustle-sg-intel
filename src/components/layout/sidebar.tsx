'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Activity,
  Megaphone,
  Search,
  Users,
  GraduationCap,
  Zap,
  Settings,
  Menu,
  X,
  ChevronRight,
  Radio,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { LiveDataIndicator } from './live-data-indicator'

// ─── Nav structure ────────────────────────────────────────────────────────────
const NAV_ITEMS = [
  {
    label:    'Social Media Intel',
    href:     '/social-intelligence',
    icon:     Activity,
    question: 'Who is winning attention?',
    // Tailwind colour tokens — must be complete class strings (not dynamic)
    dot:      'bg-sky-400',
    iconActive:   'text-sky-400',
    iconInactive: 'text-sky-600',
    border:   'border-l-sky-400',
    bg:       'bg-sky-400/8',
    labelActive: 'text-sky-300',
  },
  {
    label:    'Ads Performance Intel',
    href:     '/marketing-intelligence',
    icon:     Megaphone,
    question: 'Who is buying market attention?',
    dot:      'bg-orange-400',
    iconActive:   'text-orange-400',
    iconInactive: 'text-orange-600',
    border:   'border-l-orange-400',
    bg:       'bg-orange-400/8',
    labelActive: 'text-orange-300',
  },
  {
    label:    'SEO Intel',
    href:     '/search-intelligence',
    icon:     Search,
    question: 'Who owns search demand?',
    dot:      'bg-emerald-400',
    iconActive:   'text-emerald-400',
    iconInactive: 'text-emerald-600',
    border:   'border-l-emerald-400',
    bg:       'bg-emerald-400/8',
    labelActive: 'text-emerald-300',
  },
  {
    label:    'Hiring Intel',
    href:     '/hiring-intelligence',
    icon:     Users,
    question: 'Where are competitors investing?',
    dot:      'bg-violet-400',
    iconActive:   'text-violet-400',
    iconInactive: 'text-violet-600',
    border:   'border-l-violet-400',
    bg:       'bg-violet-400/8',
    labelActive: 'text-violet-300',
  },
  {
    label:    'MySF Intel',
    href:     '/course-intelligence',
    icon:     GraduationCap,
    question: 'What courses does the market want?',
    dot:      'bg-rose-400',
    iconActive:   'text-rose-400',
    iconInactive: 'text-rose-600',
    border:   'border-l-rose-400',
    bg:       'bg-rose-400/8',
    labelActive: 'text-rose-300',
  },
  {
    label:    'Opportunity Engine',
    href:     '/opportunity-engine',
    icon:     Zap,
    question: 'What should Hustle do next?',
    dot:      'bg-amber-400',
    iconActive:   'text-amber-400',
    iconInactive: 'text-amber-600',
    border:   'border-l-amber-400',
    bg:       'bg-amber-400/8',
    labelActive: 'text-amber-300',
  },
] as const

// ─── Component ────────────────────────────────────────────────────────────────
export function Sidebar() {
  const pathname  = usePathname()
  const [open, setOpen] = useState(false)

  // Close drawer on route change (mobile)
  useEffect(() => { setOpen(false) }, [pathname])

  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  const SidebarContent = () => (
    <div className="flex flex-col h-full">

      {/* ── Branding ── */}
      <div className="px-5 pt-5 pb-4 border-b border-slate-800/80">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-[11px] font-black tracking-[0.2em] text-white uppercase">
                Hustle
              </span>
              <span className="text-slate-600 text-[11px] font-light">/</span>
              <span className="text-[11px] font-black tracking-[0.2em] text-indigo-400 uppercase">
                Intel
              </span>
            </div>
            <p className="text-[10px] text-slate-600 tracking-wide uppercase">
              Competitive Intelligence Platform
            </p>
          </div>
          {/* Mobile close button */}
          <button
            onClick={() => setOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-slate-500 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Live data indicator */}
        <LiveDataIndicator />
      </div>

      {/* ── Navigation ── */}
      <nav className="flex-1 py-3 overflow-y-auto px-2 space-y-0.5 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-slate-800">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive =
            pathname === item.href ||
            pathname.startsWith(item.href + '/')

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'group relative flex items-start gap-3 px-3 py-3 rounded-lg transition-all duration-150',
                'border-l-2',
                isActive
                  ? [item.bg, item.border, 'border-l-2']
                  : 'border-l-transparent hover:bg-slate-800/50 hover:border-l-slate-700'
              )}
            >
              {/* Icon */}
              <div className="shrink-0 mt-0.5">
                <Icon
                  className={cn(
                    'h-4 w-4 transition-colors',
                    isActive ? item.iconActive : cn(item.iconInactive, 'group-hover:text-slate-400')
                  )}
                />
              </div>

              {/* Label + question */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-[11px] font-bold tracking-wider uppercase leading-tight',
                      isActive ? item.labelActive : 'text-slate-400 group-hover:text-slate-200'
                    )}
                  >
                    {item.label}
                  </span>
                  {isActive && (
                    <ChevronRight className={cn('h-3 w-3 shrink-0', item.iconActive)} />
                  )}
                </div>
                <p className={cn(
                  'text-[10px] leading-snug mt-0.5 transition-colors',
                  isActive ? 'text-slate-500' : 'text-slate-700 group-hover:text-slate-500'
                )}>
                  {item.question}
                </p>
              </div>
            </Link>
          )
        })}
      </nav>

      {/* ── Divider ── */}
      <div className="mx-4 border-t border-slate-800/80" />

      {/* ── Bottom: Settings ── */}
      <div className="px-2 py-3 space-y-0.5">
        <Link
          href="/settings"
          className={cn(
            'group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors border-l-2',
            pathname === '/settings'
              ? 'bg-slate-800 border-l-slate-500 text-slate-200'
              : 'border-l-transparent text-slate-600 hover:text-slate-300 hover:bg-slate-800/50'
          )}
        >
          <Settings className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] font-semibold tracking-wider uppercase">Settings</span>
        </Link>
        <Link
          href="/settings/data-sources"
          className={cn(
            'group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors border-l-2',
            pathname === '/settings/data-sources'
              ? 'bg-slate-800 border-l-slate-500 text-slate-200'
              : 'border-l-transparent text-slate-600 hover:text-slate-300 hover:bg-slate-800/50'
          )}
        >
          <Radio className="h-3.5 w-3.5 shrink-0" />
          <span className="text-[11px] font-semibold tracking-wider uppercase">Data Sources</span>
        </Link>
      </div>

      {/* ── Footer ── */}
      <div className="px-5 pb-4 pt-1">
        <p className="text-[9px] text-slate-700 font-mono tracking-wide">
          HUSTLE SG · INTERNAL TOOL · {new Date().getFullYear()}
        </p>
      </div>

    </div>
  )

  return (
    <>
      {/* ── Mobile: hamburger toggle ── */}
      <button
        onClick={() => setOpen(true)}
        className={cn(
          'fixed top-3.5 left-4 z-50 p-2 rounded-lg bg-slate-900 border border-slate-800',
          'text-slate-400 hover:text-white hover:bg-slate-800 transition-colors',
          'md:hidden',
          open && 'hidden'
        )}
        aria-label="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>

      {/* ── Mobile: backdrop overlay ── */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* ── Sidebar panel ── */}
      <aside
        className={cn(
          // Layout
          'fixed left-0 top-0 h-screen w-64 z-50',
          // Style
          'bg-[#09090f] border-r border-slate-800/80',
          // Desktop: always visible
          'md:translate-x-0',
          // Mobile: slide in/out
          'transition-transform duration-200 ease-in-out',
          open ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        <SidebarContent />
      </aside>
    </>
  )
}
