import { RecoveryView } from '@/components/dms/recovery-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Recovery — DistriFlow' }

export default function RecoveryPage() {
  return <RecoveryView />
}
