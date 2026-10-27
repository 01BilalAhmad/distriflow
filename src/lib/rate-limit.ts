/**
 * P0 SECURITY (Task 95) — in-memory sliding-window rate limiter.
 *
 * Login endpoint par IP-wise throttling (per-instance). Asli brute-force net
 * account-level lock hai (User.failedAttempts/lockedUntil — DB-backed, saare
 * serverless instances par kaam karta hai); ye IP limiter extra hai.
 *
 * NOTE: Vercel serverless par per-instance memory hai — distributed attack
 * account-lock se rokа jata hai, ye layer spam/hammering ko slow karta hai.
 */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

// Periodic cleanup — lambi zindagi ke instance par memory na bhare
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000
let lastCleanup = Date.now()

function maybeCleanup() {
  const now = Date.now()
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return
  lastCleanup = now
  for (const [k, b] of buckets) {
    if (b.resetAt < now) buckets.delete(k)
  }
}

export interface RateLimitOptions {
  /** Window duration ms (default 5 min) */
  windowMs?: number
  /** Max requests per window (default 10) */
  max?: number
}

export interface RateLimitResult {
  ok: boolean
  retryAfterSec: number
  remaining: number
}

/**
 * Check + consume one hit. `key` e.g. `login:1.2.3.4`.
 * ok=false par 429 ke sath Retry-After bhejo.
 */
export function rateLimit(key: string, opts: RateLimitOptions = {}): RateLimitResult {
  const windowMs = opts.windowMs ?? 5 * 60 * 1000
  const max = opts.max ?? 10
  const now = Date.now()
  maybeCleanup()

  const b = buckets.get(key)
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, retryAfterSec: 0, remaining: max - 1 }
  }
  if (b.count >= max) {
    return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000), remaining: 0 }
  }
  b.count++
  return { ok: true, retryAfterSec: 0, remaining: max - b.count }
}

/** Request ki IP nikaalo (Vercel proxy headers + standard fallbacks) */
export function clientIp(req: Request): string {
  return (
    req.headers.get('x-real-ip') ??
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  )
}
