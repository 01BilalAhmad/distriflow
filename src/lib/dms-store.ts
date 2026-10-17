'use client'

import { create } from 'zustand'
import type { SessionUser } from '@/lib/dms-types'

export type ViewKey =
  | 'mega-accounts'
  | 'backup'
  | 'dashboard'
  | 'orders'
  | 'unprocessed'
  | 'summaries'
  | 'settlement'
  | 'ledgers'
  | 'recovery'
  | 'inventory'
  | 'products'
  | 'companies'
  | 'purchase-entry'
  | 'outlets'
  | 'distributors'
  | 'pjp'
  | 'visit-map'
  | 'field-force'
  | 'schemes'
  | 'returns'
  | 'reports'
  | 'reports-sales-profit'
  | 'reports-zero-purchase'
  | 'reports-tax'
  | 'reports-recovery'
  | 'reports-targets'
  | 'reports-stock'
  | 'reports-booker-perf'
  | 'reports-company-purchase'
  | 'reports-returns-claims'
  | 'reports-top-shops'
  | 'sales-app'

/**
 * Task 65 — activeView zustand se HATA diya. Har section ka apna URL route hai
 * (/, /orders, /products ...) — browser refresh par wahi section wapas milta hai
 * (dashboard redirect khatam). Cross-view "focus" states (focusSummaryId,
 * purchaseCompanyId) SPA memory mein hi rehte hain — route push ke sath set karke
 * jate hain, target view mount par consume karta hai.
 */
interface DMSState {
  user: SessionUser | null
  /** summary to auto-open / auto-select when switching views */
  focusSummaryId: string | null
  /** Task 49: purchase entry full page — kis company ki invoice book karni hai (null = free select) */
  purchaseCompanyId: string | null
  /** Task 49: purchase entry form mein adhoora data mojood hai — nav guard isko dekhta hai */
  purchaseDraftDirty: boolean
  /** Task 67: shop se order book karna — Outlets/Zero-Purchase par "Order Book" dabate hi
   * ye set hota hai, /orders mount par New Order dialog is outlet ke sath khulta hai */
  focusOrderOutletId: string | null
  setUser: (u: SessionUser | null) => void
  setFocusSummary: (id: string | null) => void
  setPurchaseCompanyId: (id: string | null) => void
  setPurchaseDraftDirty: (d: boolean) => void
  setFocusOrderOutlet: (id: string | null) => void
}

export const useDMS = create<DMSState>((set) => ({
  user: null,
  focusSummaryId: null,
  purchaseCompanyId: null,
  purchaseDraftDirty: false,
  focusOrderOutletId: null,
  setUser: (u) => set({ user: u }),
  setFocusSummary: (id) => set({ focusSummaryId: id }),
  setPurchaseCompanyId: (id) => set({ purchaseCompanyId: id }),
  setPurchaseDraftDirty: (d) => set({ purchaseDraftDirty: d }),
  setFocusOrderOutlet: (id) => set({ focusOrderOutletId: id }),
}))

export function loadSession(): SessionUser | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem('dms_session')
    if (raw) return JSON.parse(raw) as SessionUser
  } catch {}
  return null
}

export function saveSession(u: SessionUser | null) {
  if (typeof window === 'undefined') return
  if (u) localStorage.setItem('dms_session', JSON.stringify(u))
  else localStorage.removeItem('dms_session')
}
