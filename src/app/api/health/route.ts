import { db } from '@/lib/db'

/**
 * Task 88 (skills audit 2-d#6) — Liveness + DB readiness probe.
 *
 * Uptime monitors, CI smoke tests aur load balancers ke liye ek sasta endpoint:
 *   200 { status: 'ok', db: 'up' }        — app chal raha hai, DB ping OK
 *   503 { status: 'degraded', db: 'down' } — app chal raha hai magar DB nahi mil raha
 *
 * Yeh route jaan-boojh kar AUTH-FREE hai (probe tools cookie nahi bhejte).
 * Koi sensitive data return nahi hota — sirf status + latency.
 *
 * TODO (audit security findings): jab server-side session auth har route par
 * lag jaye gi to bhi is route ko auth-exempt hi rehne dein — health probe ke liye
 * standard practice hai.
 */

export const dynamic = 'force-dynamic'

export async function GET() {
  const startedAt = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return Response.json({
      status: 'ok',
      db: 'up',
      latencyMs: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('[health] DB ping failed:', error)
    return Response.json(
      {
        status: 'degraded',
        db: 'down',
        timestamp: new Date().toISOString(),
      },
      { status: 503 },
    )
  }
}
