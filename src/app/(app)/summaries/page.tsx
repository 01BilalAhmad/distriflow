import { SummariesView } from '@/components/dms/summaries-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Delivery Summaries — DistriFlow' }

export default function SummariesPage() {
  return <SummariesView />
}
