import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { restockStock } from '@/lib/dms-inventory'
import { persistLiveRecalc } from '@/lib/dms-live-recalc'
import { audit } from '@/lib/audit'

/**
 * POST /api/summaries/[id]/unprocess — Task 27: UN-PROCESS a delivery summary.
 * Process ka exact reverse:
 *   1. Van se nikla hua stock wapas warehouse mein (Delivery items ke actual deducted
 *      qty — FEFO partial deduction bhi sahi revert hota hai) + StockAdjustment IN log
 *   2. Delivery challans delete
 *   3. Sab bills PROCESSING -> CONFIRMED (wapas Stock Allocation / unprocessed mein)
 *   4. Summary delete
 * Sirf UNSETTLED summary un-process ho sakti hai — settlement ke baad nahi.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle body optional tha — ab identity cookie se, unauthenticated band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const { id } = await params

    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: { orders: { select: { id: true, orderNo: true, status: true } }, settlements: { select: { id: true } } },
    })
    if (!summary) return jsonError('Summary not found', 404)
    // Task 95: tenant ownership — summary usi distributor ki honi chahiye
    const tm = await tenantMismatch(user, summary.distributorId)
    if (tm) return tm
    if (summary.status === 'SETTLED') {
      return jsonError('Ye summary SETTLE ho chuki hai — settled summary un-process nahi ho sakti (payment/receipt book ho chuke hain)')
    }
    if (summary.settlements.length > 0) {
      return jsonError('Is summary ki settlements maujood hain — pehle settlement delete karein')
    }
    const bad = summary.orders.find((o) => o.status !== 'PROCESSING')
    if (bad) return jsonError(`Bill ${bad.orderNo} (${bad.status}) un-process nahi ho sakta — sirf van-out bills revert hoti hain`)

    const orderIds = summary.orders.map((o) => o.id)
    const deliveries = await db.delivery.findMany({
      where: { orderId: { in: orderIds } },
      include: { items: true },
    })

    const result = await db.$transaction(async (tx) => {
      // 1) Stock wapas — DeliveryItem = ACTUALLY deducted qty (fulfillOrder ka record)
      let restockedPcs = 0
      for (const d of deliveries) {
        for (const it of d.items) {
          await restockStock(summary.warehouseId, it.productId, it.qty, `Un-process ${summary.summaryNo} (${d.deliveryNo})`, user.id, tx)
          restockedPcs += it.qty
        }
      }
      // 2) Delivery challans delete
      if (deliveries.length > 0) {
        await tx.deliveryItem.deleteMany({ where: { deliveryId: { in: deliveries.map((d) => d.id) } } })
        await tx.delivery.deleteMany({ where: { id: { in: deliveries.map((d) => d.id) } } })
      }
      // 3) Bills wapas unprocessed (Stock Allocation mein dobara nazar aayengi)
      await tx.order.updateMany({ where: { id: { in: orderIds } }, data: { status: 'CONFIRMED' } })
      // 3b) Task 112: Process Anyway trim restore — bookedQty backup se original booked qty wapas
      const trimmedItems = await tx.orderItem.findMany({
        where: { orderId: { in: orderIds }, bookedQty: { not: null } },
        select: { id: true, bookedQty: true },
      })
      for (const t of trimmedItems) {
        await tx.orderItem.update({ where: { id: t.id }, data: { qty: t.bookedQty!, bookedQty: null } })
      }
      // 4) Summary delete (implicit m-n join rows cascade)
      await tx.deliverySummary.delete({ where: { id: summary.id } })
      return { summaryNo: summary.summaryNo, billsCount: orderIds.length, restockedPcs, deliveries: deliveries.length, restoredLines: trimmedItems.length }
    })

    // Task 112: trim restore ke baad stored totals bhi full booked par refresh (live recalc)
    for (const o of summary.orders) {
      await persistLiveRecalc({ id: o.id, status: 'CONFIRMED', subtotal: 0, schemeDiscount: 0, manualDiscount: 0, total: 0, tradeOfferTotal: 0, gstTotal: 0, filerStatus: null, advanceTaxRate: null, advanceTax: 0 })
    }

    // Task 35: SUMMARY_UNPROCESS — revert ka record (kitna stock wapas aaya)
    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId: summary.distributorId },
      'SUMMARY_UNPROCESS',
      { req, entity: 'DeliverySummary', entityId: summary.id, detail: `${result.summaryNo} UN-PROCESSED — ${result.billsCount} bills back to CONFIRMED, ${result.restockedPcs} pcs restocked, ${result.restoredLines} trimmed lines restored (Task 112)` },
    )

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error(e)
    return jsonError('Un-process failed', 500)
  }
}
