import type { ViewKey } from '@/lib/dms-store'

/**
 * Task 65 — Har ViewKey ka apna URL route. Shell navigation in par router.push karta
 * hai; refresh par pathname se view wapas milta hai (dashboard redirect khatam).
 */
export const VIEW_PATH: Record<ViewKey, string> = {
  'mega-accounts': '/mega-accounts',
  backup: '/backup',
  dashboard: '/',
  orders: '/orders',
  unprocessed: '/unprocessed',
  summaries: '/summaries',
  settlement: '/settlement',
  ledgers: '/ledgers',
  recovery: '/recovery',
  inventory: '/inventory',
  products: '/products',
  companies: '/companies',
  'purchase-entry': '/purchase-entry',
  outlets: '/outlets',
  // Task 85 — booker-tagged new shops (admin approval)
  'new-shops': '/new-shops',
  distributors: '/distributors',
  pjp: '/pjp',
  'visit-map': '/visit-map',
  'field-force': '/field-force',
  schemes: '/schemes',
  returns: '/returns',
  // Task 69 — Reports apna poora module: har report ka apna URL (bookmark/copy-link friendly)
  reports: '/reports',
  'reports-sales-profit': '/reports/sales-profit',
  'reports-sku-profit': '/reports/sku-profit',
  'reports-zero-purchase': '/reports/zero-purchase',
  'reports-tax': '/reports/tax',
  'reports-recovery': '/reports/recovery',
  'reports-targets': '/reports/targets',
  'reports-stock': '/reports/stock',
  'reports-booker-perf': '/reports/booker-perf',
  'reports-company-purchase': '/reports/company-purchase',
  'reports-returns-claims': '/reports/returns-claims',
  'reports-top-shops': '/reports/top-shops',
  'sales-app': '/sales-app',
  // Task 78 — distributor apni profile (bill print ka naam/cell) + tax/GST settings
  settings: '/settings',
}

/** pathname → ViewKey (pehla segment; /reports/<tab> 2-segment special case).
 * Unknown ho to null — shell home par bhej dega. */
export function viewFromPath(pathname: string): ViewKey | null {
  if (!pathname || pathname === '/') return 'dashboard'
  const parts = pathname.replace(/^\/+/, '').split('/')
  const seg = '/' + parts[0]
  // Task 69: /reports/sales-profit jaisa 2-segment path pehle report sub-key se match karo
  if (seg === '/reports' && parts[1]) {
    const sub = ('reports-' + parts[1]) as ViewKey
    if (sub !== 'reports' && VIEW_PATH[sub]) return sub
  }
  for (const key of Object.keys(VIEW_PATH) as ViewKey[]) {
    const p = VIEW_PATH[key]
    if (p !== '/' && p === seg) return key
  }
  return null
}
