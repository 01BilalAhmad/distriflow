import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, parseRange, bookerList, companyList, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — RECOVERY REPORT (wasooli)
// DONO sections:
//   1) OUTSTANDING — shop-wise abhi tak ka bakaya udhaar
//      (OutletLedger: ΣDEBIT − ΣCREDIT; positive = shop se lena hai)
//      Filters: booker (assigned shops), company (jis company ka maal
//      liya hua ho — ledger company-neutral hota hai, company filter
//      "us company ki shops" ke tor par hota hai), search.
//   2) COLLECTION HISTORY — period ki wasooli entries
//      (Recovery vouchers APPROVED + Cash collections) shop-wise,
//      booker summary ke sath.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
    const { from, to } = parseRange(url)
    const bookerId = url.searchParams.get('bookerId') || undefined
    const companyId = url.searchParams.get('companyId') || undefined

    // ---- shops + assigned booker ----
    const outlets = await db.outlet.findMany({
      where: { distributorId: profileId, ...(bookerId ? { salesmanId: bookerId } : {}) },
      select: { id: true, name: true, code: true, city: true, channel: true, creditDays: true, salesman: { select: { name: true } } },
      orderBy: { name: 'asc' },
    })

    // company filter: sirf wo shops jinhone is company ka maal liya (kabhi bhi)
    let outletScope = outlets
    if (companyId) {
      const shopsOfCompany = await db.orderItem.findMany({
        where: { order: { distributorId: profileId }, product: { companyId } },
        select: { order: { select: { outletId: true } } },
        distinct: ['orderId'],
      })
      const set = new Set(shopsOfCompany.map((s) => s.order.outletId))
      outletScope = outlets.filter((o) => set.has(o.id))
    }
    const scopeIds = new Set(outletScope.map((o) => o.id))

    // ---- ledger (outstanding) ----
    const ledger = await db.outletLedger.findMany({
      where: { outletId: { in: [...scopeIds] } },
      select: { outletId: true, type: true, amount: true, date: true, refType: true },
    })
    const bal = new Map<string, { balance: number; billed: number; collected: number; lastEntry: Date | null; lastPay: Date | null }>()
    for (const e of ledger) {
      const b = bal.get(e.outletId) ?? { balance: 0, billed: 0, collected: 0, lastEntry: null as Date | null, lastPay: null as Date | null }
      if (e.type === 'DEBIT') {
        b.balance = r2(b.balance + e.amount)
        b.billed = r2(b.billed + e.amount)
      } else {
        b.balance = r2(b.balance - e.amount)
        b.collected = r2(b.collected + e.amount)
        if (!b.lastPay || e.date > b.lastPay) b.lastPay = e.date
      }
      if (!b.lastEntry || e.date > b.lastEntry) b.lastEntry = e.date
      bal.set(e.outletId, b)
    }

    const now = new Date()
    const outstanding = outletScope
      .map((o) => {
        const b = bal.get(o.id)
        const balance = b?.balance ?? 0
        const overDays = b?.lastPay ? Math.floor((now.getTime() - b.lastPay.getTime()) / 86400000) : (b?.lastEntry ? Math.floor((now.getTime() - b.lastEntry.getTime()) / 86400000) : null)
        return {
          outletId: o.id,
          shop: o.name,
          code: o.code,
          city: o.city,
          channel: o.channel,
          booker: o.salesman?.name ?? 'Unassigned',
          creditDays: o.creditDays,
          balance,
          totalBilled: b?.billed ?? 0,
          totalCollected: b?.collected ?? 0,
          lastPaymentDate: b?.lastPay?.toISOString() ?? null,
          daysSinceLastPayment: overDays,
          overdue: o.creditDays > 0 && overDays != null ? overDays > o.creditDays && balance > 0 : false,
        }
      })
      .filter((x) => Math.abs(x.balance) > 0.01) // sirf bakaya wali shops (zero balance skip)
      .sort((x, y) => y.balance - x.balance)

    // ---- collection history (period) ----
    const recoveries = await db.recovery.findMany({
      where: { outlet: { distributorId: profileId }, recoveredAt: { gte: from, lte: to }, status: { not: 'REJECTED' }, ...(bookerId ? { bookerId } : {}) },
      select: { recoveryNo: true, outletId: true, amount: true, method: true, recoveredAt: true, status: true, booker: { select: { name: true } }, outlet: { select: { name: true } } },
      orderBy: { recoveredAt: 'desc' },
    })
    const collections = await db.collection.findMany({
      where: { outlet: { distributorId: profileId }, date: { gte: from, lte: to }, ...(bookerId ? { collectedById: bookerId } : {}) },
      select: { receiptNo: true, outletId: true, amount: true, method: true, date: true, collectedBy: { select: { name: true } }, outlet: { select: { name: true } } },
      orderBy: { date: 'desc' },
    })

    type HistRow = { date: string; kind: 'RECOVERY' | 'CASH'; refNo: string; outletId: string; shop: string; booker: string; amount: number; method: string; status: string }
    const history: HistRow[] = [
      ...recoveries.map((rv) => ({
        date: rv.recoveredAt.toISOString(), kind: 'RECOVERY' as const, refNo: rv.recoveryNo,
        outletId: rv.outletId, shop: rv.outlet.name, booker: rv.booker?.name ?? 'Unassigned',
        amount: r2(rv.amount), method: rv.method, status: rv.status,
      })),
      ...collections.map((c) => ({
        date: c.date.toISOString(), kind: 'CASH' as const, refNo: c.receiptNo,
        outletId: c.outletId, shop: c.outlet.name, booker: c.collectedBy?.name ?? 'Counter',
        amount: r2(c.amount), method: c.method, status: 'APPROVED',
      })),
    ].sort((x, y) => new Date(y.date).getTime() - new Date(x.date).getTime())

    // per-shop history totals (period)
    const histByShop = new Map<string, number>()
    for (const h of history) histByShop.set(h.outletId, r2((histByShop.get(h.outletId) ?? 0) + h.amount))

    // booker-wise history summary
    const bookerHist = new Map<string, { collected: number; entries: number; shops: Set<string> }>()
    for (const h of history) {
      const b = bookerHist.get(h.booker) ?? { collected: 0, entries: 0, shops: new Set<string>() }
      b.collected = r2(b.collected + h.amount)
      b.entries += 1
      b.shops.add(h.outletId)
      bookerHist.set(h.booker, b)
    }
    const bookerSummary = [...bookerHist.entries()]
      .map(([booker, b]) => ({ booker, collected: b.collected, entries: b.entries, shops: b.shops.size }))
      .sort((x, y) => y.collected - x.collected)

    const outTotal = r2(outstanding.reduce((t, x) => t + x.balance, 0))
    const histTotal = r2(history.reduce((t, x) => t + x.amount, 0))

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, companyId: companyId ?? null },
      summary: {
        outstandingShops: outstanding.length,
        outstandingTotal: outTotal,
        overdueShops: outstanding.filter((x) => x.overdue).length,
        overdueTotal: r2(outstanding.filter((x) => x.overdue).reduce((t, x) => t + x.balance, 0)),
        collectedInPeriod: histTotal,
        historyEntries: history.length,
      },
      outstanding,
      history,
      bookerSummary,
      meta: { bookers: await bookerList(profileId), companies: await companyList(profileId) },
    })
  } catch (e) {
    console.error('reports/recovery', e)
    return jsonError('Recovery report fail — server error', 500)
  }
}
