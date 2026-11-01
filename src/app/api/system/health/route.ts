import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { distributorsUnderMaintenance, getGlobalMaintenance } from '@/lib/maintenance'

/**
 * Task 128 — SYSTEM HEALTH aggregate (MEGA_ADMIN only, portal-only monitoring).
 *
 * Ek hi GET par System Health page ka poora data:
 *   db          — ping + latency (Vercel Postgres round-trip)
 *   errors      — 1h/24h counters (ERROR vs WARN) + top failing routes
 *   maintenance — global window + per-distributor list
 *   recent      — aakhri 50 error rows (naye pehle)
 */

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    if (auth.user.role !== 'MEGA_ADMIN') return jsonError('Only the Mega Admin can view system health', 403)

    // ---- DB ping + latency ----
    const t0 = Date.now()
    let dbOk = true
    try {
      await db.$queryRaw`SELECT 1`
    } catch {
      dbOk = false
    }
    const dbLatencyMs = Date.now() - t0

    const now = Date.now()
    const h1 = new Date(now - 60 * 60 * 1000)
    const h24 = new Date(now - 24 * 60 * 60 * 1000)

    // ---- Error counters (parallel) ----
    const [err1h, err24h, warn24h, top, recent] = await Promise.all([
      db.errorLog.count({ where: { level: 'ERROR', createdAt: { gte: h1 } } }),
      db.errorLog.count({ where: { level: 'ERROR', createdAt: { gte: h24 } } }),
      db.errorLog.count({ where: { level: 'WARN', createdAt: { gte: h24 } } }),
      db.errorLog.groupBy({
        by: ['route'],
        where: { createdAt: { gte: h24 } },
        _count: { route: true },
        orderBy: { _count: { route: 'desc' } },
        take: 5,
      }),
      db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
    ])

    const maintenanceGlobal = await getGlobalMaintenance()
    const maintenanceUsers = await distributorsUnderMaintenance()

    return Response.json({
      db: { ok: dbOk, latencyMs: dbLatencyMs },
      errors: {
        last1h: err1h,
        last24h: err24h,
        warn24h,
        top: top.map((t) => ({ route: t.route ?? '(unknown)', count: t._count.route })),
      },
      maintenance: {
        global: maintenanceGlobal ? { until: maintenanceGlobal.until.toISOString(), note: maintenanceGlobal.note } : null,
        users: maintenanceUsers,
      },
      recent: recent.map((e) => ({
        id: e.id,
        level: e.level,
        source: e.source,
        route: e.route,
        method: e.method,
        message: e.message,
        createdAt: e.createdAt.toISOString(),
      })),
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error(e)
    return jsonError('System health check failed', 500)
  }
}
