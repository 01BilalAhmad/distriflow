import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — ORDER BOOKER PERFORMANCE REPORT
// Per booker (period): orders, distinct shops served, gross/net sales,
// discounts diya, avg order value, lines-per-drop (productivity),
// free units (scheme maal), recovery collected (APPROVED vouchers),
// shops assigned vs served ratio, last activity.
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
    const { from, to } = parseRange(url)

    const dist = await db.distributorProfile.findUnique({ where: { id: profileId }, select: { userId: true } })
    if (!dist) return jsonError('Distributor profile not found', 404)
    const bookers = await db.user.findMany({
      where: { parentId: dist.userId, role: 'SALESMAN' },
      select: { id: true, name: true, phone: true, isActive: true },
      orderBy: { name: 'asc' },
    })
    const bIds = bookers.map((b) => b.id)

    // assigned shops per booker
    const assignedRows = await db.outlet.groupBy({
      by: ['salesmanId'],
      where: { distributorId: profileId, isActive: true, salesmanId: { in: bIds } },
      _count: { _all: true },
    })
    const assigned = new Map(assignedRows.map((r) => [r.salesmanId!, r._count._all]))

    const orders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' }, salesmanId: { in: bIds } },
      select: {
        id: true, salesmanId: true, outletId: true, total: true, schemeDiscount: true, manualDiscount: true, orderDate: true,
        items: { select: { qty: true, freeQty: true } },
      },
    })

    type BA = { orders: number; shops: Set<string>; gross: number; disc: number; freeUnits: number; lines: number; last: Date | null }
    const agg = new Map<string, BA>()
    for (const o of orders) {
      const a = agg.get(o.salesmanId!) ?? { orders: 0, shops: new Set<string>(), gross: 0, disc: 0, freeUnits: 0, lines: 0, last: null as Date | null }
      a.orders += 1
      a.shops.add(o.outletId)
      a.gross = r2(a.gross + o.total)
      a.disc = r2(a.disc + o.schemeDiscount + o.manualDiscount)
      for (const it of o.items) { a.freeUnits += it.freeQty; a.lines += 1 }
      if (!a.last || o.orderDate > a.last) a.last = o.orderDate
      agg.set(o.salesmanId!, a)
    }

    // recovery (APPROVED) per booker in period
    const rec = await db.recovery.groupBy({
      by: ['bookerId'],
      where: { outlet: { distributorId: profileId }, recoveredAt: { gte: from, lte: to }, status: 'APPROVED', bookerId: { in: bIds } },
      _sum: { amount: true },
    })
    const recMap = new Map(rec.map((r) => [r.bookerId!, r._sum.amount ?? 0]))

    const rows = bookers.map((b) => {
      const a = agg.get(b.id)
      const assign = assigned.get(b.id) ?? 0
      return {
        bookerId: b.id,
        bookerName: b.name,
        phone: b.phone,
        isActive: b.isActive,
        orders: a?.orders ?? 0,
        shopsServed: a?.shops.size ?? 0,
        shopsAssigned: assign,
        coveragePct: assign > 0 ? r2(((a?.shops.size ?? 0) / assign) * 100) : 0,
        netSales: a?.gross ?? 0,
        discountGiven: a?.disc ?? 0,
        avgOrderValue: a && a.orders > 0 ? r2(a.gross / a.orders) : 0,
        linesPerDrop: a && a.orders > 0 ? r2(a.lines / a.orders) : 0,
        freeUnits: a?.freeUnits ?? 0,
        recoveryCollected: r2(recMap.get(b.id) ?? 0),
        lastOrderDate: a?.last?.toISOString() ?? null,
      }
    }).sort((x, y) => y.netSales - x.netSales)

    const totOrders = rows.reduce((t, x) => t + x.orders, 0)
    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        bookers: rows.length,
        activeBookers: rows.filter((x) => x.orders > 0).length,
        orders: totOrders,
        netSales: r2(rows.reduce((t, x) => t + x.netSales, 0)),
        recoveryCollected: r2(rows.reduce((t, x) => t + x.recoveryCollected, 0)),
        avgOrderValue: totOrders > 0 ? r2(rows.reduce((t, x) => t + x.netSales, 0) / totOrders) : 0,
      },
      rows,
    })
  } catch (e) {
    console.error('reports/booker-performance', e)
    return jsonError('Booker performance report fail — server error', 500)
  }
}
