import { UnprocessedBillsView } from '@/components/dms/unprocessed-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Unprocessed Bills — DistriFlow' }

export default function UnprocessedPage() {
  return <UnprocessedBillsView />
}
