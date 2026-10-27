import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, outletScopeError } from '@/lib/api-auth'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const outletWhere =
      user.role === 'SALESMAN' ? { salesmanId: user.id } : { distributorId: user.profile?.id }

    const collections = await db.collection.findMany({
      where: { outlet: outletWhere },
      include: {
        outlet: { select: { name: true } },
        collectedBy: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
      take: 50,
    })

    return Response.json({
      collections: collections.map((c) => ({
        id: c.id,
        receiptNo: c.receiptNo,
        outletName: c.outlet.name,
        amount: c.amount,
        method: c.method,
        date: new Date(c.date).toISOString(),
        collectedByName: c.collectedBy?.name ?? null,
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Collections load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se — collectedById ab cookie user ka hai (pehle body se aata tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { outletId, amount, method } = body
    if (!outletId || !amount) return jsonError('Outlet aur amount required hain')

    const outlet = await db.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) return jsonError('Outlet not found', 404)
    // Task 95: outlet scope — collection sirf apni route / apne tenant ki shop par
    const ose = await outletScopeError(user, { distributorId: outlet.distributorId, salesmanId: outlet.salesmanId })
    if (ose) return ose

    const seq = await nextSeq('receipt')
    const coll = await db.collection.create({
      data: {
        receiptNo: `RCP-${seq}`,
        outletId, amount: Number(amount),
        method: method ?? 'CASH',
        collectedById: user.id,
      },
    })
    return Response.json({ collection: { id: coll.id, receiptNo: coll.receiptNo } })
  } catch (e) {
    console.error(e)
    return jsonError('Collection failed', 500)
  }
}
