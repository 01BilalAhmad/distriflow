import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, cityWhere, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 131 — VISIT COMPLIANCE REPORT (PJP vs Actual)
// Booker ne plan ke mutabiq kaam kiya ya nahi:
//   • Planned shops (PJP plans ke visits, period)
//   • COMPLETED (visit hui) / MISSED (mark hui) / PENDING (na hua)
//   • GPS check-ins (checkInLat/Lng mojood = phone se real check-in)
//   • Completion % per booker + overall
// Sections: booker-wise summary + visit detail list (latest 500).
// Filters: date range (plan date), booker, city.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!user.profile) return jsonError('Distributor profile not found', 404)
    const profileId = user.profile.id
    const { from, to } = parseRange(url)
    const bookerId = url.searchParams.get('bookerId') || undefined
    const city = url.searchParams.get('city') || undefined

    const dist = await db.distributorProfile.findUnique({ where: { id: profileId }, select: { userId: true } })
    if (!dist) return jsonError('Distributor profile not found', 404)

    const plans = await db.pJPPlan.findMany({
      where: {
        date: { gte: from, lte: to },
        salesman: { parentId: dist.userId, ...(bookerId ? { id: bookerId } : {}) },
      },
      select: {
        id: true, date: true, status: true,
        salesman: { select: { id: true, name: true } },
        visits: {
          where: { outlet: cityWhere(city) },
          select: {
            id: true, status: true, checkInAt: true, checkInLat: true, checkInLng: true, notes: true,
            outlet: { select: { id: true, name: true, city: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    })

    type BRow = { bookerId: string; booker: string; days: number; planned: number; completed: number; missed: number; pending: number; gpsCheckIns: number; pct: number }
    const bk = new Map<string, BRow>()
    type VRow = { date: string; planId: string; booker: string; shop: string; city: string; status: string; checkInAt: string | null; hasGps: boolean; notes: string | null }
    const visitRows: VRow[] = []
    const totals = { days: 0, planned: 0, completed: 0, missed: 0, pending: 0, gpsCheckIns: 0 }

    for (const p of plans) {
      const key = p.salesman.id
      const b = bk.get(key) ?? { bookerId: key, booker: p.salesman.name, days: 0, planned: 0, completed: 0, missed: 0, pending: 0, gpsCheckIns: 0, pct: 0 }
      b.days += 1
      totals.days += 1
      for (const v of p.visits) {
        b.planned += 1
        totals.planned += 1
        const gps = v.checkInLat != null && v.checkInLng != null
        if (v.status === 'COMPLETED') { b.completed += 1; totals.completed += 1 }
        else if (v.status === 'MISSED') { b.missed += 1; totals.missed += 1 }
        else { b.pending += 1; totals.pending += 1 }
        if (v.checkInAt && gps) { b.gpsCheckIns += 1; totals.gpsCheckIns += 1 }
        if (visitRows.length < 500) {
          visitRows.push({
            date: p.date.toISOString(), planId: p.id, booker: p.salesman.name,
            shop: v.outlet.name, city: v.outlet.city, status: v.status,
            checkInAt: v.checkInAt?.toISOString() ?? null, hasGps: gps, notes: v.notes,
          })
        }
      }
      const done = b.completed + b.missed
      b.pct = done > 0 ? r2((b.completed / done) * 100) : 0
      bk.set(key, b)
    }

    const doneAll = totals.completed + totals.missed
    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, city: city ?? null },
      summary: {
        ...totals,
        completionPct: doneAll > 0 ? r2((totals.completed / doneAll) * 100) : 0,
      },
      bookers: [...bk.values()].sort((a, b) => b.pct - a.pct),
      visits: visitRows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    })
  } catch (e) {
    console.error('reports/visits', e)
    return jsonError('Visit compliance report fail — server error', 500)
  }
}
