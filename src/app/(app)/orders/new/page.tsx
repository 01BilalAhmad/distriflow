import { OrderNewView } from '@/components/dms/order-new-view'

// Task 31 — order booking apna poora page (/orders/new): chhoti dialog ki jagah
// full-page form (purchase-entry Task 49 wala pattern) — draft auto-save + guards.
// Auth: (app) layout shell (signed cookie + role guard) is page ko protect karta hai.
export const metadata = { title: 'New Order — DistriFlow' }

export default function NewOrderPage() {
  return <OrderNewView />
}
