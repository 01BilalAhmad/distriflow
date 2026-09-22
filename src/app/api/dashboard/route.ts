import { db } from '@/lib/db'
import { resolveScope, jsonError, megaBlocked, tenantProfileId } from '@/lib/dms-scope'

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
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const ctx = await resolveScope(userId)
    const mb = megaBlocked(ctx.role)
    if (mb) return mb

    // ---- scope filters ----
    const orderWhere = ctx.role === 'SALESMAN' ? { salesmanId: userId } : { distributorId: ctx.profileId! }
    const outletWhere = ctx.role === 'SALESMAN' ? { salesmanId: userId } : { distributorId: ctx.profileId! }
    const whWhere = { distributorId: ctx.profileId! }
    const claimWhere = { distributorId: ctx.profileId! }
    const salesmanIds =
      ctx.role === 'SALESMAN'
        ? [userId]
        : (
            await db.user.findMany({
              where: ctx.role === 'DISTRIBUTOR' ? { parentId: (await db.distributorProfile.findUnique({ where: { id: ctx.profileId! } }))!.userId } : { parentId: userId },
              select: { id: true },
            })
          ).map((u) => u.id)

    const today0 = startOfDay()
    const mStart = monthStart()

    const [todayOrders, monthOrders, activeOutlets, pendingOrders, pendingReturns, pendingClaims, batches, todayPjp, allReturns] =
      await Promise.all([
        db.order.findMany({ where: { ...orderWhere, orderDate: { gte: today0 } }, select: { total: true } }),
        db.order.findMany({ where: { ...orderWhere, orderDate: { gte: mStart } }, select: { total: true, orderDate: true, channel: true, distributorId: true } }),
        db.outlet.count({ where: { ...outletWhere, isActive: true } }),
        db.order.count({ where: { ...orderWhere, status: { in: ['CONFIRMED', 'PARTIALLY_DELIVERED'] } } }),
        db.saleReturn.count({ where: { status: 'PENDING', outletId: { in: await scopedIdsForReturns(ctx, userId) } } }),
        db.claim.count({ where: { ...claimWhere, status: 'PENDING' } }),
        db.stockBatch.findMany({
          where: { warehouse: { distributorId: ctx.profileId! } },
          include: { product: { select: { name: true, tradePrice: true, unitsPerCarton: true } }, warehouse: { select: { name: true } } },
        }),
        db.pJPPlan.findMany({
          where: { date: { gte: today0, lt: new Date(today0.getTime() + 86400000) }, salesmanId: { in: salesmanIds } },
          include: { salesman: { select: { name: true } }, visits: true },
        }),
        db.saleReturn.findMany({ where: { outlet: ctx.role === 'SALESMAN' ? { salesmanId: userId } : { distributorId: ctx.profileId! } } }),
      ])

    const todaySales = todayOrders.reduce((s, o) => s + o.total, 0)
    const monthSales = monthOrders.reduce((s, o) => s + o.total, 0)
    // stock PIECES base hai — value = pcs * (tradePrice per carton / unitsPerCarton)
    const stockValue = batches.reduce((s, b) => s + b.qty * (b.product.tradePrice / Math.max(1, b.product.unitsPerCarton)), 0)

    // product stock totals for low stock detection (pcs) — threshold 30 carton-equivalent
    const stockByProduct = new Map<string, number>()
    for (const b of batches) stockByProduct.set(b.productId, (stockByProduct.get(b.productId) ?? 0) + b.qty)
    // Task 23: tenant scope — sirf apne catalog ke products (salesman => owner distributor ka catalog)
    const tenantId = await tenantProfileId(userId)
    const allProducts = tenantId
      ? await db.product.findMany({ where: { distributorId: tenantId }, select: { id: true, name: true, unitsPerCarton: true } })
      : []
    const lowOf = (pid: string) => (stockByProduct.get(pid) ?? 0) < 30 * Math.max(1, allProducts.find((p) => p.id === pid)?.unitsPerCarton ?? 1)
    const lowStockItems = allProducts.filter((p) => lowOf(p.id)).length

    // ---- sales trend last 14 days ----
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

    // ---- top products (last 30 days by qty) ----
    const topOrders = await db.order.findMany({
      where: { ...orderWhere, orderDate: { gte: daysAgo(29) } },
      include: { items: { include: { product: { select: { name: true } } } } },
    })
    const prodMap = new Map<string, { qty: number; value: number }>()
    for (const o of topOrders) {
      for (const it of o.items) {
        const cur = prodMap.get(it.product.name) ?? { qty: 0, value: 0 }
        cur.qty += it.qty + it.freeQty
        cur.value += it.lineTotal
        prodMap.set(it.product.name, cur)
      }
    }
    const topProducts = Array.from(prodMap.entries())
      .map(([name, v]) => ({ name: name.length > 22 ? name.slice(0, 20) + '…' : name, ...v }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)

    // ---- channel mix (month) ----
    const chanMap = new Map<string, number>()
    for (const o of monthOrders) chanMap.set(o.channel, (chanMap.get(o.channel) ?? 0) + o.total)
    const channelMix = Array.from(chanMap.entries()).map(([channel, value]) => ({ channel, value }))

    // ---- distributor performance (month) ----
    let distributorPerf: { name: string; orders: number; sales: number; collection: number }[] = []
    if (ctx.role !== 'SALESMAN' && ctx.profileId) {
      const prof = await db.distributorProfile.findUnique({ where: { id: ctx.profileId } })
      const monthColls = await db.collection.findMany({ where: { date: { gte: mStart }, outlet: { distributorId: ctx.profileId } } })
      if (prof) {
        distributorPerf = [
          {
            name: prof.businessName,
            orders: monthOrders.length,
            sales: monthSales,
            collection: monthColls.reduce((s, c) => s + c.amount, 0),
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
        todayOrders: todayOrders.length,
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

async function scopedIdsForReturns(ctx: { role: string }, userId: string): Promise<string[]> {
  if (ctx.role === 'SALESMAN') {
    const all = await db.outlet.findMany({ where: { salesmanId: userId }, select: { id: true } })
    return all.map((o) => o.id)
  }
  const ctx2 = await resolveScope(userId)
  const all = await db.outlet.findMany({ where: { distributorId: ctx2.profileId! }, select: { id: true } })
  return all.map((o) => o.id)
}
