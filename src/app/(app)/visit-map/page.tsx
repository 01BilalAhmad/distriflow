import { VisitMapView } from '@/components/dms/visit-map'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Visit Map — DistriFlow' }

export default function VisitMapPage() {
  return <VisitMapView />
}
