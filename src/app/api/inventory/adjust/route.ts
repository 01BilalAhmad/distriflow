import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { warehouseId, productId, type, qty, reason, userId } = body
    if (!warehouseId || !productId || !type || !qty || !reason) {
      return jsonError('Warehouse, product, type, qty aur reason required hain')
    }
    const nQty = Number(qty)
    if (nQty <= 0) return jsonError('Qty positive honi chahiye')

    if (type === 'OUT') {
      const available = await db.stockBatch.aggregate({
        where: { warehouseId, productId },
        _sum: { qty: true },
      })
      if ((available._sum.qty ?? 0) < nQty) return jsonError('Itna stock available nahi hai')
      const batches = await db.stockBatch.findMany({
        where: { warehouseId, productId, qty: { gt: 0 } },
        orderBy: [{ expDate: 'asc' }, { receivedAt: 'asc' }],
      })
      let remaining = nQty
      for (const b of batches) {
        if (remaining <= 0) break
        const take = Math.min(b.qty, remaining)
        await db.stockBatch.update({ where: { id: b.id }, data: { qty: b.qty - take } })
        remaining -= take
      }
    } else {
      // IN — add to latest batch of same product or create new batch
      const lastBatch = await db.stockBatch.findFirst({
        where: { warehouseId, productId },
        orderBy: { receivedAt: 'desc' },
      })
      if (lastBatch) {
        await db.stockBatch.update({ where: { id: lastBatch.id }, data: { qty: lastBatch.qty + nQty } })
      } else {
        await db.stockBatch.create({
          data: {
            warehouseId, productId, batchNo: `ADJ-${Date.now() % 100000}`, qty: nQty, receivedAt: new Date(),
          },
        })
      }
    }

    const adjustment = await db.stockAdjustment.create({
      data: { warehouseId, productId, type, qty: nQty, reason, userId: userId ?? null },
    })
    return Response.json({ adjustment })
  } catch (e) {
    console.error(e)
    return jsonError('Adjustment failed', 500)
  }
}
