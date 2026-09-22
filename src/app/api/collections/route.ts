import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const outletWhere =
      user.role === 'SALESMAN' ? { salesmanId: userId } : { distributorId: user.profile?.id }

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
    const body = await req.json()
    const { outletId, amount, method, collectedById } = body
    if (!outletId || !amount) return jsonError('Outlet aur amount required hain')

    const seq = await nextSeq('receipt')
    const coll = await db.collection.create({
      data: {
        receiptNo: `RCP-${seq}`,
        outletId, amount: Number(amount),
        method: method ?? 'CASH',
        collectedById: collectedById ?? null,
      },
    })
    return Response.json({ collection: { id: coll.id, receiptNo: coll.receiptNo } })
  } catch (e) {
    console.error(e)
    return jsonError('Collection failed', 500)
  }
}
