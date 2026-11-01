import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { cityWhere, r2, fifoUncoveredDebits, agingBucket } from '@/lib/reports-kit-server'

// ============================================================
// Task 131 — RECEIVABLES AGING REPORT (30 / 60 / 90+)
// Kis shop ka udhaar kitna PURANA hai — FIFO walk:
//   ledger entries date-asc → credits sab se purane debits par lagte hain →
//   jo debits end tak uncovered reh gaye wo aging bucket mein jate hain
//   (aaj ki date se umar): 0-30 / 31-60 / 61-90 / 90+ din.
// Per-shop bucket amounts + oldest unpaid invoice date, aur overall
// bucket summary (amount + shops count) — bank/lender style report.
// Filters: booker, city. (As-of aaj — date range filter nahi.)
// ============================================================

const BUCKETS = ['0-30', '31-60', '61-90', '90+'] as const

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
    const bookerId = url.searchParams.get('bookerId') || undefined
    const city = url.searchParams.get('city') || undefined

    const outlets = await db.outlet.findMany({
      where: { distributorId: profileId, ...(bookerId ? { salesmanId: bookerId } : {}), ...cityWhere(city) },
      select: { id: true, name: true, code: true, city: true, channel: true, creditDays: true, salesman: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })

    const ledger = await db.outletLedger.findMany({
      where: { outletId: { in: outlets.map((o) => o.id) } },
      select: { outletId: true, type: true, amount: true, date: true },
    })

    // per-outlet FIFO walk — shared helper (Task 131)
    const fifo = new Map<string, ReturnType<typeof fifoUncoveredDebits>>()
    const byOutlet = new Map<string, { type: string; amount: number; date: Date }[]>()
    for (const e of ledger) {
      const arr = byOutlet.get(e.outletId) ?? []
      arr.push({ type: e.type, amount: e.amount, date: e.date })
      byOutlet.set(e.outletId, arr)
    }
    for (const [oid, entries] of byOutlet) fifo.set(oid, fifoUncoveredDebits(entries))

    const now = Date.now()
    type Row = {
      outletId: string; shop: string; code: string; city: string; channel: string; booker: string; creditDays: number
      balance: number; b0_30: number; b31_60: number; b61_90: number; b90plus: number
      oldestUnpaidDate: string | null; oldestDays: number | null; overdue: boolean
    }
    const rows: Row[] = []
    for (const o of outlets) {
      const s = fifo.get(o.id)
      const balance = s?.balance ?? 0
      if (Math.abs(balance) <= 0.01 || !s || s.uncovered.length === 0) continue
      const buckets: Record<(typeof BUCKETS)[number], number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
      let oldest: Date | null = null
      for (const d of s.uncovered) {
        const days = Math.max(0, Math.floor((now - d.date.getTime()) / 86400000))
        buckets[agingBucket(days)] = r2(buckets[agingBucket(days)] + d.amount)
        if (!oldest || d.date < oldest) oldest = d.date
      }
      const oldestDays = oldest ? Math.floor((now - oldest.getTime()) / 86400000) : null
      rows.push({
        outletId: o.id, shop: o.name, code: o.code, city: o.city, channel: o.channel,
        booker: o.salesman?.name ?? 'Unassigned', creditDays: o.creditDays,
        balance, b0_30: buckets['0-30'], b31_60: buckets['31-60'], b61_90: buckets['61-90'], b90plus: buckets['90+'],
        oldestUnpaidDate: oldest?.toISOString() ?? null, oldestDays,
        overdue: o.creditDays > 0 && oldestDays != null ? oldestDays > o.creditDays : false,
      })
    }
    rows.sort((a, b) => b.balance - a.balance)

    const bucketSummary = BUCKETS.map((b) => {
      const key = b === '0-30' ? 'b0_30' : b === '31-60' ? 'b31_60' : b === '61-90' ? 'b61_90' : 'b90plus'
      const hit = rows.filter((r) => (r[key as keyof Row] as number) > 0.005)
      return { bucket: b, amount: r2(hit.reduce((t, r) => t + (r[key as keyof Row] as number), 0)), shops: hit.length }
    })

    return Response.json({
      filters: { bookerId: bookerId ?? null, city: city ?? null },
      summary: {
        shops: rows.length,
        totalOutstanding: r2(rows.reduce((t, r) => t + r.balance, 0)),
        overdueShops: rows.filter((r) => r.overdue).length,
        risk90Plus: r2(rows.reduce((t, r) => t + r.b90plus, 0)),
        risk90PlusShops: rows.filter((r) => r.b90plus > 0.005).length,
      },
      buckets: bucketSummary,
      rows,
    })
  } catch (e) {
    console.error('reports/aging', e)
    return jsonError('Aging report fail — server error', 500)
  }
}
