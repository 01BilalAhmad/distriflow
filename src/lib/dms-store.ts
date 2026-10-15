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
  | 'sales-app'

interface DMSState {
  user: SessionUser | null
  activeView: ViewKey
  /** summary to auto-open / auto-select when switching views */
  focusSummaryId: string | null
  /** Task 49: purchase entry full page — kis company ki invoice book karni hai (null = free select) */
  purchaseCompanyId: string | null
  /** Task 49: purchase entry form mein adhoora data mojood hai — nav guard isko dekhta hai */
  purchaseDraftDirty: boolean
  setUser: (u: SessionUser | null) => void
  setActiveView: (v: ViewKey) => void
  setFocusSummary: (id: string | null) => void
  setPurchaseCompanyId: (id: string | null) => void
  setPurchaseDraftDirty: (d: boolean) => void
  /** Task 49: companies view se purchase entry full page kholne ka single entry point */
  openPurchaseEntry: (companyId: string | null) => void
}

export const useDMS = create<DMSState>((set) => ({
  user: null,
  activeView: 'dashboard',
  focusSummaryId: null,
  purchaseCompanyId: null,
  purchaseDraftDirty: false,
  setUser: (u) => set({ user: u }),
  setActiveView: (v) => set({ activeView: v }),
  setFocusSummary: (id) => set({ focusSummaryId: id }),
  setPurchaseCompanyId: (id) => set({ purchaseCompanyId: id }),
  setPurchaseDraftDirty: (d) => set({ purchaseDraftDirty: d }),
  openPurchaseEntry: (companyId) => set({ purchaseCompanyId: companyId, activeView: 'purchase-entry' }),
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
