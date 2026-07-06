import { AppLayout } from '@/components/layout/app-layout'
import { createClient } from '@/lib/supabase/server'
import { getSourceStatuses } from '@/lib/services/data-sources'
import type { UserRole } from '@/lib/types'
import { DataSourcesTable } from './data-sources-table'

export const revalidate = 0

export default async function DataSourcesPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: userData } = user
    ? await supabase.from('users').select('role').eq('id', user.id).maybeSingle()
    : { data: null }

  const role: UserRole = (userData?.role as UserRole) ?? 'viewer'
  const isAdmin = role === 'admin'

  const sources = await getSourceStatuses()

  return (
    <AppLayout title="Data Sources">
      <div className="space-y-4 max-w-7xl">
        <div>
          <h1 className="text-base font-semibold text-white">Data Source Transparency</h1>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            Every metric in this app comes from a source listed below — a live API, a scraper, a manual
            snapshot, or a static entry. Statuses reflect the most recent test or refresh run.
          </p>
        </div>

        <DataSourcesTable initialSources={sources} isAdmin={isAdmin} />
      </div>
    </AppLayout>
  )
}
