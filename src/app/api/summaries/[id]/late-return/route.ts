import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { restockStock } from '@/lib/dms-inventory'
import { postLedgerEntry } from '@/lib/dms-credit'

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
 *  - OutletLedger CREDIT (RETURN) — shop ka balance cum ho jata hai
 *  - SummarySettlement (usi order ka): returnAmount/creditAmount update + status recompute
 *    => Settlement Sheet reprint par Section A/B/totals sab consistent rehte hain
 *  - Summary totals: settledReturns += value, settledCredit -= value (negative = shop ko wapasi)
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

    // Task 95: actor cookie user se (pehle body.userId se aata tha)
    const actorName = user.name

    const result = await db.$transaction(async (tx) => {
      const seq = await nextSeq('return', tx)
      const returnNo = `RET-${seq}`
      await tx.saleReturn.create({
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

      // Stock wapas summary (van) warehouse mein
      for (const l of lines) {
        await restockStock(summary.warehouseId, l.productId, l.qty, `Late return ${returnNo} — ${order.orderNo}`, user.id, tx)
      }

      // Task 29: settlement row pehle load — pro-rata tax reversal isi se compute hota hai
      const st = await tx.summarySettlement.findFirst({ where: { summaryId: summary.id, orderId: order.id } })
      // Advance tax PRO-RATA reversal — order ke ORIGINAL full tax par rate (bill total base),
      // cap = baqi bacha hua tax (kabhi negative nahi ho sakta — discount drift se protection)
      const taxReversal = st && st.advanceTax > 0 && order.advanceTax > 0 && order.total > 0
        ? Math.min(round2(order.advanceTax * returnValue / order.total), st.advanceTax)
        : 0
      // Task 45: GST + Trade Offer — SAME pro-rata pattern. GST wapas milta hai (credit +),
      // Trade Offer wapas LENA hai (credit −, shop TO benefit returned goods ka kho deta hai)
      const gstReversal = st && st.gstTotal > 0 && order.gstTotal > 0 && order.total > 0
        ? Math.min(round2(order.gstTotal * returnValue / order.total), st.gstTotal)
        : 0
      const toReversal = st && st.tradeOfferTotal > 0 && order.tradeOfferTotal > 0 && order.total > 0
        ? Math.min(round2(order.tradeOfferTotal * returnValue / order.total), st.tradeOfferTotal)
        : 0

      // Shop ledger CREDIT — goods value + tax/GST reversal − TO reversal (Task 98:
      // postLedgerEntry — balanceAfter + Outlet.balance transactional update)
      await postLedgerEntry(tx, {
        outletId: order.outletId,
        type: 'CREDIT',
        amount: Math.max(0, round2(returnValue + taxReversal + gstReversal - toReversal)),
        refType: 'RETURN',
        refNo: returnNo,
        note: [
          `Late stock return after settlement (${reason})`,
          taxReversal > 0 ? `Adv tax reversal Rs ${taxReversal.toFixed(2)}` : null,
          gstReversal > 0 ? `GST reversal Rs ${gstReversal.toFixed(2)}` : null,
          toReversal > 0 ? `Trade offer reversal Rs ${toReversal.toFixed(2)}` : null,
          `• ${order.orderNo}`,
        ].filter(Boolean).join(' • '),
      })

      // Settlement row update — sheet reprint consistent rahe
      let newCredit = 0
      let newStatus = 'CASH'
      if (st) {
        const newReturn = round2(st.returnAmount + returnValue)
        const newTax = round2(st.advanceTax - taxReversal)
        const newGst = round2(st.gstTotal - gstReversal)
        const newTo = round2(st.tradeOfferTotal - toReversal)
        const newNet = round2(st.billAmount - newReturn + newGst - newTo + newTax)
        newCredit = round2(newNet - st.cashAmount)
        newStatus = st.cashAmount <= 0 ? 'CREDIT' : st.cashAmount >= newNet ? 'CASH' : 'PARTIAL'
        await tx.summarySettlement.update({
          where: { id: st.id },
          data: {
            returnAmount: newReturn,
            advanceTax: newTax,
            gstTotal: newGst,
            tradeOfferTotal: newTo,
            creditAmount: newCredit,
            status: newStatus,
            notes: [st.notes, `Late ${returnNo}`].filter(Boolean).join(' • '),
          },
        })
      }

      // Summary totals — return goods value; credit goods + tax reversal dono se kam
      const updated = await tx.deliverySummary.update({
        where: { id: summary.id },
        data: {
          settledReturns: round2(summary.settledReturns + returnValue),
          settledCredit: round2(summary.settledCredit - returnValue - taxReversal),
        },
      })

      return { returnNo, credit: newCredit, taxReversal, settledReturns: updated.settledReturns, settledCredit: updated.settledCredit }
    }, { timeout: 20000 })

    return Response.json({
      return: {
        returnNo: result.returnNo,
        totalValue: returnValue,
        taxReversal: result.taxReversal,
        outletName: order.outlet.name,
        orderNo: order.orderNo,
        creditAmount: result.credit,
        settledReturns: result.settledReturns,
        settledCredit: result.settledCredit,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Late return failed', 500)
  }
}
