import { DashboardView } from '@/components/dms/dashboard-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Dashboard — DistriFlow' }

export default function DashboardPage() {
  return <DashboardView />
}
