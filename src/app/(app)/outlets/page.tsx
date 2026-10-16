import { OutletsView } from '@/components/dms/outlets-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Outlets — DistriFlow' }

export default function OutletsPage() {
  return <OutletsView />
}
