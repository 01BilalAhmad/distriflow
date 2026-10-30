import { AuditView } from '@/components/dms/audit-view'

// Task 35 — Audit Log apna page: website par har activity ka record.
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Audit Log — DistriFlow' }

export default function AuditPage() {
  return <AuditView />
}
