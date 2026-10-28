import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, outletScopeError } from '@/lib/api-auth'
import { ensureOutletBalance, advanceSources } from '@/lib/dms-credit'
import { effRateOf, r2c } from '@/lib/dms-return-core'

/**
 * GET /api/returns/bill-options?outletId=X — Task 101
 * Return & Claims page ka bill-linked return: shop ke SETTLED bills ka dropdown
 * (sirf settled hi ledger mein aate hain — user rule) + per-item returnable +
 * shop advance info (no-minus guard ki "chhoti detail" ke liye).
 *
 * Returnable = billed − already returned (settlement + late + claims-page, sab
 * APPROVED returns). Value bill ke ACTUAL per-pc rate par (effRate — scheme +
 * manual discount ke baad), trade price par nahi.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const { searchParams } = new URL(req.url)
    const outletId = searchParams.get('outletId')
    if (!outletId) return jsonError('Outlet required hai')

    const outlet = await db.outlet.findUnique({
      where: { id: outletId },
      select: { id: true, name: true, code: true, code4: true, distributorId: true, salesmanId: true },
    })
    if (!outlet) return jsonError('Outlet not found', 404)
    // Task 95 pattern: salesman apni route ki shops, distributor apne tenant ki
    const ose = await outletScopeError(user, { distributorId: outlet.distributorId, salesmanId: outlet.salesmanId })
    if (ose) return ose

    const balance = await ensureOutletBalance(outlet.id) // legacy outlet one-time sync
    const advSources = await advanceSources(db, outlet.id)

    // Shop ke settled bills — SummarySettlement row hi "settled" ka proof hai
    const settlements = await db.summarySettlement.findMany({
      where: { outletId: outlet.id },
      include: {
        order: {
          include: {
            items: { include: { product: { select: { name: true, unitsPerCarton: true, pcsPerBox: true } } } },
          },
        },
        summary: { select: { summaryNo: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    // Already returned qty per (bill, product) — sab APPROVED returns
    const orderIds = settlements.map((s) => s.orderId)
    const approvedReturns = orderIds.length > 0
      ? await db.saleReturn.findMany({
          where: { orderId: { in: orderIds }, status: 'APPROVED' },
          select: { orderId: true, items: { select: { productId: true, qty: true } } },
        })
      : []
    const returnedByOrder = new Map<string, Map<string, number>>()
    for (const r of approvedReturns) {
      if (!r.orderId) continue
      let m = returnedByOrder.get(r.orderId)
      if (!m) returnedByOrder.set(r.orderId, (m = new Map()))
      for (const it of r.items) m.set(it.productId, (m.get(it.productId) ?? 0) + it.qty)
    }

    const bills = settlements.map((st) => {
      const order = st.order
      const retMap = returnedByOrder.get(st.orderId)
      const items = order.items.map((it) => {
        const returned = retMap?.get(it.productId) ?? 0
        const returnable = Math.max(0, it.qty - returned)
        return {
          productId: it.productId,
          productName: it.product.name,
          unitsPerCarton: it.product.unitsPerCarton,
          pcsPerBox: it.product.pcsPerBox,
          billed: it.qty,
          returned,
          returnable,
          effRate: r2c(effRateOf(it)), // per-pc net rate (scheme + manual discount ke baad)
          lineTotal: r2c(it.lineTotal),
        }
      })
      const returnableQty = items.reduce((t, i) => t + i.returnable, 0)
      const returnableValue = r2c(items.reduce((t, i) => t + i.returnable * i.effRate, 0))
      return {
        id: order.id,
        orderNo: order.orderNo,
        orderDate: new Date(order.orderDate).toISOString(),
        status: order.status,
        total: r2c(order.total),
        gstTotal: r2c(order.gstTotal ?? 0),
        tradeOfferTotal: r2c(order.tradeOfferTotal ?? 0),
        advanceTax: r2c(order.advanceTax ?? 0),
        filerStatus: order.filerStatus,
        summaryNo: st.summary.summaryNo,
        // Settlement row ki EFFECTIVE raqamen — pro-rata reversal caps inhi par
        settlement: {
          cashAmount: r2c(st.cashAmount),
          status: st.status,
          returnAmount: r2c(st.returnAmount),
          advanceTax: r2c(st.advanceTax),
          gstTotal: r2c(st.gstTotal),
          tradeOfferTotal: r2c(st.tradeOfferTotal),
        },
        items,
        returnableQty,
        returnableValue,
        fullyReturned: returnableQty === 0,
      }
    })

    const advanceBalanceRow = await db.outlet.findUnique({ where: { id: outlet.id }, select: { advanceBalance: true } })

    return Response.json({
      outlet: {
        id: outlet.id,
        name: outlet.name,
        code: outlet.code,
        code4: outlet.code4,
        balance,
        advanceBalance: r2c(advanceBalanceRow?.advanceBalance ?? 0),
        advanceSources: advSources,
      },
      bills,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Bill options load failed', 500)
  }
}
