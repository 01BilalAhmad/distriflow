import { db } from '@/lib/db'
import { deductStockFEFO } from '@/lib/dms-inventory'
import { nextSeq } from '@/lib/dms-scope'

/**
 * Fulfill an order: FEFO-deduct stock from the distributor's primary warehouse
 * and create a Delivery record (van load / challan). Shared by the legacy
 * order-deliver endpoint and the DeliverySummary processing flow.
 * qtyOverrides (Task 28 — Process Anyway): orderItemId -> pcs, partial load ke liye.
 * Line jo override 0 deti hai wo delivery mein 0 qty ke sath aati hai (kuch load nahi hua),
 * aur jitna override diya hai UTNA hi deduct hota hai — kabhi zyada nahi.
 */
export async function fulfillOrder(orderId: string, qtyOverrides?: Map<string, number>) {
  const order = await db.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (!order) throw new Error('Order not found')

  const wh = await db.warehouse.findFirst({ where: { distributorId: order.distributorId, isPrimary: true } })
  if (!wh) throw new Error('Warehouse not found')

  const deliveryItems: { productId: string; qty: number }[] = []
  for (const it of order.items) {
    const want = Math.max(0, qtyOverrides?.get(it.id) ?? it.qty)
    const deducted = want > 0 ? await deductStockFEFO(wh.id, it.productId, want) : 0
    deliveryItems.push({ productId: it.productId, qty: deducted })
  }

  const seq = await nextSeq('delivery')
  const delivery = await db.delivery.create({
    data: {
      deliveryNo: `DLV-${seq}`,
      orderId: order.id,
      warehouseId: wh.id,
      status: 'COMPLETED',
      items: { create: deliveryItems },
    },
  })
  return { delivery, warehouseId: wh.id }
}
