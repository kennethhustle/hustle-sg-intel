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
    { label: 'Hiring Intelligence', href: '/hiring-intelligence', icon: Users },
    { label: 'MySkillsFuture Intelligence', href: '/course-intelligence', icon: BookOpen },
