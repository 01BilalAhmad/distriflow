import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, parseRange, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — TOP SHOPS REPORT (ABC analysis)
// Shops ko net sales ke hisab se sort kar ke cumulative share banta
// hai: A = top jodo jinka cumulative ≤ 80% sales, B = next (≤ 95%),
// C = baqi (tail). Har shop: orders, sales, share %, cumulative %,
// avg order, last order date, channel, booker.
// Pareto focus: 20% shops jo 80% sales deti hain.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
    const { from, to } = parseRange(url)

    const orders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      select: {
        outletId: true, total: true, orderDate: true,
        outlet: { select: { name: true, code: true, city: true, channel: true, salesman: { select: { name: true } } } },
      },
      orderBy: { orderDate: 'asc' },
    })

    type OA = { name: string; code: string; city: string; channel: string; booker: string; sales: number; orders: number; last: Date | null }
    const agg = new Map<string, OA>()
    for (const o of orders) {
      const a = agg.get(o.outletId) ?? { name: o.outlet.name, code: o.outlet.code, city: o.outlet.city, channel: o.outlet.channel, booker: o.outlet.salesman?.name ?? 'Unassigned', sales: 0, orders: 0, last: null as Date | null }
      a.sales = r2(a.sales + o.total)
      a.orders += 1
      if (!a.last || o.orderDate > a.last) a.last = o.orderDate
      agg.set(o.outletId, a)
    }

    const grand = r2([...agg.values()].reduce((t, x) => t + x.sales, 0))
    let cum = 0
    const rows = [...agg.entries()]
      .map(([outletId, a]) => ({
        outletId,
        shop: a.name, code: a.code, city: a.city, channel: a.channel, booker: a.booker,
        orders: a.orders,
        sales: a.sales,
        avgOrder: a.orders > 0 ? r2(a.sales / a.orders) : 0,
        lastOrderDate: a.last?.toISOString() ?? null,
        sharePct: grand > 0 ? r2((a.sales / grand) * 100) : 0,
        cumPct: 0,
        abc: 'C' as 'A' | 'B' | 'C',
      }))
      .sort((x, y) => y.sales - x.sales)

    for (const r of rows) {
      cum = r2(cum + r.sharePct)
      r.cumPct = Math.min(100, cum)
      r.abc = cum <= 80 ? 'A' : cum <= 95 ? 'B' : 'C'
    }

    const counts = {
      A: rows.filter((x) => x.abc === 'A').length,
      B: rows.filter((x) => x.abc === 'B').length,
      C: rows.filter((x) => x.abc === 'C').length,
    }
    const vals = {
      A: r2(rows.filter((x) => x.abc === 'A').reduce((t, x) => t + x.sales, 0)),
      B: r2(rows.filter((x) => x.abc === 'B').reduce((t, x) => t + x.sales, 0)),
      C: r2(rows.filter((x) => x.abc === 'C').reduce((t, x) => t + x.sales, 0)),
    }

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        shops: rows.length,
        totalSales: grand,
        aShops: counts.A, aSales: vals.A,
        bShops: counts.B, bSales: vals.B,
        cShops: counts.C, cSales: vals.C,
        paretoNote: `${counts.A} shops (A class) = Rs ${vals.A.toLocaleString('en-PK')} sales`,
      },
      rows,
    })
  } catch (e) {
    console.error('reports/top-shops', e)
    return jsonError('Top shops report fail — server error', 500)
  }
}
