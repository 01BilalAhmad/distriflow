import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * POST /api/returns/[id]/cancel — Task 64: galti se laga hua stock return WAPAS lena (undo).
 *
 * Effects (ONE transaction):
 *  - SaleReturn.status -> CANCELLED (record history ke liye rehta hai)
 *  - Stock reverse: restock ka ulta — van warehouse ki latest-expiry batch se qty minus
 *    + StockAdjustment OUT row (inventory page par movement dikhta hai)
 *  - OutletLedger: DEBIT 'RETURN_CANCEL' — original RETURN credit ka exact inverse,
 *    shop balance wapas bill wali state par
 *  - SummarySettlement: returnAmount - v, advanceTax/gstTotal/tradeOfferTotal + pro-rata
 *    undo, creditAmount/status recalc
 *  - DeliverySummary: settledReturns - v, settledCredit + delta
 *
 * Rule: sirf LATEST approved return undo ho sakta hai (beech ke returns pehle undo karo) —
 * warna pro-rata tax/GST undo amounts non-deterministic ho jate.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { userId?: string }
    if (!body.userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: body.userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    if (user.role === 'SALESMAN') return jsonError('Salesman return cancel nahi kar sakta — distributor se karein')
    if (user.role === 'MEGA_ADMIN') return jsonError('Tenant data scope nahi')

    const ret = await db.saleReturn.findUnique({
      where: { id },
      include: { items: true, outlet: true, order: { include: { items: true } } },
    })
    if (!ret) return jsonError('Return not found', 404)
    if (ret.status !== 'APPROVED') return jsonError('Ye return already cancelled/rejected hai')
    if (!ret.orderId || !ret.order) return jsonError('Standalone return is route se cancel nahi hota')
    const orderId: string = ret.orderId
    const order = ret.order
    const v = round2(ret.totalValue)

    // Tenant scope — return usi distributor ka hona chahiye jo login hai
    if (!user.profile || ret.outlet.distributorId !== user.profile.id) {
      return jsonError('Ye return aap ke scope mein nahi hai', 403)
    }

    // Sirf latest approved return undo ho sakta hai
    const approved = await db.saleReturn.findMany({
      where: { orderId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (approved[0]?.id !== ret.id) {
      return jsonError('Sirf is bill ka sab se naya return undo ho sakta hai — pehle baad wale returns undo karein')
    }

    const summary = await db.deliverySummary.findFirst({ where: { orders: { some: { id: orderId } } } })
    if (!summary) return jsonError('Is return ki summary nahi mili', 404)

    const result = await db.$transaction(async (tx) => {
      // 1) Return record cancel — history mein rehta hai
      await tx.saleReturn.update({
        where: { id: ret.id },
        data: { status: 'CANCELLED', reason: `${ret.reason ?? ''} — cancelled (ghalti se return tha, wapas liya)`.trim() },
      })

      // 2) Stock reverse — restock ka ulta (latest-expiry batch se minus + OUT adjustment)
      for (const it of ret.items) {
        const batch = await tx.stockBatch.findFirst({
          where: { warehouseId: summary.warehouseId, productId: it.productId },
          orderBy: [{ expDate: 'desc' }, { receivedAt: 'desc' }],
        })
        if (batch) {
          await tx.stockBatch.update({ where: { id: batch.id }, data: { qty: Math.max(0, batch.qty - it.qty) } })
        }
        await tx.stockAdjustment.create({
          data: { warehouseId: summary.warehouseId, productId: it.productId, type: 'OUT', qty: it.qty, reason: `Return cancel ${ret.returnNo} — ${order.orderNo}`, userId: body.userId ?? null },
        })
      }

      // 3) Pro-rata undo amounts — usi formula se jo return ne lagaya tha (full % of bill)
      const taxRev = order.advanceTax > 0 && order.total > 0 ? Math.min(round2(order.advanceTax * v / order.total), order.advanceTax) : 0
      const gstRev = (order.gstTotal ?? 0) > 0 && order.total > 0 ? Math.min(round2((order.gstTotal ?? 0) * v / order.total), order.gstTotal ?? 0) : 0
      const toRev = (order.tradeOfferTotal ?? 0) > 0 && order.total > 0 ? Math.min(round2((order.tradeOfferTotal ?? 0) * v / order.total), order.tradeOfferTotal ?? 0) : 0

      // 4) Settlement row recalc — return ke pehle wali state par wapas
      let delta = 0
      const st = await tx.summarySettlement.findFirst({ where: { summaryId: summary.id, orderId } })
      if (st) {
        const newReturn = Math.max(0, round2(st.returnAmount - v))
        const newTax = round2(Math.min(order.advanceTax ?? 0, st.advanceTax + taxRev))
        const newGst = round2(Math.min(order.gstTotal ?? 0, st.gstTotal + gstRev))
        const newTo = round2(Math.min(order.tradeOfferTotal ?? 0, st.tradeOfferTotal + toRev))
        const newNet = round2(st.billAmount - newReturn + newGst - newTo + newTax)
        const newCredit = round2(newNet - st.cashAmount)
        const newStatus = st.cashAmount <= 0 ? 'CREDIT' : st.cashAmount >= newNet ? 'CASH' : 'PARTIAL'
        delta = round2(newCredit - st.creditAmount)
        await tx.summarySettlement.update({
          where: { id: st.id },
          data: {
            returnAmount: newReturn,
            advanceTax: newTax,
            gstTotal: newGst,
            tradeOfferTotal: newTo,
            creditAmount: newCredit,
            status: newStatus,
            notes: [st.notes, `${ret.returnNo} cancelled`].filter(Boolean).join(' • '),
          },
        })
      }

      // 5) Ledger — original RETURN credit ka exact inverse (DEBIT), balance cum sahi
      const ledgerAmount = Math.max(0, round2(v + taxRev + gstRev - toRev))
      await tx.outletLedger.create({
        data: {
          outletId: ret.outletId,
          type: 'DEBIT',
          amount: ledgerAmount,
          refType: 'RETURN_CANCEL',
          refNo: ret.returnNo,
          note: `Return cancelled — ghalti se return tha, stock + shop balance wapas • ${order.orderNo}`,
        },
      })

      // 6) Summary totals
      const updated = await tx.deliverySummary.update({
        where: { id: summary.id },
        data: {
          settledReturns: round2(Math.max(0, summary.settledReturns - v)),
          settledCredit: round2(summary.settledCredit + delta),
        },
      })

      return { ledgerAmount, settledReturns: updated.settledReturns, settledCredit: updated.settledCredit }
    }, { timeout: 20000 })

    return Response.json({
      result: {
        returnNo: ret.returnNo,
        cancelledValue: v,
        orderNo: order.orderNo,
        outletName: ret.outlet.name,
        ledgerAmount: result.ledgerAmount,
        settledReturns: result.settledReturns,
        settledCredit: result.settledCredit,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Return cancel failed', 500)
  }
}
