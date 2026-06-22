'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Building2,
  TrendingUp,
  Users,
  BookOpen,
  Zap,
  Bell,
  Settings,
  BarChart2,
  Search,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavItem {
  label: string
  href: string
  icon: React.ElementType
  badge?: number | null
}

interface SidebarProps {
  unreadAlerts?: number
}

export function Sidebar({ unreadAlerts }: SidebarProps) {
  const pathname = usePathname()

  const navItems: NavItem[] = [
    { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { label: 'Competitors', href: '/competitors', icon: Building2 },
    { label: 'Social Intelligence', href: '/social-intelligence', icon: TrendingUp },
    { label: 'Marketing Intelligence', href: '/marketing-intelligence', icon: BarChart2 },
    { label: 'Search Intelligence', href: '/search-intelligence', icon: Search },
    { label: 'Hiring Intelligence', href: '/hiring-intelligence', icon: Users },
    { label: 'MySkillsFuture Intelligence', href: '/course-intelligence', icon: BookOpen },
    { label: 'Opportunity Engine', href: '/opportunity-engine', icon: Zap },
    {
      label: 'Alerts',
      href: '/alerts',
      icon: Bell,
      badge: unreadAlerts && unreadAlerts > 0 ? unreadAlerts : null,
    },
    { label: 'Settings', href: '/settings', icon: Settings },
  ]

  return (
    <aside className="fixed left-0 top-0 h-screen w-60 bg-slate-950 border-r border-slate-800 flex flex-col z-40">
      {/* Branding */}
      <div className="px-5 py-5 border-b border-slate-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center shrink-0">
            <TrendingUp className="h-4 w-4 text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white leading-tight">Hustle SG</p>
            <p className="text-xs text-slate-500 leading-tight">Competitors Intel</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <ul className="space-y-0.5">
          {navItems.map((item) => {
            const Icon = item.icon
            const isActive =
              pathname === item.href ||
              (item.href !== '/dashboard' && pathname.startsWith(item.href))

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors group',
                    isActive
                      ? 'bg-indigo-500/15 text-indigo-300 border border-indigo-500/20'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  )}
                >
                  <Icon
                    className={cn(
                      'h-4 w-4 shrink-0',
                      isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'
                    )}
                  />
                  <span className="flex-1">{item.label}</span>
                  {item.badge !== null && item.badge !== undefined && (
                    <span className="inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold">
                      {item.badge > 99 ? '99+' : item.badge}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-slate-800">
        <p className="text-xs text-slate-600">
          Internal tool &middot; Hustle SG &copy; {new Date().getFullYear()}
        </p>
      </div>
    </aside>
  )
}
