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

    const returns = await db.saleReturn.findMany({
      where: { outlet: outletWhere },
      include: {
        outlet: { select: { name: true } },
        items: { include: { product: { select: { name: true, unitsPerCarton: true, pcsPerBox: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return Response.json({
      returns: returns.map((r) => ({
        id: r.id,
        returnNo: r.returnNo,
        outletName: r.outlet.name,
        type: r.type,
        status: r.status,
        totalValue: r.totalValue,
        reason: r.reason,
        createdAt: new Date(r.createdAt).toISOString(),
        items: r.items.map((it) => ({ productName: it.product.name, qty: it.qty, rate: it.rate, value: it.value, unitsPerCarton: it.product.unitsPerCarton, pcsPerBox: it.product.pcsPerBox })),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Returns load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { outletId, type, reason, items } = body
    if (!outletId || !type || !items || items.length === 0) {
      return jsonError('Outlet, type aur items required hain')
    }

    const productIds = items.map((i: { productId: string }) => i.productId)
    // Task 23: tenant scope — return jis distributor ki shop ka, products usi ke
    const outlet = await db.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) return jsonError('Outlet not found', 404)
    // Task 95: outlet scope — return sirf apni route / apne tenant ki shop par
    const ose = await outletScopeError(user, { distributorId: outlet.distributorId, salesmanId: outlet.salesmanId })
    if (ose) return ose
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: outlet.distributorId } })
    let totalValue = 0
    // qty = PIECES (base unit) — rate per piece = tradePrice / unitsPerCarton
    const itemData = items.map((i: { productId: string; qty: number }) => {
      const p = products.find((x) => x.id === i.productId)!
      const rate = p.tradePrice / Math.max(1, p.unitsPerCarton)
      const value = Math.round(i.qty * rate * 100) / 100
      totalValue += value
      return { productId: i.productId, qty: i.qty, rate, value }
    })

    const seq = await nextSeq('return')
    const ret = await db.saleReturn.create({
      data: {
        returnNo: `RET-${seq}`,
        outletId, type, reason: reason ?? null,
        status: 'PENDING', totalValue,
        items: { create: itemData },
      },
    })
    return Response.json({ return: { id: ret.id, returnNo: ret.returnNo } })
  } catch (e) {
    console.error(e)
    return jsonError('Return create failed', 500)
  }
}
