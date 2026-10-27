import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (pehle koi auth nahi tha — koi bhi stock adjust kar sakta tha).
    // Body userId IGNORE. Warehouse tenant scope check (Task 95) — doosre distributor ka
    // warehouse touch nahi ho sakta.
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { warehouseId, productId, type, qty, reason } = body
    if (!warehouseId || !productId || !type || !qty || !reason) {
      return jsonError('Warehouse, product, type, qty aur reason required hain')
    }
    const nQty = Number(qty)
    if (nQty <= 0) return jsonError('Qty positive honi chahiye')

    const warehouse = await db.warehouse.findUnique({ where: { id: warehouseId } })
    if (!warehouse) return jsonError('Warehouse nahi mila', 404)
    const tm = await tenantMismatch(user, warehouse.distributorId)
    if (tm) return tm

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
      data: { warehouseId, productId, type, qty: nQty, reason, userId: user.id },
    })
    return Response.json({ adjustment })
  } catch (e) {
    console.error(e)
    return jsonError('Adjustment failed', 500)
  }
}
