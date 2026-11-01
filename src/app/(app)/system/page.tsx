import { SystemHealthView } from '@/components/dms/system-health-view'

// Task 128 — System Health (MEGA_ADMIN only): errors, DB status, maintenance mode.
// Auth: middleware (signed cookie) + shell role guard (NAV roles) is page ko protect karte hain.
export const metadata = { title: 'System Health — DistriFlow' }

export default function SystemPage() {
  return <SystemHealthView />
}
