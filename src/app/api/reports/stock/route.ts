import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { unitCostMap, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — STOCK REPORT
//   • Product-wise stock (sab warehouses ka Σ batches): qty, cost value
//     (weighted-avg purchase cost), trade value
//   • LOW STOCK: stock ≤ threshold (cartons, default 5 — param lowCtns)
//   • SLOW MOVING: stock > 0 lekin pichle N dino (default 30 — param
//     slowDays) mein ek bhi unit nahi biki — last sold date ke sath
//   • EXPIRING: batches jo N dino (default 60 — param expDays) mein
//     expire ho rahi hain (FMCG ke liye critical)
// Task 131 — REORDER SUGGESTION: sale velocity (last velDays, default 30)
//   se avg daily sale → cover days (stock ÷ velocity) → suggested order
//   (velocity × reorderDays default 14 − current stock), units + cartons.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!user.profile) return jsonError('Distributor profile not found', 404)
    const profileId = user.profile.id

    const lowCtns = Math.max(1, Number(url.searchParams.get('lowCtns')) || 5)
    const slowDays = Math.max(1, Number(url.searchParams.get('slowDays')) || 30)
    const expDays = Math.max(1, Number(url.searchParams.get('expDays')) || 60)
    // Task 131 — reorder params
    const velDays = Math.max(7, Number(url.searchParams.get('velDays')) || 30)
    const reorderDays = Math.max(1, Number(url.searchParams.get('reorderDays')) || 14)

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

    // Task 131 — sale velocity (last velDays billed units per product)
    const velSince = new Date()
    velSince.setDate(velSince.getDate() - velDays)
    const velRows = await db.orderItem.groupBy({
      by: ['productId'],
      where: { order: { distributorId: profileId, orderDate: { gte: velSince }, status: { not: 'CANCELLED' } } },
      _sum: { qty: true },
    })
    const soldVel = new Map<string, number>()
    for (const r of velRows) soldVel.set(r.productId, r._sum.qty ?? 0)

    const rows = products.map((p) => {
      const a = agg.get(p.id) ?? { qty: 0, expSoonQty: 0, expSoonMin: null as Date | null }
      const upc = Math.max(1, p.unitsPerCarton || 1)
      const uc = unitCost(p.id)
      const ls = lastSoldEver.get(p.id)
      // Task 131 — velocity + reorder
      const sold = soldVel.get(p.id) ?? 0
      const avgDaily = r2(sold / velDays)
      const coverDays = a.qty > 0 ? (avgDaily > 0 ? r2(a.qty / avgDaily) : null) : 0
      const suggestedUnits = Math.max(0, Math.ceil(avgDaily * reorderDays - a.qty))
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
        soldVelDays: sold,
        avgDaily,
        coverDays,
        suggestedUnits,
        suggestedCtns: r2(suggestedUnits / upc),
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
    // Task 131 — reorder suggestions (jahan mangwana hai — velocity par based)
    const reorderRows = rows
      .filter((x) => x.suggestedUnits > 0)
      .sort((a, b) => b.suggestedUnits * b.unitCost - a.suggestedUnits * a.unitCost)

    return Response.json({
      params: { lowCtns, slowDays, expDays, velDays, reorderDays },
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
        reorderSkus: reorderRows.length,
        reorderUnits: reorderRows.reduce((t, x) => t + x.suggestedUnits, 0),
        reorderCostValue: r2(reorderRows.reduce((t, x) => t + x.suggestedUnits * x.unitCost, 0)),
      },
      stock: stockRows.sort((x, y) => y.costValue - x.costValue),
      lowStock: lowRows,
      slowMoving: slowRows,
      expiring: expRows,
      outOfStock: outRows,
      reorder: reorderRows,
    })
  } catch (e) {
    console.error('reports/stock', e)
    return jsonError('Stock report fail — server error', 500)
  }
}
