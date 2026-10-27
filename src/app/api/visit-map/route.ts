import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, salesmanGuard } from '@/lib/api-auth'

/**
 * Task 36 — Visit Map API.
 * GET /api/visit-map?date=YYYY-MM-DD(&salesmanId=)   (Task 95: userId param IGNORE — cookie identity)
 *
 * Day-scoped PJP visits + outlet geo coords for map plotting:
 * - DISTRIBUTOR: apne saare order bookers ke plans (salesmanId filter optional)
 * - SALESMAN: sirf apne plans
 * - MEGA_ADMIN: blocked (business data lock)
 *
 * Stats: planned / checkedIn / completed / missed / coverage% (visited = checked-in + completed).
 */

function dayRange(dateStr: string | null): { gte: Date; lt: Date } {
  // Date-only string ko LOCAL midnight se treat karo (PJP plans date-based hain)
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date()
  const gte = new Date(base)
  gte.setHours(0, 0, 0, 0)
  const lt = new Date(gte)
  lt.setDate(lt.getDate() + 1)
  return { gte, lt }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const dateParam = searchParams.get('date')

    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    // Task 95: SALESMAN hamesha apne plans — doosre booker ka filter 403
    const sg = salesmanGuard(user, searchParams.get('salesmanId'))
    if ('error' in sg) return sg.error
    const salesmanFilter = sg.value

    let scopeSalesmanIds: string[]
    if (user.role === 'SALESMAN') {
      scopeSalesmanIds = [user.id]
    } else {
      if (!user.profile) return jsonError('Distributor profile nahi mila', 404)
      const profileUser = await db.distributorProfile.findUnique({ where: { id: user.profile.id } })
      scopeSalesmanIds = (
        await db.user.findMany({
          where: { role: 'SALESMAN', parentId: profileUser!.userId },
          select: { id: true },
        })
      ).map((u) => u.id)
    }

    const salesmen = await db.user.findMany({
      where: { id: { in: scopeSalesmanIds } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })

    const { gte, lt } = dayRange(dateParam)
    const plans = await db.pJPPlan.findMany({
      where: {
        date: { gte, lt },
        salesmanId: salesmanFilter ? salesmanFilter : { in: scopeSalesmanIds },
      },
      include: {
        salesman: { select: { id: true, name: true } },
        visits: {
          orderBy: { sequence: 'asc' },
          include: {
            outlet: {
              select: { id: true, name: true, code: true, channel: true, address: true, lat: true, lng: true },
            },
          },
        },
      },
    })

    const rows = plans.map((p) => ({
      planId: p.id,
      salesmanId: p.salesmanId,
      salesmanName: p.salesman.name,
      planStatus: p.status,
      visits: p.visits.map((v) => ({
        id: v.id,
        sequence: v.sequence,
        status: v.status,
        checkInAt: v.checkInAt ? new Date(v.checkInAt).toISOString() : null,
        checkOutAt: v.checkOutAt ? new Date(v.checkOutAt).toISOString() : null,
        checkInLat: v.checkInLat,
        checkInLng: v.checkInLng,
        outlet: v.outlet,
      })),
    }))

    let planned = 0
    let checkedIn = 0
    let completed = 0
    let missed = 0
    let withGps = 0
    for (const p of rows) {
      for (const v of p.visits) {
        planned++
        if (v.status === 'COMPLETED') completed++
        else if (v.status === 'CHECKED_IN') checkedIn++
        else if (v.status === 'MISSED') missed++
        if (v.outlet.lat != null && v.outlet.lng != null) withGps++
      }
    }
    const visited = checkedIn + completed
    const coveragePct = planned > 0 ? Math.round((visited / planned) * 100) : 0

    return Response.json({
      date: gte.toISOString(),
      salesmen,
      plans: rows,
      stats: { planned, checkedIn, completed, missed, visited, withGps, coveragePct },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Visit map load failed', 500)
  }
}
