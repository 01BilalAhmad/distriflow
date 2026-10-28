import { db } from '@/lib/db'
import { r2 } from '@/lib/reports-kit-server'
import type { Prisma } from '@prisma/client'

// ============================================================
// Task 98 — CREDIT MANAGEMENT (Finexa mechanism, bill-driven)
// Finexa-AFE repo ka credit khata pattern DistriFlow par — FARQ yehi
// hai k credit manually post NAHI hota, BILL se hota hai:
//   • Har DeliverySummary settlement par DEBIT INVOICE (bill ki amount)
//     + CREDIT cash/return — outlet ka udhaar khata foran banta hai
//   • Har entry par balanceAfter snapshot (Finexa: previousBalance/newBalance)
//   • Outlet.balance running snapshot — O(1) padhna, transactional update
//   • Legacy outlets pehli posting/report par ledger se backfill (balanceCheckedAt)
//   • creditLimit 0 = no limit; cross hone par WARNING (Finexa convention — block nahi)
// ============================================================

export type LedgerType = 'DEBIT' | 'CREDIT'

/** Ledger delta: DEBIT udhaar barhata hai (+), CREDIT kam karta hai (−) */
export function ledgerDelta(type: string, amount: number): number {
  return type === 'DEBIT' ? r2(amount) : r2(-amount)
}

/** Credit limit status — Finexa convention: 0 = no limit, NEAR = 80%+ */
export function creditStatus(
  balance: number,
  creditLimit: number,
): { status: 'OK' | 'NEAR' | 'OVER' | 'NONE'; pct: number; overBy: number } {
  if (!creditLimit || creditLimit <= 0) return { status: 'NONE', pct: 0, overBy: 0 }
  const pct = Math.round((balance / creditLimit) * 1000) / 10
  if (balance > creditLimit) return { status: 'OVER', pct, overBy: r2(balance - creditLimit) }
  if (pct >= 80) return { status: 'NEAR', pct, overBy: 0 }
  return { status: 'OK', pct, overBy: 0 }
}

export interface AgingEntry {
  date: string | Date
  type: string // DEBIT | CREDIT
  amount: number
  refType?: string
}

export interface OldestUnpaid {
  date: string | null
  days: number | null
  /** kitna purana unpaid bacha hai us invoice ka (FIFO allocation ke baad) */
  remaining: number
}

/**
 * FIFO aging — credits sab se PURANE debits ko pehle cover karte hain (real
 * khate ki tarah). Jo debit end tak uncovered reh jaye = oldest unpaid invoice.
 * Return days = aaj − unpaid invoice date (overdue age), ya null (sab clear / koi debit nahi).
 */
export function oldestUnpaid(
  entries: AgingEntry[],
  now: Date = new Date(),
): OldestUnpaid {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
  )
  // debit queue: [date, remaining] — credits head se khate hain.
  // pool = leftover credit (advance) — running khate ki tarah agli DEBIT se
  // adjust hota hai (warna aging overstated ho jati hai).
  const queue: { date: Date; remaining: number }[] = []
  let pool = 0
  for (const e of sorted) {
    const amt = r2(Number(e.amount) || 0)
    if (amt <= 0) continue
    if (e.type === 'DEBIT') {
      let rem = amt
      if (pool > 0) {
        const take = Math.min(pool, rem)
        pool = r2(pool - take)
        rem = r2(rem - take)
      }
      if (rem > 0) queue.push({ date: new Date(e.date), remaining: rem })
    } else {
      let credit = amt
      while (credit > 0 && queue.length > 0) {
        const head = queue[0]
        const take = Math.min(head.remaining, credit)
        head.remaining = r2(head.remaining - take)
        credit = r2(credit - take)
        if (head.remaining <= 0) queue.shift()
      }
      if (credit > 0) pool = r2(pool + credit)
    }
  }
  if (queue.length === 0) return { date: null, days: null, remaining: 0 }
  const first = queue[0]
  const days = Math.max(
    0,
    Math.floor((now.getTime() - first.date.getTime()) / 86400000),
  )
  return { date: first.date.toISOString(), days, remaining: first.remaining }
}

/** Aging bucket label (Finexa-style report buckets) */
export function agingBucket(days: number | null): string {
  if (days == null) return 'CLEAR'
  if (days <= 7) return '0-7'
  if (days <= 15) return '8-15'
  if (days <= 30) return '16-30'
  return '30+'
}

