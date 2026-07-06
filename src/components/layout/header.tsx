'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { LogOut, User, ChevronDown } from 'lucide-react'
import { LastUpdated } from './last-updated'
import { LiveDataIndicator } from './live-data-indicator'

interface HeaderProps {
  title?: string
  /** @deprecated superseded by <LastUpdated /> which reads /api/refresh/status directly */
  lastUpdated?: string | null
  userEmail?: string | null
  userInitial?: string | null
}

export function Header({ title = 'Intel', userEmail, userInitial }: HeaderProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const router = useRouter()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/auth/login')
  }

  return (
    <header className="h-14 shrink-0 border-b border-slate-800 flex items-center justify-between px-6 pl-14 md:pl-6 bg-[#09090f]/90 backdrop-blur sticky top-0 z-30">
      {/* Left: Page title */}
      <div className="flex items-center gap-3 min-w-0">
        <h1 className="text-base font-semibold text-white truncate">{title}</h1>
      </div>

      {/* Right: freshness + user menu */}
      <div className="flex items-center gap-1.5 shrink-0">
        <LastUpdated />
        <LiveDataIndicator variant="compact" />

        <div className="relative">
        <button
          onClick={() => setDropdownOpen((prev) => !prev)}
          className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-indigo-500/30 border border-indigo-500/40 flex items-center justify-center text-indigo-300 font-semibold text-xs">
            {userInitial ?? <User className="h-3.5 w-3.5" />}
          </div>
          <span className="hidden sm:block text-sm text-slate-300 max-w-[140px] truncate">
            {userEmail ?? 'User'}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-slate-500" />
        </button>

        {dropdownOpen && (
          <>
            {/* Backdrop */}
            <div
              className="fixed inset-0 z-10"
              onClick={() => setDropdownOpen(false)}
            />
            {/* Dropdown */}
            <div className="absolute right-0 top-full mt-1 w-52 bg-slate-900 border border-slate-700 rounded-lg shadow-xl z-20 py-1">
              <div className="px-4 py-2.5 border-b border-slate-700/50">
                <p className="text-xs font-medium text-white truncate">
                  {userEmail ?? 'User'}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">Hustle SG</p>
              </div>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          </>
        )}
        </div>
      </div>
    </header>
  )
}
