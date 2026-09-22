'use client'

export async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Task 27: error ke sath structured payload bhi attach (e.g. out-of-stock shortages list)
    const err = new Error((data as { error?: string }).error ?? 'Request failed') as Error & { payload?: unknown }
    err.payload = data
    throw err
  }
  return data as T
}

export function fmtPKR(n: number): string {
  // Hamesha poora number — koi K/Lac/Cr abbreviation nahi (user preference)
  const rounded = Math.round(n * 100) / 100
  const hasCents = Math.abs(rounded % 1) > 0
  return `Rs ${rounded.toLocaleString('en-PK', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })}`
}

export function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-PK')
}

export function fmtDate(iso: string | null | undefined, withTime = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (withTime) return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short' }) + ' ' + d.toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
  PROCESSING: 'bg-violet-50 text-violet-700 border-violet-200',
  PARTIALLY_DELIVERED: 'bg-amber-50 text-amber-700 border-amber-200',
  DELIVERED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CANCELLED: 'bg-red-50 text-red-700 border-red-200',
  PENDING: 'bg-amber-50 text-amber-700 border-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  REJECTED: 'bg-red-50 text-red-700 border-red-200',
  PLANNED: 'bg-slate-100 text-slate-700 border-slate-200',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 border-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CHECKED_IN: 'bg-violet-50 text-violet-700 border-violet-200',
  MISSED: 'bg-red-50 text-red-700 border-red-200',
  UNSETTLED: 'bg-amber-50 text-amber-700 border-amber-200',
  SETTLED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  CASH: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  PARTIAL: 'bg-amber-50 text-amber-700 border-amber-200',
  CREDIT: 'bg-red-50 text-red-700 border-red-200',
}

export function statusLabel(s: string): string {
  const map: Record<string, string> = { PROCESSING: 'In Summary (Van Out)' }
  if (map[s]) return map[s]
  return s.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
}
