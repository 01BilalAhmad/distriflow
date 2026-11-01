import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, cityWhere, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 131 — DAY BOOK REPORT (Roz Ka Hisaab)
// Date-wise poora business ek nazar mein:
//   • Bills        — kitni orders bani + unki value (orderDate, CANCELLED nahi)
//   • Udhaar Post  — us din settle hua udhaar (OutletLedger DEBIT / INVOICE)
//   • Cash In (RCP)— us din ki sari cash receipts (Collection — settle cash +
//                    recovery wasooli + counter cash sab isme aate hain)
//   • Wasooli RCV  — us din ki APPROVED recovery vouchers (cash ka hissa —
//                    alag column isliye ke booker route ki wasooli alag dikhe)
//   • Returns      — us din ki APPROVED wapasi value
// Filters: date range, booker, city. Totals + booker-wise period summary.
// ============================================================

const dayKey = (d: Date): string => {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`
}

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

    // outlet-level filters (city) — har query ke outlet relation par
    const outletFilter = { distributorId: profileId, ...cityWhere(city) }

    const [orders, collections, recoveries, returns, invoiceDebits] = await Promise.all([
      db.order.findMany({
        where: { outlet: outletFilter, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' }, ...(bookerId ? { salesmanId: bookerId } : {}) },
        select: { orderDate: true, total: true },
      }),
      db.collection.findMany({
        where: { outlet: outletFilter, date: { gte: from, lte: to }, ...(bookerId ? { collectedById: bookerId } : {}) },
        select: { date: true, amount: true },
      }),
      db.recovery.findMany({
        where: { outlet: outletFilter, recoveredAt: { gte: from, lte: to }, status: 'APPROVED', ...(bookerId ? { bookerId } : {}) },
        select: { recoveredAt: true, amount: true, booker: { select: { name: true } } },
      }),
      db.saleReturn.findMany({
        where: { outlet: outletFilter, createdAt: { gte: from, lte: to }, status: 'APPROVED' },
        select: { createdAt: true, totalValue: true },
      }),
      db.outletLedger.findMany({
        where: { outlet: outletFilter, date: { gte: from, lte: to }, type: 'DEBIT', refType: 'INVOICE' },
        select: { date: true, amount: true },
      }),
    ])

    type DayRow = { date: string; bills: number; salesValue: number; udhaarPosted: number; cashCollected: number; wasooli: number; returnsValue: number }
    const days = new Map<string, DayRow>()
    const row = (d: Date): DayRow => {
      const k = dayKey(d)
      const r = days.get(k) ?? { date: k, bills: 0, salesValue: 0, udhaarPosted: 0, cashCollected: 0, wasooli: 0, returnsValue: 0 }
      days.set(k, r)
      return r
    }

    for (const o of orders) { const r = row(o.orderDate); r.bills += 1; r.salesValue = r2(r.salesValue + o.total) }
    for (const c of collections) { const r = row(c.date); r.cashCollected = r2(r.cashCollected + c.amount) }
    for (const rv of recoveries) { const r = row(rv.recoveredAt); r.wasooli = r2(r.wasooli + rv.amount) }
    for (const rt of returns) { const r = row(rt.createdAt); r.returnsValue = r2(r.returnsValue + rt.totalValue) }
    for (const d of invoiceDebits) { const r = row(d.date); r.udhaarPosted = r2(r.udhaarPosted + d.amount) }

    const dayRows = [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1))

    // booker-wise period summary (bills + cash + wasooli)
    const [ordersB, collectionsB] = await Promise.all([
      db.order.findMany({
        where: { outlet: outletFilter, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } },
        select: { total: true, salesman: { select: { name: true } } },
      }),
      db.collection.findMany({
        where: { outlet: outletFilter, date: { gte: from, lte: to } },
        select: { amount: true, collectedBy: { select: { name: true } } },
      }),
    ])
    const bk = new Map<string, { bills: number; salesValue: number; cashCollected: number; wasooli: number }>()
    for (const o of ordersB) {
      const n = o.salesman?.name ?? 'Counter/Web'
      const b = bk.get(n) ?? { bills: 0, salesValue: 0, cashCollected: 0, wasooli: 0 }
      b.bills += 1
      b.salesValue = r2(b.salesValue + o.total)
      bk.set(n, b)
    }
    for (const c of collectionsB) {
      const n = c.collectedBy?.name ?? 'Counter'
      const b = bk.get(n) ?? { bills: 0, salesValue: 0, cashCollected: 0, wasooli: 0 }
      b.cashCollected = r2(b.cashCollected + c.amount)
      bk.set(n, b)
    }
    for (const rv of recoveries) {
      const n = rv.booker?.name ?? 'Unassigned'
      const b = bk.get(n) ?? { bills: 0, salesValue: 0, cashCollected: 0, wasooli: 0 }
      b.wasooli = r2(b.wasooli + rv.amount)
      bk.set(n, b)
    }
    const bookerRows = [...bk.entries()]
      .map(([booker, b]) => ({ booker, ...b }))
      .filter((b) => b.bills > 0 || b.cashCollected > 0 || b.wasooli > 0)
      .sort((a, b) => b.salesValue - a.salesValue)

    const tot = (f: (r: DayRow) => number) => r2(dayRows.reduce((t, r) => t + f(r), 0))
    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, city: city ?? null },
      summary: {
        days: dayRows.length,
        bills: tot((r) => r.bills),
        salesValue: tot((r) => r.salesValue),
        udhaarPosted: tot((r) => r.udhaarPosted),
        cashCollected: tot((r) => r.cashCollected),
        wasooli: tot((r) => r.wasooli),
        returnsValue: tot((r) => r.returnsValue),
      },
      days: dayRows,
      bookers: bookerRows,
    })
  } catch (e) {
    console.error('reports/day-book', e)
    return jsonError('Day Book report fail — server error', 500)
  }
}
