import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { r2 } from '@/lib/reports-kit-server'
import { backfillBalances, creditStatus, oldestUnpaid, agingBucket } from '@/lib/dms-credit'

// ============================================================
// Task 98 — CREDIT BOOK REPORT (Finexa-style udhaar khata)
//   • Shop-wise running balance (Outlet.balance — postLedgerEntry maintained,
//     legacy shops report-load par ledger se backfill)
//   • Credit limit status: OK / NEAR (80%+) / OVER / NONE (0 = no limit)
//   • FIFO aging: credits sab se purane debit ko pehle khate hain → jo invoice
//     end tak uncovered = oldest unpaid → aging bucket (CLEAR/0-7/8-15/16-30/30+)
//   • Booker-wise credit book summary (route ka total exposure)
// ============================================================

const AGING_ORDER = ['CLEAR', '0-7', '8-15', '16-30', '30+'] as const

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!user.profile) return jsonError('Distributor profile not found', 404)
    const profileId = user.profile.id

    const url = new URL(req.url)
    const bookerId = url.searchParams.get('bookerId') || undefined

    // Legacy outlets pehle sync (one-time per outlet — report hamesha fresh)
    await backfillBalances(profileId)

    // ---- shops + booker ----
    const outlets = await db.outlet.findMany({
      where: { distributorId: profileId, ...(bookerId ? { salesmanId: bookerId } : {}) },
      select: {
        id: true, name: true, code: true, city: true, channel: true,
        creditDays: true, creditLimit: true, balance: true,
        salesman: { select: { name: true } },
      },
      orderBy: { name: 'asc' },
    })
    const scopeIds = outlets.map((o) => o.id)

    // ---- poora ledger (aging ke liye rows chahiye, sirf sums nahi) ----
    const ledger = await db.outletLedger.findMany({
      where: { outletId: { in: scopeIds } },
      select: { outletId: true, type: true, amount: true, date: true },
      orderBy: { date: 'asc' },
    })
    const entriesByOutlet = new Map<string, { date: string | Date; type: string; amount: number }[]>()
    for (const l of ledger) {
      let arr = entriesByOutlet.get(l.outletId)
      if (!arr) entriesByOutlet.set(l.outletId, (arr = []))
      arr.push({ date: l.date, type: l.type, amount: l.amount })
    }

    const now = new Date()
    const shops = outlets.map((o) => {
      const cs = creditStatus(o.balance, o.creditLimit)
      const oldest = oldestUnpaid(entriesByOutlet.get(o.id) ?? [], now)
      const bucket = agingBucket(oldest.days)
      return {
        id: o.id,
        name: o.name,
        code: o.code,
        city: o.city,
        channel: o.channel,
        booker: o.salesman?.name ?? null,
        creditDays: o.creditDays,
        creditLimit: o.creditLimit,
        balance: o.balance,
        creditStatus: cs.status,
        limitPct: cs.pct,
        overBy: cs.overBy,
        oldestUnpaidDate: oldest.date,
        oldestUnpaidDays: oldest.days,
        agingBucket: bucket,
      }
    })

    // ---- aging buckets (shop-wise allocation, unique shop per bucket) ----
    const aging = AGING_ORDER.map((b) => {
      const rows = shops.filter((s) => s.agingBucket === b)
      return { bucket: b, shops: rows.length, amount: r2(rows.reduce((t, s) => t + s.balance, 0)) }
    })

    // ---- booker-wise credit book (running khata ka route-wise toota) ----
    const bookerMap = new Map<string, { booker: string; shops: number; balance: number; overLimit: number; nearLimit: number; over30: number }>()
    for (const s of shops) {
      const key = s.booker ?? '(unassigned)'
      let b = bookerMap.get(key)
      if (!b) bookerMap.set(key, (b = { booker: key, shops: 0, balance: 0, overLimit: 0, nearLimit: 0, over30: 0 }))
      b.shops++
      b.balance = r2(b.balance + s.balance)
      if (s.creditStatus === 'OVER') b.overLimit++
      if (s.creditStatus === 'NEAR') b.nearLimit++
      if (s.agingBucket === '30+') b.over30++
    }

    const withBalance = shops.filter((s) => s.balance > 0.005)
    const summary = {
      totalOutstanding: r2(shops.reduce((t, s) => t + s.balance, 0)),
      shopsWithBalance: withBalance.length,
      overLimitShops: shops.filter((s) => s.creditStatus === 'OVER').length,
      overLimitAmount: r2(shops.reduce((t, s) => t + s.overBy, 0)),
      nearLimitShops: shops.filter((s) => s.creditStatus === 'NEAR').length,
      advanceShops: shops.filter((s) => s.balance < -0.005).length, // negative balance = shop ke paas advance
      over30Amount: aging[AGING_ORDER.indexOf('30+')].amount,
    }

    return Response.json({ summary, shops, aging, bookerSummary: [...bookerMap.values()] })
  } catch (e) {
    console.error(e)
    return jsonError('Credit report load failed', 500)
  }
}
