import { ReturnsClaimsView } from '@/components/dms/returns-claims-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Returns & Claims — DistriFlow' }

export default function ReturnsPage() {
  return <ReturnsClaimsView />
}
