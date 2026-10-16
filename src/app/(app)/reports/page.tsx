import { ReportsView } from '@/components/dms/reports-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Reports — DistriFlow' }

export default function ReportsPage() {
  return <ReportsView />
}
