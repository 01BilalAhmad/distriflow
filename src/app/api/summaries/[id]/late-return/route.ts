import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { applyBillReturnEffects } from '@/lib/dms-return-effects'

interface LateReturnItem { productId: string; qty: number }
interface LateReturnBody {
  userId?: string // legacy — IGNORE
  orderId: string
  reason?: string // UNSOLD | DAMAGED | EXPIRED
  items: LateReturnItem[]
}

const RETURN_TYPES = ['UNSOLD', 'DAMAGED', 'EXPIRED']
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * POST /api/summaries/[id]/late-return — SETTLED summary ke bill par stock return
 * (ghalti se settlement ke waqt return reh gaya ho). Effects (ONE transaction):
 *  - SaleReturn (RET-, auto-APPROVED) + ReturnItems @ original bill rate
 *  - Restock into summary (van) warehouse
 *  - OutletLedger CREDIT (RETURN) — Task 101 NO-MINUS: credit sirf outstanding tak;
 *    bachi raqam shop ke ADVANCE mein (Outlet.advanceBalance) — balance kabhi minus nahi
 *  - SummarySettlement (usi order ka): returnAmount/creditAmount update + status recompute
 *    => Settlement Sheet reprint par Section A/B/totals sab consistent rehte hain
 *  - Summary totals: settledReturns += value, settledCredit += exact creditDelta
 * Cap: per product returnable = billed qty - (settlement + pichle late returns, APPROVED)
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const { id } = await params
    const body = await req.json() as LateReturnBody
    if (!body.orderId) return jsonError('Order required hai')
    if (!Array.isArray(body.items) || body.items.length === 0 || !body.items.some((it) => Number(it.qty) > 0)) {
      return jsonError('Return items required hain')
    }

    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: { orders: { include: { items: { include: { product: { select: { name: true } } } }, outlet: { select: { name: true } } } } },
    })
    if (!summary) return jsonError('Summary not found', 404)
    // Task 95: tenant ownership — summary usi distributor ki honi chahiye
    const tm = await tenantMismatch(user, summary.distributorId)
    if (tm) return tm
    if (summary.status !== 'SETTLED') {
      return jsonError('Ye summary settled nahi hai — unsettled summaries ke liye settlement form ka Return button use karein')
    }
    const order = summary.orders.find((o) => o.id === body.orderId)
    if (!order) return jsonError('Order is summary ka hissa nahi hai')

    const reason = RETURN_TYPES.includes(body.reason ?? '') ? body.reason! : 'UNSOLD'
    const itemMap = new Map(order.items.map((it) => [it.productId, it]))

    // Already returned (APPROVED) — settlement-time + pichle late returns dono
    const priorReturns = await db.saleReturn.findMany({
      where: { orderId: order.id, status: 'APPROVED' },
      include: { items: { select: { productId: true, qty: true } } },
    })
    const returnedQty = new Map<string, number>()
    for (const r of priorReturns) {
      for (const ri of r.items) returnedQty.set(ri.productId, (returnedQty.get(ri.productId) ?? 0) + ri.qty)
    }

    const lines: { productId: string; qty: number; rate: number; value: number }[] = []
    let returnValue = 0
    for (const ri of body.items) {
      const qty = Math.max(0, Math.floor(Number(ri.qty) || 0))
      if (qty <= 0) continue
      const oi = itemMap.get(ri.productId)
      if (!oi) return jsonError('Return item invoice ka hissa nahi hai')
      const already = returnedQty.get(ri.productId) ?? 0
      if (qty > oi.qty - already) {
        return jsonError(`${oi.product?.name ?? 'Item'}: sirf ${oi.qty - already} pcs return ho sakte hain (billed ${oi.qty}, pehle se wapas ${already})`)
      }
      // Task 63: value bill ke ACTUAL per-pc rate par (lineTotal/qty — scheme + manual
      // discount ke baad). Trade price par full return bill se zyada credit => minus.
      // Task 63-b: lineTotal 0 (purane pre-Task 45 orders) par trade rate fallback.
      const effRate = oi.qty > 0 && oi.lineTotal > 0 ? oi.lineTotal / oi.qty : oi.rate
      const value = round2(qty * effRate)
      lines.push({ productId: ri.productId, qty, rate: effRate, value })
      returnValue += value
    }
    if (lines.length === 0) return jsonError('Return qty 0 hai')
    returnValue = round2(returnValue)

    const actorName = user.name

    // Task 101: settlement row lazmi — effects (pro-rata caps + no-minus split) isi par
    const st = await db.summarySettlement.findFirst({ where: { summaryId: summary.id, orderId: order.id } })
    if (!st) return jsonError('Is bill ki settlement row nahi mili — pehle settlement check karein')

    const result = await db.$transaction(async (tx) => {
      const seq = await nextSeq('return', tx)
      const returnNo = `RET-${seq}`
      const ret = await tx.saleReturn.create({
        data: {
          returnNo,
          outletId: order.outletId,
          orderId: order.id,
          type: reason,
          status: 'APPROVED',
          totalValue: returnValue,
          reason: `Late return after settlement (${summary.summaryNo})${actorName ? ` by ${actorName}` : ''}`,
          items: { create: lines },
        },
      })

      // Task 101: restock + pro-rata reversals + NO-MINUS ledger split (advance) +
      // settlement row + summary totals — sab ek shared helper mein (bill-linked
      // Return & Claims flow bhi YEHHI use karta hai — ek hi math, koi tafawat nahi)
      const fx = await applyBillReturnEffects(tx, {
        returnId: ret.id,
        returnNo,
        outletId: order.outletId,
        order: { id: order.id, orderNo: order.orderNo, total: order.total, advanceTax: order.advanceTax, gstTotal: order.gstTotal, tradeOfferTotal: order.tradeOfferTotal },
        st,
        warehouseId: summary.warehouseId,
        lines,
        userId: user.id,
        contextNote: `Late stock return after settlement (${reason})`,
      })

      return { returnNo, fx }
    }, { timeout: 20000 })

    return Response.json({
      return: {
        returnNo: result.returnNo,
        totalValue: returnValue,
        taxReversal: result.fx.taxRev,
        outletName: order.outlet.name,
        orderNo: order.orderNo,
        // Task 101: no-minus — creditAmount kabhi negative nahi; bachi raqam advance
        creditAmount: result.fx.newCreditAmount,
        advancePosted: result.fx.advancePosted,
        totalCredit: result.fx.totalCredit,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Late return failed', 500)
  }
}
