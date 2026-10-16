import { PJPView } from '@/components/dms/pjp-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'PJP / Routes — DistriFlow' }

export default function PjpPage() {
  return <PJPView />
}
