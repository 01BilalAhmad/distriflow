import { db, type DbClient } from '@/lib/db'
import { deductStockFEFO } from '@/lib/dms-inventory'
import { nextSeq } from '@/lib/dms-scope'

/**
 * Fulfill an order: FEFO-deduct stock from the distributor's primary warehouse
 * and create a Delivery record (van load / challan). Shared by the legacy
 * order-deliver endpoint and the DeliverySummary processing flow.
 * qtyOverrides (Task 28 — Process Anyway): orderItemId -> pcs, partial load ke liye.
 * Line jo override 0 deti hai wo delivery mein 0 qty ke sath aati hai (kuch load nahi hua),
 * aur jitna override diya hai UTNA hi deduct hota hai — kabhi zyada nahi.
 *
 * Task 95 (P1): `client` param — van-out batch isko interactive transaction ke andar
 * call karti hai (pehle har fulfill apni alag autocommit mein tha: crash par aadha van
 * load + stock deduct ho kar rah jata tha).
 */
export async function fulfillOrder(orderId: string, qtyOverrides?: Map<string, number>, client: DbClient = db) {
  const order = await client.order.findUnique({ where: { id: orderId }, include: { items: true } })
  if (!order) throw new Error('Order not found')

  const wh = await client.warehouse.findFirst({ where: { distributorId: order.distributorId, isPrimary: true } })
  if (!wh) throw new Error('Warehouse not found')

  const deliveryItems: { productId: string; qty: number }[] = []
  for (const it of order.items) {
    const want = Math.max(0, qtyOverrides?.get(it.id) ?? it.qty)
    const deducted = want > 0 ? await deductStockFEFO(wh.id, it.productId, want, client) : 0
    deliveryItems.push({ productId: it.productId, qty: deducted })
  }

  const seq = await nextSeq('delivery', client)
  const delivery = await client.delivery.create({
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
