import { Sidebar } from './sidebar'
import { Header } from './header'
import { createClient } from '@/lib/supabase/server'

interface AppLayoutProps {
  children: React.ReactNode
  title: string
  lastUpdated?: string | null
}

export async function AppLayout({ children, title, lastUpdated }: AppLayoutProps) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  // Get unread alert count
  const { count: unreadAlerts } = await supabase
    .from('alerts')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)
    .eq('is_dismissed', false)

  const userEmail = user?.email ?? null
  const userInitial = userEmail ? userEmail[0].toUpperCase() : null

  return (
    <div className="min-h-screen bg-background">
      <Sidebar unreadAlerts={unreadAlerts ?? 0} />
      <div className="ml-60">
        <Header
          title={title}
          lastUpdated={lastUpdated}
          userEmail={userEmail}
          userInitial={userInitial}
        />
        <main className="p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
