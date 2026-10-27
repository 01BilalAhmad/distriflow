import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { bookerList, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — ZERO PURCHASE REPORT (month-wise)
// Rule: har shop ko month mein KAM AZ KAM 1 BAAR bill banana chahiye.
// Selected month mein jis shop ka koi order nahi — wo zero purchase shop hai.
// Har shop ke sath: assigned booker, last order (kab + kitna), kitne din
// se soya hua, pichle 3 mahino ka average purchase.
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

    // month param "YYYY-MM" (default current month)
    const now = new Date()
    const mParam = url.searchParams.get('month')
    let year = now.getFullYear()
    let month = now.getMonth() // 0-based
    if (mParam && /^\d{4}-\d{2}$/.test(mParam)) {
      const [y, m] = mParam.split('-').map(Number)
      if (m >= 1 && m <= 12) { year = y; month = m - 1 }
    }
    const mStart = new Date(year, month, 1, 0, 0, 0, 0)
    const mEnd = new Date(year, month + 1, 0, 23, 59, 59, 999)
    const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`

    const bookerId = url.searchParams.get('bookerId') || undefined

    // ---- active shops (assigned booker filter optional) ----
    const outlets = await db.outlet.findMany({
      where: { distributorId: profileId, isActive: true, ...(bookerId ? { salesmanId: bookerId } : {}) },
      select: { id: true, name: true, code: true, city: true, channel: true, salesmanId: true, salesman: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })
    const oMap = new Map(outlets.map((o) => [o.id, o]))

    // ---- orders is month ----
    const monthOrders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: mStart, lte: mEnd }, status: { not: 'CANCELLED' }, ...(bookerId ? { salesmanId: bookerId } : {}) },
      select: { outletId: true, total: true },
    })
    const orderedSet = new Set(monthOrders.map((o) => o.outletId))
    const monthValueByOutlet = new Map<string, number>()
    for (const o of monthOrders) monthValueByOutlet.set(o.outletId, r2((monthValueByOutlet.get(o.outletId) ?? 0) + o.total))

    // ---- last order ever (per outlet) + pichle 3 mahine ka average ----
    const histStart = new Date(year, month - 3, 1, 0, 0, 0, 0) // 3 pooray mahine (is month se pehle)
    const histOrders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: histStart }, status: { not: 'CANCELLED' } },
      select: { outletId: true, orderDate: true, total: true },
      orderBy: { orderDate: 'desc' },
    })
    const lastOrder = new Map<string, { date: Date; total: number }>()
    const prior3 = new Map<string, number>()
    for (const o of histOrders) {
      if (!lastOrder.has(o.outletId)) lastOrder.set(o.outletId, { date: o.orderDate, total: o.total })
      if (o.orderDate >= histStart && o.orderDate < mStart) prior3.set(o.outletId, r2((prior3.get(o.outletId) ?? 0) + o.total))
    }

    const nowTs = new Date()
    const daysSince = (d: Date | undefined): number | null =>
      d ? Math.max(0, Math.floor((nowTs.getTime() - d.getTime()) / 86400000)) : null

    const zeroRows = outlets
      .filter((o) => !orderedSet.has(o.id))
      .map((o) => {
        const lo = lastOrder.get(o.id)
        const p3 = prior3.get(o.id) ?? 0
        return {
          outletId: o.id,
          shop: o.name,
          code: o.code,
          city: o.city,
          channel: o.channel,
          booker: o.salesman?.name ?? 'Unassigned',
          lastOrderDate: lo?.date.toISOString() ?? null,
          lastOrderValue: lo?.total ?? 0,
          daysSinceLastOrder: daysSince(lo?.date),
          avg3m: r2(p3 / 3),
          everOrdered: !!lo,
        }
      })
      .sort((x, y) => (y.lastOrderDate ? new Date(y.lastOrderDate).getTime() : 0) - (x.lastOrderDate ? new Date(x.lastOrderDate).getTime() : 0))

    // booker-wise summary (sab active shops par — assigned booker ke hisab se)
    const bookerSummaryMap = new Map<string, { total: number; active: number; zero: number }>()
    for (const o of outlets) {
      const key = o.salesman?.name ?? 'Unassigned'
      const s = bookerSummaryMap.get(key) ?? { total: 0, active: 0, zero: 0 }
      s.total += 1
      if (orderedSet.has(o.id)) s.active += 1
      else s.zero += 1
      bookerSummaryMap.set(key, s)
    }
    const bookerSummary = [...bookerSummaryMap.entries()]
      .map(([booker, s]) => ({ booker, ...s, coveragePct: s.total > 0 ? r2((s.active / s.total) * 100) : 0 }))
      .sort((x, y) => y.zero - x.zero)

    return Response.json({
      month: monthKey,
      monthLabel: mStart.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' }),
      range: { from: mStart.toISOString(), to: mEnd.toISOString() },
      filters: { bookerId: bookerId ?? null },
      summary: {
        totalShops: outlets.length,
        activeShops: outlets.filter((o) => orderedSet.has(o.id)).length,
        zeroShops: zeroRows.length,
        zeroPct: outlets.length > 0 ? r2((zeroRows.length / outlets.length) * 100) : 0,
        monthSalesValue: r2(monthOrders.reduce((t, o) => t + o.total, 0)),
        newShops: zeroRows.filter((z) => !z.everOrdered).length,
      },
      zeroRows,
      bookerSummary,
      meta: { bookers: await bookerList(profileId) },
    })
  } catch (e) {
    console.error('reports/zero-purchase', e)
    return jsonError('Zero purchase report fail — server error', 500)
  }
}
