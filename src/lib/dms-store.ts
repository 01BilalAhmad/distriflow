'use client'

import { create } from 'zustand'
import type { SessionUser } from '@/lib/dms-types'

export type ViewKey =
  | 'mega-accounts'
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
  | 'outlets'
  | 'distributors'
  | 'pjp'
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
  setUser: (u: SessionUser | null) => void
  setActiveView: (v: ViewKey) => void
  setFocusSummary: (id: string | null) => void
}

export const useDMS = create<DMSState>((set) => ({
  user: null,
  activeView: 'dashboard',
  focusSummaryId: null,
  setUser: (u) => set({ user: u }),
  setActiveView: (v) => set({ activeView: v }),
  setFocusSummary: (id) => set({ focusSummaryId: id }),
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
