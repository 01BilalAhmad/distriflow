import { LedgersView } from '@/components/dms/ledgers-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Shop Ledgers — DistriFlow' }

export default function LedgersPage() {
  return <LedgersView />
}
