import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { r2, fifoUncoveredDebits, agingBucket, type LedgerEntryLite } from '@/lib/reports-kit-server'
import { karachiDayBounds } from '@/lib/dms-day'

// ============================================================
// Task 134 — DASHBOARD v2 (Ops Dense redesign)
// Purane 4-card dashboard ki jagah poora operations cockpit:
//   • 8 KPI tiles (sales/recovery/udhaar/overdue/stock/pjp/AOV)
//   • Sales vs Recovery 14-day combo + 5-day mini table
//   • Receivable Aging 30-60-90 (FIFO — aging report jaisa hi) + 7-din pehle ka
//     snapshot se trend arrows
//   • Order Booker Performance 30d matrix (orders/sales/recovery/fill%/pjp%/overdue)
//   • Top Overdue Shops (aging rows) + Pending Approvals + No Visit 7+ days
//   • Day Book footer (aaj ka hisaab — day-book report ke numbers)
// Report helpers (fifoUncoveredDebits/agingBucket) reuse — numbers reports se
// exactly match karein. SALESMAN scope = sirf apni shops/apni row.
// ============================================================

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
const DAY_MS = 86400000

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

    // ---- scope filters (purane dashboard jaisa hi) ----
    const orderWhere = role === 'SALESMAN' ? { salesmanId: user.id } : { distributorId: profileId! }
    const outletWhere = orderWhere
    // Task 136: CANCELLED bill SALE NAHI hai — user report: process -> un-process -> cancel
    // ki gayi bill phir bhi Aaj ki Sales / Month Sales / 14-day chart mein gin rahi thi.
    // Tamam SALES aggregates (today/yesterday/month/trend) par ye filter lagta hai;
    // pendingOrders/fill-rate/bookers jaisi queries apne status filters khud rakhti hain.
    const salesWhere = { ...orderWhere, status: { not: 'CANCELLED' } }
    const claimWhere = profileId ? { distributorId: profileId } : { id: { in: [] as string[] } }
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
    const todayEnd = new Date(today0.getTime() + DAY_MS)
    const yest0 = daysAgo(1)
    const mStart = monthStart()
    const d13 = daysAgo(13)
    const d29 = daysAgo(29)
    const d7 = daysAgo(7)
    const d59 = daysAgo(59)
    // PJP ka din hamesha Asia/Karachi hisaab se (booker app / pjp/today jaisa hi — Task 82)
    const pjpWin = karachiDayBounds()
    // Stock/catalog tenant — salesman ka owner distributor (Task 95 tenantOf pattern)
    const tenantId = await tenantOf({ id: user.id, profileId, parentId: user.parentId })

    // ---- ROUND 1: sab independent queries ek saath ----
    const [
      todayAgg, yestAgg, monthChannelAgg, pendingOrders, pendingReturns, pendingClaims, batches, todayPjp,
      recoveryTodayAgg, pendingRecovery, collectionsTodayAgg, returnsToday, claimsToday,
      trendOrders, recoveries14, orders30, outlets, visitsWindow, bookers,
    ] = await Promise.all([
      db.order.aggregate({ where: { ...salesWhere, orderDate: { gte: today0 } }, _sum: { total: true }, _count: true }),
      db.order.aggregate({ where: { ...salesWhere, orderDate: { gte: yest0, lt: today0 } }, _sum: { total: true } }),
      db.order.groupBy({
        by: ['channel'],
        where: { ...salesWhere, orderDate: { gte: mStart } },
        _sum: { total: true },
        _count: true,
      }),
      db.order.count({ where: { ...orderWhere, status: { in: ['CONFIRMED', 'PARTIALLY_DELIVERED'] } } }),
      db.saleReturn.count({ where: { status: 'PENDING', outlet: orderWhere } }),
      db.claim.count({ where: { ...claimWhere, status: 'PENDING' } }),
      db.stockBatch.findMany({
        where: tenantId ? { warehouse: { distributorId: tenantId } } : { id: { in: [] as string[] } },
        select: { qty: true, productId: true, product: { select: { tradePrice: true, unitsPerCarton: true } } },
      }),
      db.pJPPlan.findMany({
        where: { date: { gte: pjpWin.start, lt: pjpWin.end }, salesmanId: { in: salesmanIds } },
        include: { salesman: { select: { name: true } }, visits: true },
      }),
      // Recovery Today (Wasooli) — sirf APPROVED (day-book wasooli jaisa)
      db.recovery.aggregate({
        where: { outlet: outletWhere, recoveredAt: { gte: today0 }, status: 'APPROVED' },
        _sum: { amount: true }, _count: true,
      }),
      db.recovery.count({ where: { outlet: outletWhere, status: 'PENDING' } }),
      // Cash-In receipts aaj (RCP — day-book cashCollected jaisa)
      db.collection.aggregate({
        where: { outlet: outletWhere, date: { gte: today0 } },
        _sum: { amount: true }, _count: true,
      }),
      db.saleReturn.count({ where: { outlet: outletWhere, createdAt: { gte: today0 } } }),
      db.claim.count({ where: { ...claimWhere, createdAt: { gte: today0 } } }),
      // 14-day sales trend (CANCELLED excluded — Task 136)
      db.order.findMany({
        where: { ...salesWhere, orderDate: { gte: d13 } },
        select: { total: true, orderDate: true },
      }),
      // 14-day recovery trend (APPROVED)
      db.recovery.findMany({
        where: { outlet: outletWhere, recoveredAt: { gte: d13 }, status: 'APPROVED' },
        select: { recoveredAt: true, amount: true },
      }),
      // 30-day orders (items + deliveries) — fill rate per booker + overall
      db.order.findMany({
        where: { ...orderWhere, orderDate: { gte: d29 }, status: { not: 'CANCELLED' } },
        select: {
          salesmanId: true,
          items: { select: { productId: true, qty: true } },
          deliveries: { select: { items: { select: { productId: true, qty: true } } } },
        },
      }),
      // Aging + overdue shops + no-visit ke liye saari scoped shops
      db.outlet.findMany({
        where: outletWhere,
        select: {
          id: true, name: true, code: true, city: true, creditDays: true, isActive: true,
          salesmanId: true, salesman: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
      // Visit compliance window (59 din) — PJP% + last-visit per outlet
      db.visit.findMany({
        where: { plan: { date: { gte: d59, lt: todayEnd }, salesmanId: { in: salesmanIds } } },
        select: { status: true, outletId: true, plan: { select: { salesmanId: true, date: true } } },
      }),
      role === 'SALESMAN'
        ? db.user.findMany({ where: { id: user.id }, select: { id: true, name: true } })
        : db.user.findMany({
            where: { parentId: (await db.distributorProfile.findUnique({ where: { id: profileId! } }))!.userId, role: 'SALESMAN' },
            select: { id: true, name: true },
          }),
    ])

    const todaySales = todayAgg._sum.total ?? 0
    const todayOrders = todayAgg._count ?? 0
    const yesterdaySales = yestAgg._sum.total ?? 0
    const salesDeltaPct = yesterdaySales > 0 ? r2(((todaySales - yesterdaySales) / yesterdaySales) * 100) : null
    const avgOrderValue = todayOrders > 0 ? r2(todaySales / todayOrders) : 0
    const monthSales = monthChannelAgg.reduce((s, r) => s + (r._sum.total ?? 0), 0)

    const recoveryToday = r2(recoveryTodayAgg._sum.amount ?? 0)
    const recoveryCount = recoveryTodayAgg._count ?? 0
    const receiptsToday = collectionsTodayAgg._count ?? 0
    const cashToday = r2(collectionsTodayAgg._sum.amount ?? 0)

    // stock value + low stock (purana logic — pcs base, 30-carton threshold)
    const stockValue = batches.reduce((s, b) => s + b.qty * (b.product.tradePrice / Math.max(1, b.product.unitsPerCarton)), 0)
    const stockByProduct = new Map<string, number>()
    for (const b of batches) stockByProduct.set(b.productId, (stockByProduct.get(b.productId) ?? 0) + b.qty)
    const allProducts = tenantId
      ? await db.product.findMany({ where: { distributorId: tenantId }, select: { id: true, name: true, unitsPerCarton: true } })
      : []
    const lowOf = (pid: string) => (stockByProduct.get(pid) ?? 0) < 30 * Math.max(1, allProducts.find((p) => p.id === pid)?.unitsPerCarton ?? 1)
    const lowStockItems = allProducts.filter((p) => lowOf(p.id)).length

    // ---- PJP today ----
    let pjpDone = 0
    let pjpTotal = 0
    for (const p of todayPjp) {
      pjpTotal += p.visits.length
      pjpDone += p.visits.filter((v) => v.status === 'COMPLETED').length
    }
    const salesmenOnField = todayPjp.filter((p) => p.status === 'IN_PROGRESS').length

    // ---- 14-day sales vs recovery trend + 5-day mini table ----
    const dayLabel = (d: Date) => `${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}`
    const trendMap = new Map<string, { label: string; sales: number; recovery: number }>()
    for (let i = 13; i >= 0; i--) {
      const d = daysAgo(i)
      const key = d.toDateString()
      trendMap.set(key, { label: dayLabel(d), sales: 0, recovery: 0 })
    }
    for (const o of trendOrders) {
      const row = trendMap.get(new Date(o.orderDate).toDateString())
      if (row) row.sales = r2(row.sales + o.total)
    }
    for (const rv of recoveries14) {
      const row = trendMap.get(new Date(rv.recoveredAt).toDateString())
      if (row) row.recovery = r2(row.recovery + rv.amount)
    }
    const trend14 = [...trendMap.values()].map((v) => ({ date: v.label, sales: v.sales, recovery: v.recovery }))
    const mini5 = trend14.slice(-5).map((t, i, arr) => ({ ...t, today: i === arr.length - 1 }))

    // ---- FILL RATE (30d) — overall + per booker (fill-rate report ka exact logic) ----
    type FillAgg = { booked: number; delivered: number }
    const fillAll: FillAgg = { booked: 0, delivered: 0 }
    const fillByBooker = new Map<string, FillAgg>()
    const bump = (m: Map<string, FillAgg>, k: string | null) => {
      const key = k ?? 'counter'
      const cur = m.get(key) ?? { booked: 0, delivered: 0 }
      return cur
    }
    for (const o of orders30) {
      const del = new Map<string, number>()
      for (const d of o.deliveries) for (const it of d.items) del.set(it.productId, (del.get(it.productId) ?? 0) + it.qty)
      const agg = bump(fillByBooker, o.salesmanId)
      for (const it of o.items) {
        const delivered = Math.min(del.get(it.productId) ?? 0, it.qty)
        fillAll.booked += it.qty
        fillAll.delivered += delivered
        agg.booked += it.qty
        agg.delivered += delivered
      }
      fillByBooker.set(o.salesmanId ?? 'counter', agg)
    }
    const fillPct = (f: FillAgg) => (f.booked > 0 ? r2(Math.min(100, (f.delivered / f.booked) * 100)) : 100)
    const fillRate = fillPct(fillAll)

    // ---- AGING (FIFO — aging report jaisa) + 7-din pehle ka snapshot ----
    const outletIds = outlets.map((o) => o.id)
    const ledger = outletIds.length
      ? await db.outletLedger.findMany({
          where: { outletId: { in: outletIds } },
          select: { outletId: true, type: true, amount: true, date: true },
        })
      : []
    const byOutlet = new Map<string, LedgerEntryLite[]>()
    for (const e of ledger) {
      const arr = byOutlet.get(e.outletId) ?? []
      arr.push({ type: e.type, amount: e.amount, date: e.date })
      byOutlet.set(e.outletId, arr)
    }
    const now = Date.now()
    type AgingRow = {
      outletId: string; shop: string; city: string; booker: string; salesmanId: string | null; creditDays: number
      balance: number; b31plus: number; oldestDays: number | null; lastPayDate: Date | null
    }
    const agingRows: AgingRow[] = []
    const bucketsNow = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const bucketShops = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    const bucketsPrev = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    let totalUdhaar = 0
    let udhaarShops = 0
    let overdue31 = 0
    let overdue31Shops = 0
    for (const o of outlets) {
      const entries = byOutlet.get(o.id) ?? []
      if (entries.length === 0) continue
      const s = fifoUncoveredDebits(entries)
      const lastCredit = entries.filter((e) => e.type !== 'DEBIT').reduce((m, e) => (e.date > m ? e.date : m), new Date(0))
      // 7 din pehle ka snapshot — wahi entries, us date tak (trend arrows)
      const sPrev = fifoUncoveredDebits(entries.filter((e) => e.date <= d7))
      if (Math.abs(s.balance) > 0.01) {
        totalUdhaar = r2(totalUdhaar + Math.max(0, s.balance))
        udhaarShops += 1
      }
      let row31plus = 0
      let oldestDays: number | null = null
      const perOutlet = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
      for (const d of s.uncovered) {
        const days = Math.max(0, Math.floor((now - d.date.getTime()) / DAY_MS))
        const b = agingBucket(days)
        perOutlet[b] = r2(perOutlet[b] + d.amount)
        bucketsNow[b] = r2(bucketsNow[b] + d.amount)
        if (!oldestDays || days > oldestDays) oldestDays = days
      }
      for (const d of sPrev.uncovered) {
        const days = Math.max(0, Math.floor((now - d.date.getTime()) / DAY_MS))
        bucketsPrev[agingBucket(days)] = r2(bucketsPrev[agingBucket(days)] + d.amount)
      }
      for (const b of Object.keys(perOutlet) as (keyof typeof perOutlet)[]) if (perOutlet[b] > 0.005) bucketShops[b] += 1
      if (oldestDays != null && oldestDays > 30) {
        row31plus = r2(perOutlet['31-60'] + perOutlet['61-90'] + perOutlet['90+'])
        if (row31plus > 0.005) {
          overdue31 = r2(overdue31 + row31plus)
          overdue31Shops += 1
        }
      }
      if (s.balance > 0.01 && s.uncovered.length > 0) {
        agingRows.push({
          outletId: o.id, shop: o.name, city: o.city,
          booker: o.salesman?.name ?? 'Unassigned', salesmanId: o.salesmanId, creditDays: o.creditDays,
          balance: s.balance, b31plus: row31plus, oldestDays, lastPayDate: lastCredit.getTime() > 0 ? lastCredit : null,
        })
      }
    }
    const totalUdhaarPrev = r2(Object.values(bucketsPrev).reduce((t, v) => t + v, 0))
    const udhaarDeltaPct = totalUdhaarPrev > 0 ? r2(((totalUdhaar - totalUdhaarPrev) / totalUdhaarPrev) * 100) : null
    const agingBuckets = (['0-30', '31-60', '61-90', '90+'] as const).map((b) => ({
      bucket: b,
      amount: bucketsNow[b],
      shops: bucketShops[b],
      prev: bucketsPrev[b],
    }))
    agingRows.sort((a, b) => b.balance - a.balance)
    const topOverdue = agingRows.slice(0, 5).map((r) => ({
      shop: r.shop, zone: r.city, amount: r2(r.balance), days: r.oldestDays ?? 0,
      lastPay: r.lastPayDate ? dayLabel(r.lastPayDate) : '—',
    }))

    // ---- NO VISIT 7+ days (last COMPLETED visit 7+ din pehle / kabhi nahi) ----
    const lastVisit = new Map<string, Date>()
    for (const v of visitsWindow) {
      if (v.status !== 'COMPLETED' && v.status !== 'CHECKED_IN') continue
      const d = v.plan.date
      const cur = lastVisit.get(v.outletId)
      if (!cur || d > cur) lastVisit.set(v.outletId, d)
    }
    const noVisit = outlets
      .filter((o) => o.isActive)
      .map((o) => {
        const last = lastVisit.get(o.id)
        return { shop: o.name, zone: o.city, booker: o.salesman?.name ?? 'Unassigned', days: last ? Math.floor((now - last.getTime()) / DAY_MS) : null }
      })
      .filter((r) => r.days == null || r.days > 7)
      .sort((a, b) => (b.days ?? 999) - (a.days ?? 999))
      .slice(0, 5)

    // ---- BOOKER MATRIX (30d) — Outlets/Orders/Sales/Recovery/Fill%/PJP%/Overdue ----
    const assignedRows = new Map<string, number>()
    for (const o of outlets) {
      if (!o.isActive || !o.salesmanId) continue
      assignedRows.set(o.salesmanId, (assignedRows.get(o.salesmanId) ?? 0) + 1)
    }
    // sales/orders per booker — light groupBy (order.total chahiye):
    const sales30Rows = await db.order.groupBy({
      by: ['salesmanId'],
      where: { ...orderWhere, orderDate: { gte: d29 }, status: { not: 'CANCELLED' } },
      _sum: { total: true },
      _count: true,
    })
    const rec30 = await db.recovery.groupBy({
      by: ['bookerId'],
      where: { outlet: outletWhere, recoveredAt: { gte: d29 }, status: 'APPROVED', bookerId: { in: bookers.map((b) => b.id) } },
      _sum: { amount: true },
    })
    const pjpByBooker = new Map<string, { done: number; total: number }>()
    for (const v of visitsWindow) {
      const key = v.plan.salesmanId
      const cur = pjpByBooker.get(key) ?? { done: 0, total: 0 }
      cur.total += 1
      if (v.status === 'COMPLETED' || v.status === 'CHECKED_IN') cur.done += 1
      pjpByBooker.set(key, cur)
    }
    const overdueByBooker = new Map<string, number>()
    for (const r of agingRows) {
      if (!r.salesmanId) continue
      overdueByBooker.set(r.salesmanId, r2((overdueByBooker.get(r.salesmanId) ?? 0) + r.balance))
    }
    const salesMap = new Map(sales30Rows.map((r) => [r.salesmanId ?? 'counter', { sales: r._sum.total ?? 0, orders: r._count }]))
    const recMap = new Map(rec30.map((r) => [r.bookerId!, r._sum.amount ?? 0]))
    const bookerRows = bookers.map((b) => {
      const f = fillByBooker.get(b.id) ?? { booked: 0, delivered: 0 }
      const pjp = pjpByBooker.get(b.id) ?? { done: 0, total: 0 }
      return {
        bookerId: b.id,
        name: b.name,
        outlets: assignedRows.get(b.id) ?? 0,
        orders: salesMap.get(b.id)?.orders ?? 0,
        sales: r2(salesMap.get(b.id)?.sales ?? 0),
        recovery: r2(recMap.get(b.id) ?? 0),
        fillPct: fillPct(f),
        pjpPct: pjp.total > 0 ? r2((pjp.done / pjp.total) * 100) : null,
        overdue: r2(overdueByBooker.get(b.id) ?? 0),
      }
    }).sort((a, b) => b.sales - a.sales)
    const bookerTotals = {
      outlets: bookerRows.reduce((t, r) => t + r.outlets, 0),
      orders: bookerRows.reduce((t, r) => t + r.orders, 0),
      sales: r2(bookerRows.reduce((t, r) => t + r.sales, 0)),
      recovery: r2(bookerRows.reduce((t, r) => t + r.recovery, 0)),
      fillPct: fillRate,
      pjpPct: pjpTotal > 0 ? r2((pjpDone / pjpTotal) * 100) : null,
      overdue: r2(bookerRows.reduce((t, r) => t + r.overdue, 0)),
    }

    return Response.json({
      kpis: {
        todaySales, todayOrders, yesterdaySales, salesDeltaPct, avgOrderValue,
        recoveryToday, recoveryCount,
        monthSales,
        totalUdhaar: r2(totalUdhaar), udhaarShops, udhaarDeltaPct,
        overdue31: r2(overdue31), overdue31Shops,
        stockValue, lowStockItems,
        pjpDone, pjpTotal, salesmenOnField,
        fillRate,
        pendingOrders, pendingRecovery, pendingReturns, pendingClaims,
      },
      trend14,
      mini5,
      aging: { buckets: agingBuckets, total: r2(totalUdhaar), shops: udhaarShops },
      bookers: bookerRows,
      bookerTotals,
      topOverdue,
      noVisit,
      daybook: {
        sales: r2(todaySales), recovery: recoveryToday, orders: todayOrders,
        receipts: receiptsToday, cash: cashToday,
        returns: returnsToday + claimsToday,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Dashboard data load failed', 500)
  }
}

/** Tenant profile id — distributor ka apna, salesman ka owner (Task 95 pattern) */
async function tenantOf(user: { id: string; profileId: string | null; parentId: string | null }): Promise<string | null> {
  if (user.profileId) return user.profileId
  if (user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, select: { profile: { select: { id: true } } } })
    return owner?.profile?.id ?? null
  }
  return null
}
