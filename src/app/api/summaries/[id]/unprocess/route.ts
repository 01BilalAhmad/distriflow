import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { restockStock } from '@/lib/dms-inventory'

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
    const { id } = await params
    let userId: string | null = null
    try {
      const body = await req.json() as { userId?: string }
      userId = body.userId ?? null
    } catch { /* body optional */ }

    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: { orders: { select: { id: true, orderNo: true, status: true } }, settlements: { select: { id: true } } },
    })
    if (!summary) return jsonError('Summary not found', 404)
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
          await restockStock(summary.warehouseId, it.productId, it.qty, `Un-process ${summary.summaryNo} (${d.deliveryNo})`, userId, tx)
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
      // 4) Summary delete (implicit m-n join rows cascade)
      await tx.deliverySummary.delete({ where: { id: summary.id } })
      return { summaryNo: summary.summaryNo, billsCount: orderIds.length, restockedPcs, deliveries: deliveries.length }
    })

    return Response.json({ ok: true, ...result })
  } catch (e) {
    console.error(e)
    return jsonError('Un-process failed', 500)
  }
}
