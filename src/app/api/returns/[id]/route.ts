import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, outletScopeError } from '@/lib/api-auth'
import { computeReturnLines } from '@/lib/dms-return-core'
import { applyBillReturnEffects } from '@/lib/dms-return-effects'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha — koi bhi approve/reject kar sakta tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const { action } = await req.json()
    if (!['APPROVE', 'REJECT'].includes(action)) return jsonError('Unknown action')

    const ret = await db.saleReturn.findUnique({
      where: { id },
      include: {
        outlet: { select: { distributorId: true, salesmanId: true } },
        items: true,
        order: { include: { items: { include: { product: { select: { name: true } } } } } },
      },
    })
    if (!ret) return jsonError('Return not found', 404)
    // Task 95: outlet scope — approval sirf apne tenant / apni route ke return par
    const ose = await outletScopeError(user, { distributorId: ret.outlet.distributorId, salesmanId: ret.outlet.salesmanId })
    if (ose) return ose

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'

    // ---------------- Task 101: BILL-LINKED approve par FULL EFFECTS ----------------
    // Salesman ka PENDING bill-linked return approve hua => stock restock + ledger
    // (no-minus split, advance) + settlement row + summary totals — distributor ke
    // auto-approve wale POST jaisa hi, ek hi transaction mein.
    if (action === 'APPROVE' && ret.orderId && ret.order) {
      if (ret.status !== 'PENDING') return jsonError('Ye return already processed hai')
      const order = ret.order
      const st = await db.summarySettlement.findFirst({ where: { orderId: order.id } })
      if (!st) return jsonError('Is bill ki settlement nahi mili — effects apply nahi ho sakte')
      const summary = await db.deliverySummary.findUnique({ where: { id: st.summaryId }, select: { warehouseId: true } })
      if (!summary) return jsonError('Bill ki summary nahi mili', 404)

      // Cap re-validation (approve ke intezar mein aur returns approve ho gaye hon)
      const priorReturns = await db.saleReturn.findMany({
        where: { orderId: order.id, status: 'APPROVED' },
        select: { items: { select: { productId: true, qty: true } } },
      })
      const returnedMap: Record<string, number> = {}
      for (const r of priorReturns) {
        for (const ri of r.items) returnedMap[ri.productId] = (returnedMap[ri.productId] ?? 0) + ri.qty
      }
      try {
        computeReturnLines(
          order.items.map((it) => ({ productId: it.productId, qty: it.qty, rate: it.rate, lineTotal: it.lineTotal, productName: it.product.name })),
          ret.items.map((it) => ({ productId: it.productId, qty: it.qty })),
          returnedMap,
        )
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Return ab valid nahi reha — reject kar ke naya banayein')
      }

      const result = await db.$transaction(async (tx) => {
        await tx.saleReturn.update({ where: { id: ret.id }, data: { status: 'APPROVED' } })
        const fx = await applyBillReturnEffects(tx, {
          returnId: ret.id,
          returnNo: ret.returnNo,
          outletId: ret.outletId,
          order: { id: order.id, orderNo: order.orderNo, total: order.total, advanceTax: order.advanceTax, gstTotal: order.gstTotal, tradeOfferTotal: order.tradeOfferTotal },
          st,
          warehouseId: summary.warehouseId,
          lines: ret.items.map((it) => ({ productId: it.productId, qty: it.qty, rate: it.rate, value: it.value })),
          userId: user.id,
          contextNote: `Stock return (${ret.type}) — approved`,
        })
        return fx
      }, { timeout: 20000 })

      return Response.json({
        status: 'APPROVED',
        effects: {
          totalValue: ret.totalValue,
          ledgerCredit: result.ledgerCredit,
          advancePosted: result.advancePosted,
        },
      })
    }

    // ---------------- Standalone return — purana behavior (status flip only) ----------------
    await db.saleReturn.update({ where: { id }, data: { status } })
    return Response.json({ status })
  } catch (e) {
    console.error(e)
    return jsonError('Return update failed', 500)
  }
}
