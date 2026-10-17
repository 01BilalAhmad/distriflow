import { SettingsView } from '@/components/dms/settings-view'

// Task 78 — Settings: distributor profile (bill print ka naam/cell) + bill/tax rates.
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Settings — DistriFlow' }

export default function SettingsPage() {
  return <SettingsView />
}