interface PostLedgerArgs {
  outletId: string
  type: LedgerType
  amount: number
  refType: string
  refNo: string
  note?: string | null
  date?: Date
}

/**
 * Ek hi jagah se ledger posting (Finexa mechanism):
 *  1. Legacy outlet (balanceCheckedAt null) → pehle poora ledger aggregate kar k
 *     Outlet.balance backfill (one-time, isi transaction mein)
 *  2. balanceAfter snapshot ke saath ledger row banao
 *  3. Outlet.balance transactionally update karo
 * Prisma transaction client (`tx`) lazmi — posting apne caller ke transaction
 * ke andar hoti hai (crash par koi orphan entry nahi).
 */
export async function postLedgerEntry(
  tx: Prisma.TransactionClient,
  args: PostLedgerArgs,
): Promise<{ balanceAfter: number }> {
  const amount = r2(Math.max(0, args.amount))
  const outlet = await tx.outlet.findUnique({
    where: { id: args.outletId },
    select: { balance: true, balanceCheckedAt: true },
  })
  let base = r2(outlet?.balance ?? 0)
  if (!outlet?.balanceCheckedAt) {
    // legacy backfill — ledger hi source of truth (one-time per outlet)
    const sums = await tx.outletLedger.groupBy({
      by: ['type'],
      where: { outletId: args.outletId },
      _sum: { amount: true },
    })
    const deb = sums.find((s) => s.type === 'DEBIT')?._sum.amount ?? 0
    const cre = sums.find((s) => s.type === 'CREDIT')?._sum.amount ?? 0
    base = r2(deb - cre)
  }
  const balanceAfter = r2(base + ledgerDelta(args.type, amount))
  await tx.outletLedger.create({
    data: {
      outletId: args.outletId,
      type: args.type,
      amount,
      balanceAfter,
      refType: args.refType,
      refNo: args.refNo,
      note: args.note ?? null,
      ...(args.date ? { date: args.date } : {}),
    },
  })
  await tx.outlet.update({
    where: { id: args.outletId },
    data: { balance: balanceAfter, balanceCheckedAt: new Date() },
  })
  return { balanceAfter }
}

/**
 * Single outlet ka balance ensure — legacy outlet (balanceCheckedAt null) par
 * pehli booking/credit-check se pehle ledger se sync. Fresh outlet par O(1) return.
 * Booking-time credit warning isse use karti hai (wahan posting nahi hoti, sirf warning).
 */
export async function ensureOutletBalance(outletId: string): Promise<number> {
  const o = await db.outlet.findUnique({
    where: { id: outletId },
    select: { balance: true, balanceCheckedAt: true },
  })
  if (!o) return 0
  if (o.balanceCheckedAt) return r2(o.balance)
  const sums = await db.outletLedger.groupBy({
    by: ['type'],
    where: { outletId },
    _sum: { amount: true },
  })
  const deb = sums.find((s) => s.type === 'DEBIT')?._sum.amount ?? 0
  const cre = sums.find((s) => s.type === 'CREDIT')?._sum.amount ?? 0
  const bal = r2(deb - cre)
  await db.outlet.update({
    where: { id: outletId },
    data: { balance: bal, balanceCheckedAt: new Date() },
  })
  return bal
}

/**
 * Bulk backfill — credit report par saare legacy outlets ek saath (1 groupBy,
 * per-outlet 1 update). Report fast rehta hai aur balance column sab jagah consistent.
 */
export async function backfillBalances(distributorId: string): Promise<void> {
  const stale = await db.outlet.findMany({
    where: { distributorId, balanceCheckedAt: null },
    select: { id: true },
  })
  if (stale.length === 0) return
  const ids = stale.map((o) => o.id)
  const grouped = await db.outletLedger.groupBy({
    by: ['outletId', 'type'],
    where: { outletId: { in: ids } },
    _sum: { amount: true },
  })
  const bal = new Map<string, number>()
  for (const g of grouped) {
    const cur = bal.get(g.outletId) ?? 0
    bal.set(g.outletId, r2(cur + ledgerDelta(g.type, g._sum.amount ?? 0)))
  }
  const now = new Date()
  for (const o of stale) {
    await db.outlet.update({
      where: { id: o.id },
      data: { balance: bal.get(o.id) ?? 0, balanceCheckedAt: now },
    })
  }
}
