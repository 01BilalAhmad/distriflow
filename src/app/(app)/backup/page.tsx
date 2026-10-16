import { BackupView } from '@/components/dms/backup-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Backup & Safety — DistriFlow' }

export default function BackupPage() {
  return <BackupView />
}
