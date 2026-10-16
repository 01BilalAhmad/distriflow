import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, parseRange, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — RETURNS & CLAIMS REPORT (loss control)
//   • Shop-wise returns (period): value, type split (DAMAGED/EXPIRED/
//     UNSOLD), return rate (shop ke sales par %), status counts
//   • Product-wise returns: qty + value — kaunsa SKU wapas aa raha hai
//   • Claims: type/status breakdown + list
// Return rate = returnsValue ÷ us shop ki net sales (same period)
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
    const { from, to } = parseRange(url)

    const returns = await db.saleReturn.findMany({
      where: { outlet: { distributorId: profileId }, createdAt: { gte: from, lte: to } },
      select: {
        id: true, returnNo: true, type: true, status: true, totalValue: true, createdAt: true, orderId: true,
        outlet: { select: { id: true, name: true, code: true, city: true, salesman: { select: { name: true } } } },
        items: { select: { productId: true, qty: true, value: true, product: { select: { name: true, sku: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // shop sales (rate ke liye)
    const orders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      select: { outletId: true, total: true },
    })
    const salesByShop = new Map<string, number>()
    for (const o of orders) salesByShop.set(o.outletId, r2((salesByShop.get(o.outletId) ?? 0) + o.total))

    type SA = { shop: string; code: string; city: string; booker: string; value: number; rets: number; types: Map<string, number>; pending: number; approved: number; rejected: number }
    const shopAgg = new Map<string, SA>()
    type PA = { name: string; sku: string; qty: number; value: number }
    const prodAgg = new Map<string, PA>()
    const typeAgg = new Map<string, { count: number; value: number }>()

    for (const r of returns) {
      const s = shopAgg.get(r.outlet.id) ?? { shop: r.outlet.name, code: r.outlet.code, city: r.outlet.city, booker: r.outlet.salesman?.name ?? 'Unassigned', value: 0, rets: 0, types: new Map<string, number>(), pending: 0, approved: 0, rejected: 0 }
      s.rets += 1
      if (r.status !== 'REJECTED') s.value = r2(s.value + r.totalValue)
      s.types.set(r.type, (s.types.get(r.type) ?? 0) + 1)
      if (r.status === 'PENDING') s.pending += 1
      if (r.status === 'APPROVED') s.approved += 1
      if (r.status === 'REJECTED') s.rejected += 1
      shopAgg.set(r.outlet.id, s)

      if (r.status !== 'REJECTED') {
        const t = typeAgg.get(r.type) ?? { count: 0, value: 0 }
        t.count += 1
        t.value = r2(t.value + r.totalValue)
        typeAgg.set(r.type, t)
        for (const it of r.items) {
          const p = prodAgg.get(it.productId) ?? { name: it.product.name, sku: it.product.sku, qty: 0, value: 0 }
          p.qty += it.qty
          p.value = r2(p.value + it.value)
          prodAgg.set(it.productId, p)
        }
      }
    }

    const shopWise = [...shopAgg.entries()]
      .map(([outletId, s]) => {
        const sales = salesByShop.get(outletId) ?? 0
        return {
          outletId,
          shop: s.shop, code: s.code, city: s.city, booker: s.booker,
          returnsCount: s.rets,
          returnsValue: s.value,
          salesInPeriod: sales,
          returnRatePct: sales > 0 ? r2((s.value / sales) * 100) : (s.value > 0 ? 100 : 0),
          damaged: s.types.get('DAMAGED') ?? 0,
          expired: s.types.get('EXPIRED') ?? 0,
          unsold: s.types.get('UNSOLD') ?? 0,
          pending: s.pending, approved: s.approved, rejected: s.rejected,
        }
      })
      .sort((x, y) => y.returnsValue - x.returnsValue)

    const productWise = [...prodAgg.entries()]
      .map(([productId, p]) => ({ productId, ...p }))
      .sort((x, y) => y.value - x.value)

    const claims = await db.claim.findMany({
      where: { distributorId: profileId, createdAt: { gte: from, lte: to } },
      select: { claimNo: true, type: true, amount: true, status: true, reason: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    })
    const claimsByType = ['SCHEME_CLAIM', 'DAMAGED', 'RETURN_CLAIM', 'OTHER'].map((t) => {
      const rows = claims.filter((c) => c.type === t)
      return {
        type: t,
        count: rows.length,
        amount: r2(rows.reduce((s, c) => s + c.amount, 0)),
        approved: r2(rows.filter((c) => c.status === 'APPROVED').reduce((s, c) => s + c.amount, 0)),
        pending: r2(rows.filter((c) => c.status === 'PENDING').reduce((s, c) => s + c.amount, 0)),
      }
    }).filter((x) => x.count > 0)

    const approvedValue = r2(returns.filter((r) => r.status === 'APPROVED').reduce((t, r) => t + r.totalValue, 0))
    const totalReturnsValue = r2(returns.filter((r) => r.status !== 'REJECTED').reduce((t, r) => t + r.totalValue, 0))
    const grandSales = r2([...salesByShop.values()].reduce((t, v) => t + v, 0))
    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        returnsCount: returns.length,
        approvedValue,
        pendingCount: returns.filter((r) => r.status === 'PENDING').length,
        pendingValue: r2(returns.filter((r) => r.status === 'PENDING').reduce((t, r) => t + r.totalValue, 0)),
        totalSales: grandSales,
        returnRatePct: grandSales > 0 ? r2((totalReturnsValue / grandSales) * 100) : 0,
        claimsAmount: r2(claims.reduce((t, c) => t + c.amount, 0)),
      },
      typeSummary: [...typeAgg.entries()].map(([type, x]) => ({ type, ...x })),
      shopWise,
      productWise,
      claimsByType,
      claimsList: claims.slice(0, 100).map((c) => ({ ...c, createdAt: c.createdAt.toISOString(), amount: r2(c.amount) })),
    })
  } catch (e) {
    console.error('reports/returns-claims', e)
    return jsonError('Returns claims report fail — server error', 500)
  }
}
