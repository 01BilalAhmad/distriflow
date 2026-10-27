/**
 * RECOVERY UI HELPERS — pure, unit-testable functions.
 * Route Recovery sheet ke client-side filtering/sorting/rounding/aging logic.
 * Koi React/db import nahi — vitest mein direct test hoti hain (audit 2-d: money math tested).
 */

import type { RecoveryShopDTO } from './dms-types'

export type SortKey = 'amount-desc' | 'amount-asc' | 'name-asc' | 'age-desc'

/**
 * Amount ko `step` (100/1000) par DOWN round karta hai.
 * Wasooli mein round DOWN safe hai — kabhi balance se upar nahi ja sakta.
 * roundDownTo(206308.36, 100) -> 206300; roundDownTo(97.5, 100) -> 0
 */
export function roundDownTo(amount: number, step: number): number {
  if (!(amount > 0) || !(step > 0)) return 0
  const clean = Math.round(amount * 100) / 100
  return Math.floor(clean / step) * step
}

export type AgingTone = 'fresh' | 'warn' | 'hot' | 'critical'

export interface AgingBucket {
  days: number
  label: string
  tone: AgingTone
}

/**
 * Udhaar ki umar ka bucket — booker ko priority signal (purana udhaar pehle).
 * <30 fresh | 30-59 warn (amber) | 60-89 hot (orange) | 90+ critical (red)
 */
export function agingBucket(days: number): AgingBucket {
  const d = Math.max(0, Math.round(days || 0))
  if (d >= 90) return { days: d, label: '90+ din', tone: 'critical' }
  if (d >= 60) return { days: d, label: '60+ din', tone: 'hot' }
  if (d >= 30) return { days: d, label: '30+ din', tone: 'warn' }
  return { days: d, label: d > 0 ? `${d} din` : 'Naya', tone: 'fresh' }
}

export interface LedgerMiniEntry {
  date: string | Date
  type: string // DEBIT | CREDIT
  amount: number
}

/**
 * FIFO waterfall — ledger entries (date asc sort kar ke) se "oldest unpaid debit" ki umar.
 * Balance positive ho jaye (debit > credit) to wahan se udhaar "khula" — jab tak
 * credit balance 0/negative na le aaye, wahi oldest date outstanding ki date rehti hai.
 * Advance (negative balance) par aging reset — naya debit naya start hai.
 * LedgerMiniEntry[] poori history hai — OutletLedger.date se chalti hai.
 */
export function oldestUnpaidDays(entries: readonly LedgerMiniEntry[], now: Date = new Date()): number {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  let balance = 0
  let openFrom: Date | null = null
  for (const e of sorted) {
    balance += e.type === 'DEBIT' ? e.amount : -e.amount
    if (balance > 0.005) {
      if (!openFrom) openFrom = new Date(e.date)
    } else {
      openFrom = null
    }
  }
  if (!openFrom) return 0
  return Math.max(0, Math.floor((now.getTime() - openFrom.getTime()) / 86400000))
}

/**
 * Route sheet ka client-side search + sort.
 * Query: shop name/code/city/channel — substring, case-insensitive.
 * Sort: amount-desc (default — bara udhaar pehle) | amount-asc | name-asc | age-desc (purana udhaar pehle).
 * Kabhi bhi input array mutate nahi karta — hamesha nayi copy return karta hai.
 */
export function filterSortShops<
  T extends Pick<RecoveryShopDTO, 'name' | 'code' | 'city' | 'channel' | 'balance'> & { udhaarAgeDays?: number },
>(shops: readonly T[], query: string, sort: SortKey): T[] {
  const q = query.trim().toLowerCase()
  const filtered = q
    ? shops.filter((s) => `${s.name} ${s.code} ${s.city} ${s.channel}`.toLowerCase().includes(q))
    : [...shops]
  const byAge = (s: T) => s.udhaarAgeDays ?? 0
  switch (sort) {
    case 'amount-asc':
      return filtered.sort((a, b) => a.balance - b.balance)
    case 'name-asc':
      return filtered.sort((a, b) => a.name.localeCompare(b.name))
    case 'age-desc':
      return filtered.sort((a, b) => byAge(b) - byAge(a) || b.balance - a.balance)
    case 'amount-desc':
    default:
      return filtered.sort((a, b) => b.balance - a.balance)
  }
}
