import { db } from '@/lib/db'
import { jsonError, megaBlocked, type ScopeContext } from '@/lib/dms-scope'
import { r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 67 — ORDER BOOKER TARGETS management API.
// SalesTarget model (salesmanId, brandId?, month "YYYY-MM", targetValue)
// ka add/list karne ka UI pehle nahi tha — Field Force card sirf current
// month ka target DIKHATA tha, set koi nahi kar sakta tha.
//
// GET  /api/targets?userId&month=YYYY-MM
//      → is month ke saare targets + har target par ACHIEVED value
//        (overall = orders ka total, brand = us brand ki lines ka lineTotal;
//        CANCELLED orders exclude — reports/targets report jaisa hi math)
// POST /api/targets { userId, salesmanId, month, targetValue, brandId? }
//      → UPSERT (same booker + month + brand par dobara save = update)
// ============================================================

interface TargetCtx {
  caller: ScopeContext & { profileUserId: string }
}

/** Caller DISTRIBUTOR hona chahiye — targets usi ke bookers ke hain (mega admin locked) */
async function guard(userId: string | null): Promise<TargetCtx | Response> {
  if (!userId) return jsonError('userId required')
  const caller = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!caller) return jsonError('User not found', 404)
  const mb = megaBlocked(caller.role)
  if (mb) return mb
  if (caller.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor apne order bookers ka target set kar sakta hai', 403)
  if (!caller.profile) return jsonError('Distributor profile nahi mila', 404)
  return { caller: { userId: caller.id, role: 'DISTRIBUTOR', profileId: caller.profile.id, profileUserId: caller.profile.userId } }
}

function monthMeta(monthKey: string) {
  const [yy, mm] = monthKey.split('-').map(Number)
  const mStart = new Date(yy, mm - 1, 1, 0, 0, 0, 0)
  const mEnd = new Date(yy, mm, 0, 23, 59, 59, 999)
  const monthLabel = mStart.toLocaleDateString('en-PK', { month: 'long', year: 'numeric' })
  return { mStart, mEnd, monthLabel }
}

/** YYYY-MM + real month range (01-12) — "2026-13" jaisa garbage block */
function validMonth(m: string | undefined | null): m is string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return false
  const mm = Number(m.split('-')[1])
  return mm >= 1 && mm <= 12
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await guard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileUserId } = g.caller

    const now = new Date()
    let monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    const mParam = url.searchParams.get('month')
    if (validMonth(mParam)) monthKey = mParam
    const { mStart, mEnd, monthLabel } = monthMeta(monthKey)

    // apne bookers + apne brands (add form ke dropdowns)
    const [bookers, brands] = await Promise.all([
      db.user.findMany({
        where: { role: 'SALESMAN', parentId: profileUserId },
        select: { id: true, name: true, region: true },
        orderBy: { name: 'asc' },
      }),
      db.brand.findMany({
        where: { distributorId: g.caller.profileId! },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ])
    const bookerIds = bookers.map((b) => b.id)

    // targets is month (sirf apne bookers ke)
    const targets = await db.salesTarget.findMany({
      where: { month: monthKey, salesmanId: { in: bookerIds } },
      select: { id: true, salesmanId: true, brandId: true, targetValue: true },
      orderBy: { targetValue: 'desc' },
    })
    const brandIds = [...new Set(targets.map((t) => t.brandId).filter(Boolean))] as string[]
    const brandName = new Map(
      brands.filter((b) => brandIds.includes(b.id)).map((b) => [b.id, b.name]),
    )
    const bookerName = new Map(bookers.map((b) => [b.id, b.name]))

    // achieved — CANCELLED exclude (reports/targets jaisa hi base)
    const orders = await db.order.findMany({
      where: { salesmanId: { in: bookerIds }, orderDate: { gte: mStart, lte: mEnd }, status: { not: 'CANCELLED' } },
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

    const rows = targets.map((t) => {
      const achieved = t.brandId ? (byBrand.get(t.salesmanId)?.get(t.brandId) ?? 0) : (overall.get(t.salesmanId) ?? 0)
      return {
        id: t.id,
        salesmanId: t.salesmanId,
        salesmanName: bookerName.get(t.salesmanId) ?? '—',
        brandId: t.brandId,
        brandName: t.brandId ? (brandName.get(t.brandId) ?? '—') : null,
        month: monthKey,
        targetValue: r2(t.targetValue),
        achieved,
        achievementPct: t.targetValue > 0 ? Math.min(999, r2((achieved / t.targetValue) * 100)) : 0,
      }
    })

    // bookers jo is month target ke bina hain — add form mein highlight ke liye
    const withTarget = new Set(targets.map((t) => t.salesmanId))
    const totalTarget = r2(rows.reduce((s, t) => s + t.targetValue, 0))
    const overallAchieved = r2(rows.filter((t) => !t.brandId).reduce((s, t) => s + t.achieved, 0))

    return Response.json({
      month: monthKey,
      monthLabel,
      summary: {
        totalTarget,
        totalAchieved: overallAchieved,
        achievementPct: totalTarget > 0 ? r2((overallAchieved / totalTarget) * 100) : 0,
        targetsCount: rows.length,
        bookersWithTarget: withTarget.size,
        bookersTotal: bookers.length,
      },
      targets: rows,
      bookers,
      brands,
    })
  } catch (e) {
    console.error('targets GET', e)
    return jsonError('Targets load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as {
      userId?: string
      salesmanId?: string
      month?: string
      targetValue?: number | string
      brandId?: string | null
    }
    const g = await guard(body.userId ?? null)
    if (g instanceof Response) return g

    const { salesmanId, month } = body
    const value = Number(body.targetValue)
    if (!salesmanId) return jsonError('Order booker select karein')
    if (!validMonth(month)) return jsonError('Month sahi nahi hai — YYYY-MM (month 01 se 12)')
    if (!Number.isFinite(value) || value <= 0) return jsonError('Target value 0 se bara number hona chahiye')

    // booker caller ka apna hona chahiye
    const salesman = await db.user.findUnique({ where: { id: salesmanId } })
    if (!salesman) return jsonError('Order booker nahi mila', 404)
    if (salesman.role !== 'SALESMAN') return jsonError('Ye user order booker nahi hai')
    if (salesman.parentId !== g.caller.profileUserId) return jsonError('Ye order booker aapka nahi hai', 403)

    // brand optional — caller ke apne tenant ka hona chahiye
    let brandId: string | null = null
    if (body.brandId) {
      const brand = await db.brand.findFirst({
        where: { id: body.brandId, distributorId: g.caller.profileId! },
        select: { id: true },
      })
      if (!brand) return jsonError('Brand nahi mila (ya aap ka nahi hai)', 404)
      brandId = brand.id
    }

    // UPSERT — same booker + month + brand par dobara save = update (duplicate rows nahi)
    const existing = await db.salesTarget.findFirst({
      where: { salesmanId, month, brandId },
      select: { id: true },
    })
    const saved = existing
      ? await db.salesTarget.update({ where: { id: existing.id }, data: { targetValue: value } })
      : await db.salesTarget.create({ data: { salesmanId, month, brandId, targetValue: value } })

    return Response.json({ target: { id: saved.id, salesmanId: saved.salesmanId, brandId: saved.brandId, month: saved.month, targetValue: saved.targetValue }, updated: !!existing })
  } catch (e) {
    console.error('targets POST', e)
    return jsonError('Target save failed', 500)
  }
}
