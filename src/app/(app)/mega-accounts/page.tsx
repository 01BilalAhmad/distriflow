import { MegaAccountsView } from '@/components/dms/mega-accounts-view'

// Task 65 — har section ka apna alag secure page (URL bookmark/refresh friendly).
// Auth: middleware (signed cookie) + shell role guard is page ko protect karte hain.
export const metadata = { title: 'Distributor Accounts — DistriFlow' }

export default function MegaAccountsPage() {
  return <MegaAccountsView />
}
