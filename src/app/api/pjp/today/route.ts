import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { getTenantIdForSalesman, getPjpSettings, karachiDayCode, karachiDayBounds, dayMatches } from '@/lib/dms-pjp'

/**
 * Task 82: AAJ KI ROUTE — AUTO (manual daily plan khatam).
 *
 * GET /api/pjp/today?userId=<salesmanId>
 *  - Outlet pe assign booker + visitDays se aaj ki shops compute hoti hain (empty visitDays = har roz)
 *  - PJPPlan + Visits AUTO get-or-create hote hain (check-in/out + tracking isi se chalta hai)
 *  - Jumma OFF (admin toggle): fridayOff=true + visits [] — booker sirf unplanned order kar sakta hai
 *  - unplannedEnabled flag bhi — Shops tab "Unplanned Shop" button isi se
 */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'SALESMAN') return jsonError('Sirf order booker ki aaj ki route hoti hai', 403)

    const dayCode = karachiDayCode()
    const { start, end } = karachiDayBounds()
    const tenantId = await getTenantIdForSalesman(user.id)
    const pjp = await getPjpSettings(tenantId)
    const fridayOffNow = pjp.fridayOff && dayCode === 'FRI'

    if (fridayOffNow) {
      // Jumma OFF — plan nahi banta, koi planned shop nazar nahi aati (roz wali bhi)
      return Response.json({
        dayCode,
        fridayOff: true,
        unplannedEnabled: pjp.unplannedEnabled,
        planId: null,
        visits: [],
      })
    }

    // ---- Aaj ki route outlets: assigned booker + (din match ya koi din assign nahi) ----
    const assigned = await db.outlet.findMany({
      where: { salesmanId: user.id, isActive: true },
      select: { id: true, name: true, code: true, channel: true, address: true, lat: true, lng: true, visitDays: true },
      orderBy: { code: 'asc' },
    })
    const routeOutlets = assigned.filter((o) => dayMatches(o.visitDays, dayCode))

    // ---- Plan get-or-create (sync: assignment badle to visits update) ----
    let plan = await db.pJPPlan.findFirst({ where: { salesmanId: user.id, date: { gte: start, lt: end } } })
    if (!plan) {
      plan = await db.pJPPlan.create({ data: { salesmanId: user.id, date: start, status: 'PLANNED' } })
    }

    const existing = await db.visit.findMany({ where: { planId: plan.id } })
    const routeIds = new Set(routeOutlets.map((o) => o.id))
    const existingIds = new Set(existing.map((v) => v.outletId))

    // Naye assigned outlets ke visits banao
    const missing = routeOutlets.filter((o) => !existingIds.has(o.id))
    // Route se nikal chuki PENDING visits hatao (CHECKED_IN/COMPLETED history rehne do)
    const staleIds = existing.filter((v) => v.status === 'PENDING' && !routeIds.has(v.outletId)).map((v) => v.id)
    await db.$transaction([
      ...missing.map((o, i) => db.visit.create({ data: { planId: plan!.id, outletId: o.id, sequence: 1000 + i } })),
      ...staleIds.map((id) => db.visit.delete({ where: { id } })),
    ])

    // Sequence normalize (route order = outlet code order)
    const freshVisits = await db.visit.findMany({
      where: { planId: plan.id },
      include: { outlet: { select: { name: true, code: true, channel: true, address: true, lat: true, lng: true } } },
      orderBy: { sequence: 'asc' },
    })
    const orderById = new Map(routeOutlets.map((o, i) => [o.id, i]))
    freshVisits.sort((a, b) => (orderById.get(a.outletId) ?? 999) - (orderById.get(b.outletId) ?? 999))
    for (let i = 0; i < freshVisits.length; i++) {
      if (freshVisits[i].sequence !== i + 1) {
        await db.visit.update({ where: { id: freshVisits[i].id }, data: { sequence: i + 1 } })
        freshVisits[i].sequence = i + 1
      }
    }

    return Response.json({
      dayCode,
      fridayOff: false,
      unplannedEnabled: pjp.unplannedEnabled,
      planId: plan.id,
      visits: freshVisits.map((v) => ({
        id: v.id,
        outletId: v.outletId,
        outletName: v.outlet.name,
        outletCode: v.outlet.code,
        channel: v.outlet.channel,
        area: v.outlet.address,
        sequence: v.sequence,
        status: v.status,
        checkInAt: v.checkInAt ? new Date(v.checkInAt).toISOString() : null,
        checkOutAt: v.checkOutAt ? new Date(v.checkOutAt).toISOString() : null,
        checkInLat: v.checkInLat,
        checkInLng: v.checkInLng,
        notes: v.notes,
        lat: v.outlet.lat,
        lng: v.outlet.lng,
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Aaj ki route load failed', 500)
  }
}
