import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

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

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, salesmanId, date, outletIds } = body as {
      userId?: string
      salesmanId: string
      date: string
      outletIds: string[]
    }
    if (!userId || !salesmanId || !date || !outletIds || outletIds.length === 0) {
      return jsonError('userId, salesman, date aur outlets required hain')
    }

    // Task 25-b tenant guard: sirf distributor plan bana sakta hai — aur sirf APNE
    // booker ke liye, APNI hi shops ke sath (cross-tenant PJP hole band)
    const caller = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!caller) return jsonError('User not found', 404)
    const mb = megaBlocked(caller.role)
    if (mb) return mb
    if (caller.role !== 'DISTRIBUTOR') return jsonError('Sirf distributor journey plan bana sakta hai', 403)
    const profile = await db.distributorProfile.findUnique({ where: { id: caller.profile!.id } })
    if (!profile) return jsonError('Distributor profile nahi mili', 404)

    const salesman = await db.user.findUnique({ where: { id: salesmanId } })
    if (!salesman || salesman.role !== 'SALESMAN') return jsonError('Order booker valid nahi hai')
    if (salesman.parentId !== profile.userId) return jsonError('Yeh order booker aap ke scope mein nahi hai', 403)

    const outlets = await db.outlet.findMany({ where: { id: { in: outletIds } }, select: { id: true, distributorId: true } })
    if (outlets.length !== outletIds.length) return jsonError('Kuch shops valid nahi hain')
    const foreign = outlets.filter((o) => o.distributorId !== profile.id)
    if (foreign.length > 0) return jsonError('Kuch shops aap ke scope mein nahi hain', 403)

    const plan = await db.pJPPlan.create({
      data: { salesmanId, date: new Date(date), status: 'PLANNED' },
    })
    let seq = 1
    for (const oid of outletIds) {
      await db.visit.create({ data: { planId: plan.id, outletId: oid, sequence: seq++ } })
    }
    return Response.json({ plan: { id: plan.id } })
  } catch (e) {
    console.error(e)
    return jsonError('PJP create failed', 500)
  }
}
