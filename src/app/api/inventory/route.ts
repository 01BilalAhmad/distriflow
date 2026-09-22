import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const whWhere = { distributorId: user.profile?.id }
    const warehouses = await db.warehouse.findMany({
      where: whWhere,
      include: {
        distributor: { select: { businessName: true } },
        stockBatches: { include: { product: { select: { id: true, name: true, sku: true, brand: { select: { name: true } }, company: { select: { name: true } }, category: true, tradePrice: true, unitsPerCarton: true, boxesPerCarton: true, pcsPerBox: true } } } },
      },
      orderBy: [{ isPrimary: 'desc' }, { name: 'asc' }],
    })

    const adjustments = await db.stockAdjustment.findMany({
      where: { warehouse: { distributorId: user.profile?.id } },
      include: {
        product: { select: { name: true } },
        warehouse: { select: { name: true } },
        user: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    })

    const now = new Date()
    const nearExpiryLimit = new Date(now.getTime() + 30 * 86400000)

    const whDtos = warehouses.map((w) => {
      const prodMap = new Map<string, typeof w.stockBatches>()
      for (const b of w.stockBatches) {
        const arr = prodMap.get(b.productId) ?? []
        arr.push(b)
        prodMap.set(b.productId, arr)
      }
      const rows = Array.from(prodMap.entries()).map(([pid, batches]) => {
        const totalQty = batches.reduce((s, b) => s + b.qty, 0)
        const sorted = [...batches].sort((a, b) => {
          if (!a.expDate) return 1
          if (!b.expDate) return -1
          return new Date(a.expDate).getTime() - new Date(b.expDate).getTime()
        })
        const nearest = sorted.find((b) => b.qty > 0)?.expDate ?? null
        const nearExpiryQty = batches
          .filter((b) => b.expDate && new Date(b.expDate) <= nearExpiryLimit)
          .reduce((s, b) => s + b.qty, 0)
        return {
          productId: pid,
          productName: batches[0].product.name,
          sku: batches[0].product.sku,
          brand: batches[0].product.brand.name,
          company: batches[0].product.company?.name ?? null,
          category: batches[0].product.category,
          totalQty,
          unitsPerCarton: batches[0].product.unitsPerCarton,
          boxesPerCarton: batches[0].product.boxesPerCarton,
          pcsPerBox: batches[0].product.pcsPerBox,
          tradePrice: batches[0].product.tradePrice,
          // stock PIECES base — value = pcs * (per-carton trade price / units per carton)
          value: Math.round(totalQty * (batches[0].product.tradePrice / Math.max(1, batches[0].product.unitsPerCarton)) * 100) / 100,
          nearestExpiry: nearest ? new Date(nearest).toISOString() : null,
          nearExpiryQty,
          batches: batches.map((b) => ({
            id: b.id,
            batchNo: b.batchNo,
            qty: b.qty,
            mfgDate: b.mfgDate ? new Date(b.mfgDate).toISOString() : null,
            expDate: b.expDate ? new Date(b.expDate).toISOString() : null,
            receivedAt: new Date(b.receivedAt).toISOString(),
          })),
        }
      })
      rows.sort((a, b) => b.value - a.value)
      return {
        id: w.id,
        name: w.name,
        city: w.city,
        isPrimary: w.isPrimary,
        distributorName: w.distributor.businessName,
        totalQty: rows.reduce((s, r) => s + r.totalQty, 0),
        totalValue: rows.reduce((s, r) => s + r.value, 0),
        rows,
      }
    })

    const summary = {
      totalQty: whDtos.reduce((s, w) => s + w.totalQty, 0),
      totalValue: whDtos.reduce((s, w) => s + w.totalValue, 0),
      nearExpiryValue: whDtos.reduce(
        (s, w) => s + w.rows.reduce((x, r) => x + r.nearExpiryQty * (r.tradePrice / Math.max(1, r.unitsPerCarton)), 0),
        0
      ),
      outOfStock: (() => {
        const allProducts = new Set<string>()
        const stocked = new Set<string>()
        for (const w of whDtos) for (const r of w.rows) { allProducts.add(r.productId); if (r.totalQty > 0) stocked.add(r.productId) }
        return 0 // computed client-side with product count
      })(),
    }

    return Response.json({
      warehouses: whDtos,
      summary,
      adjustments: adjustments.map((a) => ({
        id: a.id,
        productName: a.product.name,
        warehouseName: a.warehouse.name,
        type: a.type,
        qty: a.qty,
        reason: a.reason,
        userName: a.user?.name ?? null,
        createdAt: new Date(a.createdAt).toISOString(),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Inventory load failed', 500)
  }
}
