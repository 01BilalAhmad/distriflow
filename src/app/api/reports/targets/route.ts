import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — TARGET vs ACHIEVEMENT REPORT
// SalesTarget (booker + optional brand, month "YYYY-MM") vs actual
// us month ki sales. Achievement base = orders ka goods net (total),
// brand-targets par us brand ki lines ka lineTotal.
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

    const now = new Date()
    let monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const mParam = url.searchParams.get('month')
    if (mParam && /^\d{4}-\d{2}$/.test(mParam)) monthKey = mParam
    const [yy, mm] = monthKey.split('-').map(Number)
    const mStart = new Date(yy, mm - 1, 1, 0, 0, 0, 0)
    const mEnd = new Date(yy, mm, 0, 23, 59, 59, 999)
    const monthLabel = mStart.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })

    // ---- targets is month ----
    const targets = await db.salesTarget.findMany({
      where: { month: monthKey, salesman: { parentId: (await db.distributorProfile.findUnique({ where: { id: profileId } }))!.userId } },
      select: { id: true, salesmanId: true, brandId: true, targetValue: true, salesman: { select: { name: true } } },
    })
    const brandIdsT = [...new Set(targets.map((t) => t.brandId).filter(Boolean))] as string[]
    const brandNames = new Map(
      brandIdsT.length ? (await db.brand.findMany({ where: { id: { in: brandIdsT } }, select: { id: true, name: true } })).map((b) => [b.id, b.name]) : [],
    )

    // ---- actual sales is month (booker-wise) ----
    const orders = await db.order.findMany({
      where: { distributorId: profileId, orderDate: { gte: mStart, lte: mEnd }, status: { not: 'CANCELLED' } },
      select: { id: true, salesmanId: true, total: true, items: { select: { lineTotal: true, product: { select: { brandId: true } } } } },
    })
    const overall = new Map<string, number>()
    const byBrand = new Map<string, Map<string, number>>() // salesmanId -> brandId -> value
    for (const o of orders) {
      if (!o.salesmanId) continue
      overall.set(o.salesmanId, r2((overall.get(o.salesmanId) ?? 0) + o.total))
      let bm = byBrand.get(o.salesmanId)
      if (!bm) { bm = new Map(); byBrand.set(o.salesmanId, bm) }
      for (const it of o.items) bm.set(it.product.brandId, r2((bm.get(it.product.brandId) ?? 0) + it.lineTotal))
    }

    const bookerRows = new Map<string, { bookerId: string; bookerName: string; target: number; achieved: number; orders: number }>()
    for (const t of targets) {
      const row = bookerRows.get(t.salesmanId) ?? { bookerId: t.salesmanId, bookerName: t.salesman.name, target: 0, achieved: overall.get(t.salesmanId) ?? 0, orders: 0 }
      row.target = r2(row.target + t.targetValue)
      bookerRows.set(t.salesmanId, row)
    }
    for (const o of orders) {
      if (!o.salesmanId) continue
      const row = bookerRows.get(o.salesmanId)
      if (row) row.orders += 1
      else bookerRows.set(o.salesmanId, { bookerId: o.salesmanId, bookerName: '—', target: 0, achieved: overall.get(o.salesmanId) ?? 0, orders: 0 })
    }
    // orders count dobara (upar sirf target walon ke liye init hua tha)
    const bookers = [...bookerRows.values()].map((b) => {
      const ordersCount = orders.filter((o) => o.salesmanId === b.bookerId).length
      return { ...b, orders: ordersCount, achievementPct: b.target > 0 ? r2((b.achieved / b.target) * 100) : (b.achieved > 0 ? 100 : 0), gap: r2(b.target - b.achieved) }
    }).sort((x, y) => y.achieved - x.achieved)

    // brand-wise (targets with brandId)
    const brandRows = targets.filter((t) => t.brandId).map((t) => {
      const achieved = byBrand.get(t.salesmanId)?.get(t.brandId!) ?? 0
      return {
        booker: t.salesman.name,
        brand: brandNames.get(t.brandId!) ?? '—',
        target: r2(t.targetValue),
        achieved,
        achievementPct: t.targetValue > 0 ? r2((achieved / t.targetValue) * 100) : 0,
        gap: r2(t.targetValue - achieved),
      }
    }).sort((x, y) => y.achieved - x.achieved)

    const totTarget = r2(targets.filter((t) => !t.brandId).reduce((s, t) => s + t.targetValue, 0))
    const totAchieved = r2(orders.reduce((s, o) => s + o.total, 0))

    return Response.json({
      month: monthKey,
      monthLabel,
      summary: {
        totalTarget: totTarget,
        totalAchieved: totAchieved,
        achievementPct: totTarget > 0 ? r2((totAchieved / totTarget) * 100) : 0,
        bookersWithTarget: bookers.filter((b) => b.target > 0).length,
        onTrack: bookers.filter((b) => b.target > 0 && b.achievementPct >= 100).length,
      },
      bookers,
      brandRows,
    })
  } catch (e) {
    console.error('reports/targets', e)
    return jsonError('Targets report fail — server error', 500)
  }
}
