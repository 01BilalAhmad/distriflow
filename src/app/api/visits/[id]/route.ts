import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'

/** Visit check-in / check-out with GPS coordinates */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const body = await req.json()
    const { action, lat, lng, notes } = body

    const visit = await db.visit.findUnique({
      where: { id },
      include: { plan: true, outlet: { select: { distributorId: true, salesmanId: true } } },
    })
    if (!visit) return jsonError('Visit not found', 404)

    // Task 95: ownership — SALESMAN apni plan ki visit (assigned + PJP-planned shops dono);
    // baqi roles outlet ke distributor se tenant check
    if (user.role === 'SALESMAN') {
      if (visit.plan.salesmanId !== user.id) return jsonError('Yeh visit aap ki route ka nahi hai', 403)
    } else {
      const tm = await tenantMismatch(user, visit.outlet.distributorId)
      if (tm) return tm
    }

    if (action === 'CHECK_IN') {
      if (visit.status !== 'PENDING') return jsonError('Visit already started hai')
      const now = new Date()
      await db.visit.update({
        where: { id },
        data: { status: 'CHECKED_IN', checkInAt: now, checkInLat: lat ?? null, checkInLng: lng ?? null },
      })
      await db.pJPPlan.update({ where: { id: visit.planId }, data: { status: 'IN_PROGRESS' } })
      return Response.json({ status: 'CHECKED_IN', checkInAt: now.toISOString() })
    }

    if (action === 'CHECK_OUT') {
      if (visit.status !== 'CHECKED_IN') return jsonError('Pehle check-in karein')
      await db.visit.update({
        where: { id },
        data: { status: 'COMPLETED', checkOutAt: new Date(), notes: notes ?? visit.notes },
      })

      // if all visits completed, mark plan completed
      const remaining = await db.visit.count({ where: { planId: visit.planId, status: { in: ['PENDING', 'CHECKED_IN'] } } })
      if (remaining === 0) {
        await db.pJPPlan.update({ where: { id: visit.planId }, data: { status: 'COMPLETED' } })
      }
      return Response.json({ status: 'COMPLETED' })
    }

    return jsonError('Unknown action')
  } catch (e) {
    console.error(e)
    return jsonError('Visit action failed', 500)
  }
}
