import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * Task 82 se pehle yahan manual PJP create (POST) bhi tha — ab route AUTO hai:
 * /api/pjp/today booker ke liye plan khud banata hai (Outlet.salesmanId + visitDays se).
 * Ye endpoint sirf HISTORY dikhata hai (distributor PJP page). Manual create hata diya.
 */

function startOfDay(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const salesmanId = searchParams.get('salesmanId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    let filterSalesmanIds: string[]
    if (user.role === 'SALESMAN') {
      filterSalesmanIds = [user.id]
    } else {
      const profileUser = await db.distributorProfile.findUnique({ where: { id: user.profile!.id } })
      filterSalesmanIds = (
        await db.user.findMany({
          where: { role: 'SALESMAN', parentId: profileUser!.userId },
          select: { id: true },
        })
      ).map((u) => u.id)
    }

    const where = salesmanId ? { salesmanId } : { salesmanId: { in: filterSalesmanIds } }
    const plans = await db.pJPPlan.findMany({
      where,
      include: {
        salesman: { select: { name: true } },
        visits: {
          include: {
            outlet: { select: { name: true, code: true, channel: true, address: true, lat: true, lng: true } },
          },
          orderBy: { sequence: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
      take: 20,
    })

    return Response.json({
      plans: plans.map((p) => ({
        id: p.id,
        salesmanId: p.salesmanId,
        salesmanName: p.salesman.name,
        date: new Date(p.date).toISOString(),
        status: p.status,
        visits: p.visits.map((v) => ({
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
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('PJP load failed', 500)
  }
}

