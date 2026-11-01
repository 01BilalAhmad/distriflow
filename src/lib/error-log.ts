/**
 * Task 128 — ERROR CAPTURE (portal-only).
 *
 * Central error log jo MEGA_ADMIN ke System Health page par dikhta hai:
 *   server    — jsonError() se (handled API errors, stack se route nikalta hai)
 *   unhandled — instrumentation.ts onRequestError se (route ka crash)
 *   client    — /api/client-errors + error boundaries se (browser side)
 *
 * Design rules:
 * - Fire-safe: logging ki apni failure business response ko KABHI nahi rokti
 * - Dedupe: same route+message 60s mein ek dafa (serverless per-instance, burst spam rokta hai)
 * - Retention: inserts par ~1% chance se 30 din se purani rows delete (table kabhi nahi bharta)
 * - Privacy: stack top 2KB, message 300 chars — tokens/password is layer mein aate hi nahi
 */

import { db } from '@/lib/db'

export type ErrorSource = 'server' | 'unhandled' | 'client'

interface CaptureInput {
  level: 'ERROR' | 'WARN'
  source: ErrorSource
  message: string
  route?: string | null
  method?: string | null
  stack?: string | null
  userId?: string | null
  distributorId?: string | null
}

const DEDUP_WINDOW_MS = 60_000
const recent = new Map<string, number>()

// Periodic in-memory cleanup (lambi zindagi ke instance par Map na bhare)
let lastSweep = Date.now()
function sweep(now: number) {
  if (now - lastSweep < DEDUP_WINDOW_MS) return
  lastSweep = now
  for (const [k, ts] of recent) {
    if (now - ts > DEDUP_WINDOW_MS) recent.delete(k)
  }
}

/** jsonError/instrumentation stack se route file nikaalo (…/src/app/api/orders/route.ts:42) */
export function routeFromStack(stack: string | null | undefined): string | null {
  if (!stack) return null
  const m = stack.match(/src\/app\/(?:api|\(app\)|login)[^\s)?:]*?(?::\d+)?(?::\d+)?/)
  return m ? m[0].replace(/:\d+$/, '') : null
}

function trim(s: string | null | undefined, max: number): string | null {
  if (!s) return null
  const v = String(s).trim()
  return v ? (v.length > max ? `${v.slice(0, max)}…` : v) : null
}

/** Fire-and-forget capture — hamesha resolve, kabhi throw nahi */
export async function captureError(input: CaptureInput): Promise<void> {
  try {
    const now = Date.now()
    sweep(now)
    const key = `${input.source}:${input.route ?? ''}:${input.level}:${input.message.slice(0, 120)}`
    const last = recent.get(key)
    if (last && now - last < DEDUP_WINDOW_MS) return // burst dedupe
    recent.set(key, now)

    await db.errorLog.create({
      data: {
        level: input.level,
        source: input.source,
        route: trim(input.route ?? null, 200),
        method: trim(input.method ?? null, 10),
        message: trim(input.message, 300) ?? 'Unknown error',
        stack: trim(input.stack, 2000),
        userId: input.userId ?? null,
        distributorId: input.distributorId ?? null,
      },
    })

    // ~1% inserts par 30+ din purani rows saaf (cheap rolling retention)
    if (Math.random() < 0.01) {
      const cutoff = new Date(now - 30 * 24 * 60 * 60 * 1000)
      await db.errorLog.deleteMany({ where: { createdAt: { lt: cutoff } } })
    }
  } catch {
    // logging kabhi business flow nahi todta
  }
}
