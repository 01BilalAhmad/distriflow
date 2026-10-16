import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, unitCostMap, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — STOCK REPORT
//   • Product-wise stock (sab warehouses ka Σ batches): qty, cost value
//     (weighted-avg purchase cost), trade value
//   • LOW STOCK: stock ≤ threshold (cartons, default 5 — param lowCtns)
//   • SLOW MOVING: stock > 0 lekin pichle N dino (default 30 — param
//     slowDays) mein ek bhi unit nahi biki — last sold date ke sath
//   • EXPIRING: batches jo N dino (default 60 — param expDays) mein
//     expire ho rahi hain (FMCG ke liye critical)
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g

    const lowCtns = Math.max(1, Number(url.searchParams.get('lowCtns')) || 5)
    const slowDays = Math.max(1, Number(url.searchParams.get('slowDays')) || 30)
    const expDays = Math.max(1, Number(url.searchParams.get('expDays')) || 60)

    const products = await db.product.findMany({
      where: { distributorId: profileId, isActive: true },
      select: { id: true, name: true, sku: true, unitsPerCarton: true, tradePrice: true, company: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    const pMap = new Map(products.map((p) => [p.id, p]))

    const costMap = await unitCostMap(profileId, new Date())
    const unitCost = (pid: string): number => {
      const c = costMap.get(pid)
      if (c != null) return c
      const p = pMap.get(pid)
      if (!p) return 0
      const upc = Math.max(1, p.unitsPerCarton || 1)
      return r2(p.tradePrice / upc)
    }

    const batches = await db.stockBatch.findMany({
      where: { product: { distributorId: profileId } },
      select: { productId: true, qty: true, expDate: true, batchNo: true },
    })

    type PA = { qty: number; expSoonQty: number; expSoonMin: Date | null }
    const agg = new Map<string, PA>()
    for (const b of batches) {
      const a = agg.get(b.productId) ?? { qty: 0, expSoonQty: 0, expSoonMin: null as Date | null }
      a.qty += b.qty
      const expLimit = new Date()
      expLimit.setDate(expLimit.getDate() + expDays)
      if (b.qty > 0 && b.expDate && b.expDate <= expLimit) {
        a.expSoonQty += b.qty
        if (!a.expSoonMin || b.expDate < a.expSoonMin) a.expSoonMin = b.expDate
      }
      agg.set(b.productId, a)
    }

    // last sold date per product (movement check)
    const since = new Date()
    since.setDate(since.getDate() - slowDays)
    const recentSold = await db.orderItem.findMany({
      where: { order: { distributorId: profileId, orderDate: { gte: since }, status: { not: 'CANCELLED' } } },
      select: { productId: true, order: { select: { orderDate: true } } },
      orderBy: { order: { orderDate: 'desc' } },
    })
    const lastSold = new Map<string, Date>()
    for (const it of recentSold) if (!lastSold.has(it.productId)) lastSold.set(it.productId, it.order.orderDate)
    // slow check ke liye AUR purana movement bhi chahiye (last sold date har product ka)
    const anySold = await db.orderItem.findMany({
      where: { order: { distributorId: profileId, status: { not: 'CANCELLED' } } },
      select: { productId: true, order: { select: { orderDate: true } } },
      orderBy: { order: { orderDate: 'desc' } },
    })
    const lastSoldEver = new Map<string, Date>()
    for (const it of anySold) if (!lastSoldEver.has(it.productId)) lastSoldEver.set(it.productId, it.order.orderDate)

    const rows = products.map((p) => {
      const a = agg.get(p.id) ?? { qty: 0, expSoonQty: 0, expSoonMin: null as Date | null }
      const upc = Math.max(1, p.unitsPerCarton || 1)
      const uc = unitCost(p.id)
      const ls = lastSoldEver.get(p.id)
      return {
        productId: p.id,
        productName: p.name,
        sku: p.sku,
        company: p.company?.name ?? '—',
        qtyUnits: a.qty,
        qtyCtns: r2(a.qty / upc),
        unitCost: uc,
        costValue: r2(a.qty * uc),
        tradeValue: r2((a.qty * p.tradePrice) / upc),
        expSoonQty: a.expSoonQty,
        expSoonDate: a.expSoonMin?.toISOString() ?? null,
        lastSoldDate: ls?.toISOString() ?? null,
        daysSinceSold: ls ? Math.floor((Date.now() - ls.getTime()) / 86400000) : null,
      }
    })

    const stockRows = rows.filter((x) => x.qtyUnits > 0)
    const lowRows = rows
      .filter((x) => x.qtyUnits > 0 && x.qtyCtns <= lowCtns)
      .sort((x, y) => x.qtyCtns - y.qtyCtns)
    const slowRows = rows
      .filter((x) => x.qtyUnits > 0 && (x.daysSinceSold == null || x.daysSinceSold >= slowDays))
      .sort((x, y) => (y.daysSinceSold ?? 9999) - (x.daysSinceSold ?? 9999))
    const expRows = rows
      .filter((x) => x.expSoonQty > 0)
      .sort((x, y) => new Date(x.expSoonDate!).getTime() - new Date(y.expSoonDate!).getTime())
    const outRows = rows.filter((x) => x.qtyUnits === 0)

    return Response.json({
      params: { lowCtns, slowDays, expDays },
      summary: {
        skus: products.length,
        inStockSkus: stockRows.length,
        outOfStockSkus: outRows.length,
        totalCostValue: r2(stockRows.reduce((t, x) => t + x.costValue, 0)),
        totalTradeValue: r2(stockRows.reduce((t, x) => t + x.tradeValue, 0)),
        lowCount: lowRows.length,
        slowCount: slowRows.length,
        expCount: expRows.length,
        expQtyValue: r2(expRows.reduce((t, x) => t + x.costValue, 0)),
      },
      stock: stockRows.sort((x, y) => y.costValue - x.costValue),
      lowStock: lowRows,
      slowMoving: slowRows,
      expiring: expRows,
      outOfStock: outRows,
    })
  } catch (e) {
    console.error('reports/stock', e)
    return jsonError('Stock report fail — server error', 500)
  }
}
