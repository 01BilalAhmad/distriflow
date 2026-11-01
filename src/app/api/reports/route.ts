import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { r2 } from '@/lib/reports-kit-server'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: user.id }
        : { distributorId: user.profile?.id }

    // Task 131 — optional from/to (Overview presets) — default pichle 6 mahine
    const url = new URL(req.url)
    const now = new Date()
    const defFrom = new Date(now.getFullYear(), now.getMonth() - 5, 1)
    let from = url.searchParams.get('from') ? new Date(url.searchParams.get('from') as string) : defFrom
    if (isNaN(from.getTime())) from = defFrom
    from = new Date(from); from.setHours(0, 0, 0, 0)
    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)

    // Task 131 — MoM comparison: is mahine vs pichla mahine (from se independent)
    const mStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const pStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

    const orders = await db.order.findMany({
      where: { ...where, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
      include: {
        items: { include: { product: { select: { name: true, brand: { select: { name: true } } } } } },
        outlet: { select: { name: true, channel: true, city: true } },
      },
      orderBy: { orderDate: 'asc' },
    })

    // monthly trend (from se aaj tak — month buckets)
    const monthMap = new Map<string, number>()
    const cur = new Date(from.getFullYear(), from.getMonth(), 1)
    while (cur <= to) {
      const key = cur.toLocaleString('en-US', { month: 'short' })
      monthMap.set(key, 0)
      cur.setMonth(cur.getMonth() + 1)
    }
    for (const o of orders) {
      const key = new Date(o.orderDate).toLocaleString('en-US', { month: 'short' })
      if (monthMap.has(key)) monthMap.set(key, (monthMap.get(key) ?? 0) + o.total)
    }
    const monthlyTrend = Array.from(monthMap.entries()).map(([month, sales]) => ({ month, sales: r2(sales) }))

    // channel breakdown
    const chanMap = new Map<string, number>()
    for (const o of orders) chanMap.set(o.channel, (chanMap.get(o.channel) ?? 0) + o.total)
    const channelBreakdown = Array.from(chanMap.entries()).map(([channel, value]) => ({ channel, value: r2(value) }))

    // top outlets
    const outletMap = new Map<string, number>()
    for (const o of orders) outletMap.set(o.outlet.name, (outletMap.get(o.outlet.name) ?? 0) + o.total)
    const topOutlets = Array.from(outletMap.entries())
      .map(([name, value]) => ({ name, value: r2(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 8)

    // brand performance
    const brandMap = new Map<string, number>()
    for (const o of orders) {
      for (const it of o.items) {
        const b = it.product.brand.name
        brandMap.set(b, (brandMap.get(b) ?? 0) + it.lineTotal)
      }
    }
    const brandPerf = Array.from(brandMap.entries())
      .map(([name, value]) => ({ name, value: r2(value) }))
      .sort((a, b) => b.value - a.value)

    // city performance
    const cityMap = new Map<string, number>()
    for (const o of orders) {
      const city = o.outlet.city
      cityMap.set(city, (cityMap.get(city) ?? 0) + o.total)
    }
    const cityPerf = Array.from(cityMap.entries()).map(([city, value]) => ({ city, value: r2(value) }))

    const totalSales = r2(orders.reduce((s, o) => s + o.total, 0))
    const totalDiscount = r2(orders.reduce((s, o) => s + o.schemeDiscount, 0))
    const avgOrderValue = orders.length > 0 ? Math.round(totalSales / orders.length) : 0

    // Task 131 — MoM deltas (is month vs pichla month, same where)
    const [thisMonth, lastMonth] = await Promise.all([
      db.order.aggregate({
        where: { ...where, orderDate: { gte: mStart }, status: { not: 'CANCELLED' } },
        _sum: { total: true }, _count: true,
      }),
      db.order.aggregate({
        where: { ...where, orderDate: { gte: pStart, lt: mStart }, status: { not: 'CANCELLED' } },
        _sum: { total: true }, _count: true,
      }),
    ])
    const tSales = r2(thisMonth._sum.total ?? 0)
    const pSales = r2(lastMonth._sum.total ?? 0)
    const pct = (t: number, p: number) => (p > 0.005 ? r2(((t - p) / p) * 100) : null)

    return Response.json({
      summary: { totalSales, totalDiscount, totalOrders: orders.length, avgOrderValue },
      monthlyTrend,
      channelBreakdown,
      topOutlets,
      brandPerf,
      cityPerf,
      // Task 131 — month-over-month comparison
      mom: {
        thisMonth: { sales: tSales, orders: thisMonth._count },
        lastMonth: { sales: pSales, orders: lastMonth._count },
        salesDeltaPct: pct(tSales, pSales),
        ordersDeltaPct: pct(thisMonth._count, lastMonth._count),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Reports load failed', 500)
  }
}
