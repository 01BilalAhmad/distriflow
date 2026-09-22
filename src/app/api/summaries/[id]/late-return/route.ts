import { db } from '@/lib/db'
import { jsonError, nextSeq } from '@/lib/dms-scope'
import { restockStock } from '@/lib/dms-inventory'

interface LateReturnItem { productId: string; qty: number }
interface LateReturnBody {
  userId?: string
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
      const value = round2(qty * oi.rate)
      lines.push({ productId: ri.productId, qty, rate: oi.rate, value })
      returnValue += value
    }
    if (lines.length === 0) return jsonError('Return qty 0 hai')
    returnValue = round2(returnValue)

    let actorName: string | null = null
    if (body.userId) {
      const actor = await db.user.findUnique({ where: { id: body.userId } })
      actorName = actor?.name ?? null
    }

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
        await restockStock(summary.warehouseId, l.productId, l.qty, `Late return ${returnNo} — ${order.orderNo}`, body.userId, tx)
      }

      // Task 29: settlement row pehle load — pro-rata tax reversal isi se compute hota hai
      const st = await tx.summarySettlement.findFirst({ where: { summaryId: summary.id, orderId: order.id } })
      // Advance tax PRO-RATA reversal — order ke ORIGINAL full tax par rate (bill total base),
      // cap = baqi bacha hua tax (kabhi negative nahi ho sakta — discount drift se protection)
      const taxReversal = st && st.advanceTax > 0 && order.advanceTax > 0 && order.total > 0
        ? Math.min(round2(order.advanceTax * returnValue / order.total), st.advanceTax)
        : 0

      // Shop ledger CREDIT — goods value + tax reversal, balance cum ho jata hai
      await tx.outletLedger.create({
        data: {
          outletId: order.outletId,
          type: 'CREDIT',
          amount: round2(returnValue + taxReversal),
          refType: 'RETURN',
          refNo: returnNo,
          note: `Late stock return after settlement (${reason})${taxReversal > 0 ? ` • Adv tax reversal Rs ${taxReversal.toFixed(2)}` : ''} • ${order.orderNo}`,
        },
      })

      // Settlement row update — sheet reprint consistent rahe
      let newCredit = 0
      let newStatus = 'CASH'
      if (st) {
        const newReturn = round2(st.returnAmount + returnValue)
        const newTax = round2(st.advanceTax - taxReversal)
        const newNet = round2(st.billAmount - newReturn + newTax)
        newCredit = round2(newNet - st.cashAmount)
        newStatus = st.cashAmount <= 0 ? 'CREDIT' : st.cashAmount >= newNet ? 'CASH' : 'PARTIAL'
        await tx.summarySettlement.update({
          where: { id: st.id },
          data: {
            returnAmount: newReturn,
            advanceTax: newTax,
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
