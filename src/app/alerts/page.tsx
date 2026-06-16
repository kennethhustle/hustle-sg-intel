import { AppLayout } from '@/components/layout/app-layout'
import { AlertsClient } from './client'

export const revalidate = 0

export default function AlertsPage() {
  return (
    <AppLayout title="Alerts">
      <AlertsClient />
    </AppLayout>
  )
}
