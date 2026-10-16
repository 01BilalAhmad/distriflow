import { PurchaseEntryView } from '@/components/dms/purchase-entry-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Purchase Entry — DistriFlow' }

export default function PurchaseEntryPage() {
  return <PurchaseEntryView />
}
