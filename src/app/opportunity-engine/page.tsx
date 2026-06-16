import { AppLayout } from '@/components/layout/app-layout'
import { OpportunityEngineClient } from './client'

export const revalidate = 0

export default function OpportunityEnginePage() {
  return (
    <AppLayout title="Opportunity Engine">
      <OpportunityEngineClient />
    </AppLayout>
  )
}
