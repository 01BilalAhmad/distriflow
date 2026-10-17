import { ReportsView } from '@/components/dms/reports-view'

// Task 69 — har report ka apna URL (/reports/sales-profit, /reports/tax, ...)
// Auth: (app) layout shell (signed cookie + role guard) is page ko protect karta hai.
// Unknown tab → ReportsView khud overview par fall back karta hai.
export const metadata = { title: 'Report — DistriFlow' }

export default async function ReportTabPage({ params }: { params: Promise<{ tab: string }> }) {
  const { tab } = await params
  return <ReportsView tab={tab} />
}
