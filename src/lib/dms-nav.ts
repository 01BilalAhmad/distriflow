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
  distributors: '/distributors',
  pjp: '/pjp',
  'visit-map': '/visit-map',
  'field-force': '/field-force',
  schemes: '/schemes',
  returns: '/returns',
  reports: '/reports',
  'sales-app': '/sales-app',
}

/** pathname → ViewKey (pehla segment). Unknown ho to null — shell home par bhej dega. */
export function viewFromPath(pathname: string): ViewKey | null {
  if (!pathname || pathname === '/') return 'dashboard'
  const seg = '/' + pathname.replace(/^\/+/, '').split('/')[0]
  for (const key of Object.keys(VIEW_PATH) as ViewKey[]) {
    const p = VIEW_PATH[key]
    if (p !== '/' && p === seg) return key
  }
  return null
}
