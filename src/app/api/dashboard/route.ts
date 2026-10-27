import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

function startOfDay(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function daysAgo(n: number): Date {
  const d = startOfDay()
  d.setDate(d.getDate() - n)
  return d
}
function monthStart(d = new Date()): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const role = user.role
    const profileId = user.profile?.id ?? null

    // ---- scope filters ----
    const orderWhere = role === 'SALESMAN' ? { salesmanId: user.id } : { distributorId: profileId! }
    const outletWhere = orderWhere
    const claimWhere = { distributorId: profileId! }
    const salesmanIds =
      role === 'SALESMAN'
        ? [user.id]
        : (
            await db.user.findMany({
              where: role === 'DISTRIBUTOR' ? { parentId: (await db.distributorProfile.findUnique({ where: { id: profileId! } }))!.userId } : { parentId: user.id },
              select: { id: true },
            })
          ).map((u) => u.id)

    const today0 = startOfDay()
    const mStart = monthStart()

    // Task 95 perf: JS-aggregation ki jagah SQL aggregate/groupBy (pehle mahine ke
    // SAARE orders + 30 din ke orders-with-items full rows JS mein aate the)
    const [todayAgg, monthChannelAgg, activeOutlets, pendingOrders, pendingReturns, pendingClaims, batches, todayPjp] =
      await Promise.all([
        db.order.aggregate({ where: { ...orderWhere, orderDate: { gte: today0 } }, _sum: { total: true }, _count: true }),
        db.order.groupBy({
          by: ['channel'],
          where: { ...orderWhere, orderDate: { gte: mStart } },
          _sum: { total: true },
          _count: true,
        }),
        db.outlet.count({ where: { ...outletWhere, isActive: true } }),
        db.order.count({ where: { ...orderWhere, status: { in: ['CONFIRMED', 'PARTIALLY_DELIVERED'] } } }),
        // saleReturn → outlet relation par direct scope (pehle outlet ids ki alag query thi)
        db.saleReturn.count({ where: { status: 'PENDING', outlet: orderWhere } }),
        db.claim.count({ where: { ...claimWhere, status: 'PENDING' } }),
        db.stockBatch.findMany({
          where: { warehouse: { distributorId: profileId! } },
          select: {
            qty: true,
            productId: true,
            warehouse: { select: { name: true } },
            product: { select: { tradePrice: true, unitsPerCarton: true } },
          },
        }),
        db.pJPPlan.findMany({
          where: { date: { gte: today0, lt: new Date(today0.getTime() + 86400000) }, salesmanId: { in: salesmanIds } },
          include: { salesman: { select: { name: true } }, visits: true },
        }),
      ])

    const todaySales = todayAgg._sum.total ?? 0
    const todayOrdersCount = todayAgg._count ?? 0
    const monthSales = monthChannelAgg.reduce((s, r) => s + (r._sum.total ?? 0), 0)
    const monthOrdersCount = monthChannelAgg.reduce((s, r) => s + r._count, 0)
    // stock PIECES base hai — value = pcs * (tradePrice per carton / unitsPerCarton)
    const stockValue = batches.reduce((s, b) => s + b.qty * (b.product.tradePrice / Math.max(1, b.product.unitsPerCarton)), 0)

    // product stock totals for low stock detection (pcs) — threshold 30 carton-equivalent
    const stockByProduct = new Map<string, number>()
    for (const b of batches) stockByProduct.set(b.productId, (stockByProduct.get(b.productId) ?? 0) + b.qty)
    // Task 23: tenant scope — sirf apne catalog ke products (salesman => owner distributor ka catalog)
    const tenantId = await tenantOf({ id: user.id, profileId, parentId: user.parentId })
    const allProducts = tenantId
      ? await db.product.findMany({ where: { distributorId: tenantId }, select: { id: true, name: true, unitsPerCarton: true } })
      : []
    const lowOf = (pid: string) => (stockByProduct.get(pid) ?? 0) < 30 * Math.max(1, allProducts.find((p) => p.id === pid)?.unitsPerCarton ?? 1)
    const lowStockItems = allProducts.filter((p) => lowOf(p.id)).length

    // ---- sales trend last 14 days (2-col rows only — day-bucketing local TZ mein hai) ----
    const trendOrders = await db.order.findMany({
      where: { ...orderWhere, orderDate: { gte: daysAgo(13) } },
      select: { total: true, orderDate: true },
    })
    const trendMap = new Map<string, { sales: number; orders: number }>()
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i)
      const key = `${d.getMonth() + 1}/${d.getDate()}`
      trendMap.set(key, { sales: 0, orders: 0 })
    }
    for (const o of trendOrders) {
      const d = new Date(o.orderDate)
      const key = `${d.getMonth() + 1}/${d.getDate()}`
      const cur = trendMap.get(key) ?? { sales: 0, orders: 0 }
      cur.sales += o.total
      cur.orders += 1
      trendMap.set(key, cur)
    }
    const salesTrend = Array.from(trendMap.entries()).map(([date, v]) => ({ date, ...v }))

    // ---- top products (last 30 days by value) — OrderItem par SQL groupBy ----
    const topRows = await db.orderItem.groupBy({
      by: ['productId'],
      where: { order: { ...orderWhere, orderDate: { gte: daysAgo(29) } } },
      _sum: { qty: true, freeQty: true, lineTotal: true },
      orderBy: { _sum: { lineTotal: 'desc' } },
      take: 6,
    })
    const topProductIds = topRows.map((r) => r.productId)
    const topProductNames = topProductIds.length
      ? await db.product.findMany({ where: { id: { in: topProductIds } }, select: { id: true, name: true } })
      : []
    const nameOf = new Map(topProductNames.map((p) => [p.id, p.name]))
    const topProducts = topRows.map((r) => {
      const raw = nameOf.get(r.productId) ?? '—'
      return {
        name: raw.length > 22 ? raw.slice(0, 20) + '…' : raw,
        qty: (r._sum.qty ?? 0) + (r._sum.freeQty ?? 0),
        value: r._sum.lineTotal ?? 0,
      }
    })

    // ---- channel mix (month — groupBy se hi aya) ----
    const channelMix = monthChannelAgg.map((r) => ({ channel: r.channel, value: r._sum.total ?? 0 }))

    // ---- distributor performance (month) ----
    let distributorPerf: { name: string; orders: number; sales: number; collection: number }[] = []
    if (role !== 'SALESMAN' && profileId) {
      const prof = await db.distributorProfile.findUnique({ where: { id: profileId } })
      const monthColls = await db.collection.aggregate({
        where: { date: { gte: mStart }, outlet: { distributorId: profileId } },
        _sum: { amount: true },
      })
      if (prof) {
        distributorPerf = [
          {
            name: prof.businessName,
            orders: monthOrdersCount,
            sales: monthSales,
            collection: monthColls._sum.amount ?? 0,
          },
        ]
      }
    }

    // ---- low stock rows ----
    const lowStockRows: { product: string; warehouse: string; qty: number; unitsPerCarton: number }[] = []
    for (const p of allProducts) {
      const total = stockByProduct.get(p.id) ?? 0
      if (lowOf(p.id)) {
        const wh = batches.find((b) => b.productId === p.id)?.warehouse.name ?? 'Main Warehouse'
        lowStockRows.push({ product: p.name, warehouse: wh, qty: total, unitsPerCarton: p.unitsPerCarton })
      }
    }
    lowStockRows.sort((a, b) => a.qty - b.qty)

    // ---- pjp today ----
    const pjpToday = todayPjp.map((p) => ({
      salesman: p.salesman.name,
      total: p.visits.length,
      completed: p.visits.filter((v) => v.status === 'COMPLETED').length,
      status: p.status,
    }))

    const salesmenOnField = todayPjp.filter((p) => p.status === 'IN_PROGRESS').length

    return Response.json({
      kpis: {
        todaySales,
        todayOrders: todayOrdersCount,
        monthSales,
        activeOutlets,
        pendingOrders,
        pendingReturns,
        pendingClaims,
        stockValue,
        lowStockItems,
        salesmenOnField,
      },
      salesTrend,
      topProducts,
      channelMix,
      distributorPerf,
      lowStock: lowStockRows.slice(0, 6),
      pjpToday,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Dashboard data load failed', 500)
  }
}

/** Tenant profile id — distributor ka apna, salesman ka owner (Task 95: resolveScope ki jagah direct) */
async function tenantOf(user: { id: string; profileId: string | null; parentId: string | null }): Promise<string | null> {
  if (user.profileId) return user.profileId
  if (user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, select: { profile: { select: { id: true } } } })
    return owner?.profile?.id ?? null
  }
  return null
}
