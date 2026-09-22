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

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: userId }
        : { distributorId: user.profile?.id }

    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5)
    sixMonthsAgo.setDate(1)
    sixMonthsAgo.setHours(0, 0, 0, 0)

    const orders = await db.order.findMany({
      where: { ...where, orderDate: { gte: sixMonthsAgo }, status: { not: 'CANCELLED' } },
      include: {
        items: { include: { product: { select: { name: true, brand: { select: { name: true } } } } } },
        outlet: { select: { name: true, channel: true, city: true } },
      },
      orderBy: { orderDate: 'asc' },
    })

    // monthly trend
    const monthMap = new Map<string, number>()
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const key = d.toLocaleString('en-US', { month: 'short' })
      monthMap.set(key, 0)
    }
    for (const o of orders) {
      const key = new Date(o.orderDate).toLocaleString('en-US', { month: 'short' })
      if (monthMap.has(key)) monthMap.set(key, (monthMap.get(key) ?? 0) + o.total)
    }
    const monthlyTrend = Array.from(monthMap.entries()).map(([month, sales]) => ({ month, sales }))

    // channel breakdown
    const chanMap = new Map<string, number>()
    for (const o of orders) chanMap.set(o.channel, (chanMap.get(o.channel) ?? 0) + o.total)
    const channelBreakdown = Array.from(chanMap.entries()).map(([channel, value]) => ({ channel, value }))

    // top outlets
    const outletMap = new Map<string, number>()
    for (const o of orders) outletMap.set(o.outlet.name, (outletMap.get(o.outlet.name) ?? 0) + o.total)
    const topOutlets = Array.from(outletMap.entries())
      .map(([name, value]) => ({ name, value }))
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
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)

    // city performance
    const cityMap = new Map<string, number>()
    for (const o of orders) {
      const city = o.outlet.city
      cityMap.set(city, (cityMap.get(city) ?? 0) + o.total)
    }
    const cityPerf = Array.from(cityMap.entries()).map(([city, value]) => ({ city, value }))

    const totalSales = orders.reduce((s, o) => s + o.total, 0)
    const totalDiscount = orders.reduce((s, o) => s + o.schemeDiscount, 0)
    const avgOrderValue = orders.length > 0 ? Math.round(totalSales / orders.length) : 0

    return Response.json({
      summary: { totalSales, totalDiscount, totalOrders: orders.length, avgOrderValue },
      monthlyTrend,
      channelBreakdown,
      topOutlets,
      brandPerf,
      cityPerf,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Reports load failed', 500)
  }
}
