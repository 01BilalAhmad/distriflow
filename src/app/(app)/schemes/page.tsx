import { SchemesView } from '@/components/dms/schemes-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Schemes — DistriFlow' }

export default function SchemesPage() {
  return <SchemesView />
}
