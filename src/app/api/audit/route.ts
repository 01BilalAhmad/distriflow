import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import type { Prisma } from '@prisma/client'

/**
 * GET /api/audit — Task 35: Audit Log viewer API.
 * - DISTRIBUTOR: apni tenant ki poori activity (apni team incl. bookers) + apni khud ki rows
 * - MEGA_ADMIN: sab rows (poora system)
 * - SALESMAN: 403 (booker ko audit view nahi)
 * Params: q (search), action (filter), page (100/page), take (max 500 — backup page 1 row ke liye)
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    if (user.role === 'SALESMAN') return jsonError('Audit log sirf admin ke liye hai', 403)

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') ?? '').trim()
    const action = (searchParams.get('action') ?? '').trim()
    const take = Math.min(500, Math.max(1, Number(searchParams.get('take') ?? '100') || 100))
    const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
    const skip = (page - 1) * take

    const tenantId = user.role === 'DISTRIBUTOR' ? (user.profile?.id ?? null) : null

    const where: Prisma.AuditLogWhereInput = {}
    if (user.role === 'DISTRIBUTOR') {
      // tenant ki activity + apni khud ki (tenant-less rows bhi cover — e.g. mega ne account banaya)
      where.OR = [{ distributorId: tenantId ?? '__none__' }, { userId: user.id }]
    }
    if (action && action !== 'ALL') where.action = action
    if (q) {
      where.AND = [
        {
          OR: [
            { userName: { contains: q, mode: 'insensitive' } },
            { detail: { contains: q, mode: 'insensitive' } },
            { entity: { contains: q, mode: 'insensitive' } },
            { entityId: { contains: q, mode: 'insensitive' } },
            { action: { contains: q, mode: 'insensitive' } },
          ],
        },
      ]
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: take + 1, // hasMore detect
      }),
      db.auditLog.count({ where }),
    ])
    const hasMore = logs.length > take

    return Response.json({
      logs: logs.slice(0, take).map((l) => ({
        id: l.id,
        at: l.createdAt.toISOString(),
        userId: l.userId,
        userName: l.userName,
        userRole: l.userRole,
        action: l.action,
        entity: l.entity,
        entityId: l.entityId,
        detail: l.detail,
        ip: l.ip,
      })),
      total,
      page,
      hasMore,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Audit log load failed', 500)
  }
}
