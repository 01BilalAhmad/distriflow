import { db, type DbClient } from '@/lib/db'

export interface AtpRow {
  onHand: number
  committed: number
  available: number
}

/**
 * Task 26 — AVAILABLE TO PROMISE (ATP) / stock limit — overselling band.
 * available = onHand (tenant ke saare warehouses ka StockBatch) − committed
 * committed = SIRF CONFIRMED orders ki booked qty — ye bills abhi warehouse mein rakh
 * hui hain (deduct nahi hui). PROCESSING (van out) par FEFO deduction HO CHUKA hota hai
 * (summaries POST → fulfillOrder), isliye wo committed count NAHI hoti — warna double-count
 * hoti (batch se nikal chuki + phir ATP se bhi minus). Isse wo scenario block hota hai
 * jahan 1 ctn stock par order booker 3 bills × 1 ctn = 6 ctns book kar deta tha.
 * excludeOrderId — stock-allocation edit par order ki APNI purani commitment count na ho
 * (warna apni hi lines available se minus ho kar edit kabhi possible na hota).
 */
export async function getAvailableToPromise(
  distributorId: string,
  productIds?: string[],
  excludeOrderId?: string,
  client: DbClient = db,
): Promise<Map<string, AtpRow>> {
  const idFilter = productIds && productIds.length > 0 ? { in: productIds } : undefined

  const onHandRows = await client.stockBatch.groupBy({
    by: ['productId'],
    where: { warehouse: { distributorId }, ...(idFilter ? { productId: idFilter } : {}) },
    _sum: { qty: true },
  })
  const committedRows = await client.orderItem.groupBy({
    by: ['productId'],
    where: {
      order: {
        distributorId,
        status: 'CONFIRMED', // sirf unprocessed bills — PROCESSING/DELIVERED ka stock FEFO deduct ho chuka hota hai
        ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
      },
      ...(idFilter ? { productId: idFilter } : {}),
    },
    _sum: { qty: true },
  })

  const onHand = new Map(onHandRows.map((r) => [r.productId, r._sum.qty ?? 0]))
  const committed = new Map(committedRows.map((r) => [r.productId, r._sum.qty ?? 0]))
  const keys = new Set<string>([
    ...onHand.keys(),
    ...committed.keys(),
    ...(productIds ?? []),
  ])
  const map = new Map<string, AtpRow>()
  for (const k of keys) {
    const o = onHand.get(k) ?? 0
    const c = committed.get(k) ?? 0
    map.set(k, { onHand: o, committed: c, available: o - c })
  }
  return map
}

/** ATP validation ke liye grouped demand: duplicate lines ek hi product ki combined qty count hoti hai */
export function groupQtyByProduct(lines: { productId: string; qty: number }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty)
  return m
}

/** Roman-Urdu oversell error message — product name + available vs booked (ctn terms) */
export function oversellMessage(
  over: { productId: string; qty: number }[],
  atp: Map<string, AtpRow>,
  productNames: Map<string, string>,
  upcOf: (productId: string) => number,
): string {
  const parts = over.slice(0, 3).map(({ productId, qty }) => {
    const name = productNames.get(productId) ?? 'Product'
    const upc = Math.max(1, upcOf(productId))
    const availCtn = Math.max(0, atp.get(productId)?.available ?? 0) / upc
    return `${name}: available ${availCtn.toFixed(2)} ctn, aap ne ${(qty / upc).toFixed(2)} ctn book kiye`
  })
  if (over.length > 3) parts.push(`+${over.length - 3} aur products`)
  return parts.join(' | ')
}

/** FEFO (First Expired First Out) stock deduction */
export async function deductStockFEFO(warehouseId: string, productId: string, qty: number) {
  const batches = await db.stockBatch.findMany({
    where: { warehouseId, productId, qty: { gt: 0 } },
    orderBy: [{ expDate: 'asc' }, { receivedAt: 'asc' }],
  })
  let remaining = qty
  for (const b of batches) {
    if (remaining <= 0) break
    const take = Math.min(b.qty, remaining)
    if (take > 0) {
      await db.stockBatch.update({ where: { id: b.id }, data: { qty: b.qty - take } })
      remaining -= take
    }
  }
  return qty - remaining // actually deducted
}

/**
 * Restock goods returned by a shop at settlement time.
 * Merges into the LATEST-expiry batch (so FEFO keeps selling older stock first —
 * returned goods are the newest), or creates a fresh batch if none exists.
 * Logs a StockAdjustment IN row so the inventory page shows the movement.
 */
export async function restockStock(
  warehouseId: string,
  productId: string,
  qty: number,
  reason = 'Settlement return',
  userId?: string | null,
  client: DbClient = db,
) {
  if (qty <= 0) return
  const batch = await client.stockBatch.findFirst({
    where: { warehouseId, productId },
    orderBy: [{ expDate: 'desc' }, { receivedAt: 'desc' }],
  })
  if (batch) {
    await client.stockBatch.update({ where: { id: batch.id }, data: { qty: batch.qty + qty } })
  } else {
    const exp = new Date()
    exp.setFullYear(exp.getFullYear() + 1)
    await client.stockBatch.create({
      data: {
        warehouseId,
        productId,
        batchNo: `RET-${Date.now().toString(36).toUpperCase()}`,
        qty,
        expDate: exp,
      },
    })
  }
  await client.stockAdjustment.create({
    data: { warehouseId, productId, type: 'IN', qty, reason, userId: userId ?? null },
  })
}
