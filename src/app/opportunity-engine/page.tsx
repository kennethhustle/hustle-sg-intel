import { AppLayout } from '@/components/layout/app-layout'
import { ModuleStatus } from '@/components/dashboard/module-status'
import { SourcePanel } from '@/components/dashboard/source-panel'
import { OpportunityEngineClient } from './client'

export const revalidate = 0

export default function OpportunityEnginePage() {
  return (
    <AppLayout title="Opportunity Engine">
      <ModuleStatus module="ai_insights" sourceLabel="AI-generated from cached intelligence" badgeKind="ai" />
      <OpportunityEngineClient />
      <div className="mt-6">
        <SourcePanel module="opportunity_engine" />
      </div>
    </AppLayout>
  )
}
