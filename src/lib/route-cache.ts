'use client'

/**
 * Route Start / Offline-first working cache:
 *  - Route Start => us din ki shops + products + recent history localStorage snapshot mein download
 *  - Snapshot ke bina Shops/working nazar nahi aati (booker ko all-time data nahi dikhta — sirf apna started route)
 *  - Offline order/recovery/visit punch => sync queue => internet aane par auto-sync (SalesmanApp loop)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProductDTO, RecoveryRowDTO, RecoveryShopDTO } from '@/lib/dms-types'

export interface RouteSnapshot {
  userId: string
  /** YYYY-MM-DD (local) — jis din ke liye route start hua */
  date: string
  startedAt: string
  allRoutesAllowed: boolean
  shops: RecoveryShopDTO[]
  products: ProductDTO[]
  /** route start ke waqt ki recent history (offline view ke liye) */
  history: RecoveryRowDTO[]
  /** route start ke waqt pending approvals */
  pending: RecoveryRowDTO[]
}

export type QueueKind = 'ORDER' | 'RECOVERY' | 'VISIT'

export interface PendingSync {
  id: string
  kind: QueueKind
  /** UI label — "Shop — Rs 500" etc */
  label: string
  createdAt: string
  url: string
  method: 'POST' | 'PATCH'
  body: string
  tries: number
  lastError?: string
}

const snapKey = (uid: string) => `dms_route_${uid}`
const queueKey = (uid: string) => `dms_sync_queue_${uid}`
const CACHE_EVT = 'dms-route-cache-change'

export const todayStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const isSnapshotToday = (s: RouteSnapshot | null) => !!s && s.date === todayStr()

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CACHE_EVT))
}

function read<T>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}
function write(key: string, v: unknown) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch { /* storage full — ignore */ }
  notify()
}

/* ---------- snapshot ---------- */
export function getSnapshot(userId: string): RouteSnapshot | null {
  return read<RouteSnapshot>(snapKey(userId))
}
export function saveSnapshot(s: RouteSnapshot) {
  write(snapKey(s.userId), s)
}
export function clearSnapshot(userId: string) {
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(snapKey(userId)) } catch { /* ignore */ }
  }
  notify()
}

/* ---------- sync queue ---------- */
export function getQueue(userId: string): PendingSync[] {
  return read<PendingSync[]>(queueKey(userId)) ?? []
}
export function addToQueue(userId: string, item: Omit<PendingSync, 'id' | 'createdAt' | 'tries'>) {
  const q = getQueue(userId)
  q.push({
    ...item,
    id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    tries: 0,
  })
  write(queueKey(userId), q)
}
export function removeFromQueue(userId: string, id: string) {
  write(queueKey(userId), getQueue(userId).filter((x) => x.id !== id))
}
function patchQueueItem(userId: string, id: string, patch: Partial<PendingSync>) {
  write(queueKey(userId), getQueue(userId).map((x) => (x.id === id ? { ...x, ...patch } : x)))
}
export function clearQueue(userId: string) {
  if (typeof window !== 'undefined') {
    try { localStorage.removeItem(queueKey(userId)) } catch { /* ignore */ }
  }
  notify()
}

/** Queue ka har item server par bhejo — success par hatao, fail par lastError ke sath re-queue */
export async function syncQueue(userId: string): Promise<{ synced: number; failed: number }> {
  const q = getQueue(userId)
  let synced = 0
  let failed = 0
  for (const item of q) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: { 'Content-Type': 'application/json' },
        body: item.body,
      })
      if (res.ok) {
        removeFromQueue(userId, item.id)
        synced++
      } else {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        const msg = data.error || `HTTP ${res.status}`
        patchQueueItem(userId, item.id, { tries: item.tries + 1, lastError: msg })
        failed++
      }
    } catch {
      // network down — agla sync (online event / interval) baqi entries dekhega
      patchQueueItem(userId, item.id, { tries: item.tries + 1, lastError: 'Network error — dobara try hoga' })
      failed++
      break
    }
  }
  return { synced, failed }
}

/* ---------- react hook — sab components self-subscribing ---------- */
export function useRouteState(userId: string | undefined) {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const onChange = () => setVersion((v) => v + 1)
    window.addEventListener(CACHE_EVT, onChange)
    return () => window.removeEventListener(CACHE_EVT, onChange)
  }, [])
  const snapshot = useMemo(() => (userId && typeof window !== 'undefined' ? getSnapshot(userId) : null), [userId, version])
  const queue = useMemo(() => (userId && typeof window !== 'undefined' ? getQueue(userId) : []), [userId, version])
  const today = isSnapshotToday(snapshot)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])
  return { snapshot, queue, today, version, refresh }
}

/** Network fail (offline/timeout) vs server validation error — offline queue fallback decide karne ke liye */
export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  return e instanceof TypeError // fetch abort / Failed to fetch
}
