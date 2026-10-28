import { db } from '@/lib/db'
import { r2 } from '@/lib/reports-kit-server'
import type { Prisma, PrismaClient } from '@prisma/client'
import { planAdvanceConsumption, advanceNote, type AdvanceSource } from './dms-return-core'

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

/** Db ya transaction client — dono chalte hain (read-only helpers ke liye) */
type AnyClient = Prisma.TransactionClient | PrismaClient

/**
 * postLedgerEntry jaisa HI base — legacy backfill logic included. Task 101: return
 * posting se PEHLE outstanding parhne ke liye (splitReturnCredit ka input).
 */
export async function ledgerBase(tx: Prisma.TransactionClient, outletId: string): Promise<number> {
  const outlet = await tx.outlet.findUnique({
    where: { id: outletId },
    select: { balance: true, balanceCheckedAt: true },
  })
  let base = r2(outlet?.balance ?? 0)
  if (!outlet?.balanceCheckedAt) {
    // legacy backfill — ledger hi source of truth (one-time per outlet)
    const sums = await tx.outletLedger.groupBy({
      by: ['type'],
      where: { outletId },
      _sum: { amount: true },
    })
    const deb = sums.find((s) => s.type === 'DEBIT')?._sum.amount ?? 0
    const cre = sums.find((s) => s.type === 'CREDIT')?._sum.amount ?? 0
    base = r2(deb - cre)
  }
  return base
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
  const base = await ledgerBase(tx, args.outletId)
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

// ============================================================
// Task 101 — RETURN ADVANCE (no-minus guard ka shop floor)
// Return ki credit agar shop ke outstanding se bari ho (bill pehle hi cash-paid
// tha) to bachi raqam ledger ko MINUS karti nahi — Outlet.advanceBalance (positive)
// mein jati hai. Agli settlement par FIFO auto-adjust (neeche consumeOutletAdvance).
// Invariant: advanceBalance = Σ(approved returns: advancePosted − advanceConsumed)
// ============================================================

/**
 * Shop ke un-consumed advance sources — FIFO (purana return pehle).
 * bill-options dropdown + settlement form ki "chhoti detail" isi se aati hai.
 */
export async function advanceSources(client: AnyClient, outletId: string): Promise<AdvanceSource[]> {
  const rows = await client.saleReturn.findMany({
    where: { outletId, status: 'APPROVED', advancePosted: { gt: 0 } },
    select: {
      id: true, returnNo: true, advancePosted: true, advanceConsumed: true,
      order: { select: { orderNo: true } },
    },
    orderBy: { createdAt: 'asc' },
  })
  return rows
    .map((rw) => ({
      returnId: rw.id,
      returnNo: rw.returnNo,
      orderNo: rw.order?.orderNo ?? null,
      available: r2(Math.max(0, rw.advancePosted - rw.advanceConsumed)),
    }))
    .filter((rw) => rw.available > 0.005)
}

/**
 * Advance auto-adjust — settlement ke waqt shop ke advance se utna kaato jitna
 * naye bill par payable hai (FIFO, return-wise detail note ke sath).
 * Effects (caller ke transaction mein):
 *  1. SaleReturn.advanceConsumed increment (provenance — kis return ka kitna kharch)
 *  2. Outlet.advanceBalance decrement
 *  3. Ledger CREDIT 'ADVANCE' row (note = RET-xxx (ORD-yyy) Rs z detail)
 * @returns used — kitna advance laga; note — sheet/form par dikhane wali detail
 */
export async function consumeOutletAdvance(
  tx: Prisma.TransactionClient,
  outletId: string,
  upto: number,
  refNo: string,
): Promise<{ used: number; note: string | null }> {
  const sources = await advanceSources(tx, outletId)
  if (sources.length === 0) return { used: 0, note: null }
  const plan = planAdvanceConsumption(sources, upto)
  if (plan.used <= 0.005) return { used: 0, note: null }
  for (const a of plan.allocations) {
    await tx.saleReturn.update({
      where: { id: a.returnId },
      data: { advanceConsumed: { increment: a.amount } },
    })
  }
  const outlet = await tx.outlet.findUnique({ where: { id: outletId }, select: { advanceBalance: true } })
  const newAdvance = Math.max(0, r2((outlet?.advanceBalance ?? 0) - plan.used))
  await tx.outlet.update({ where: { id: outletId }, data: { advanceBalance: newAdvance } })
  const note = advanceNote(plan.allocations)
  await postLedgerEntry(tx, {
    outletId,
    type: 'CREDIT',
    amount: plan.used,
    refType: 'ADVANCE',
    refNo,
    note,
  })
  return { used: plan.used, note }
}

// ============================================================
// Task 102 — ADVANCE PROJECTION (bill bante hi "auto detect")
// User test feedback: Task 101 advance sirf SETTLEMENT par consume karta tha —
// naya bill bante waqt print par kuch nahi dikhta tha. Ab booking par hi
// projection freeze hoti hai (Order.advanceApplied + note) — invoice print
// par "Advance Adjust" row + chhoti detail + Grand Net Total foran nazar aata hai.
//
// Ledger SAFETY: projection sirf LIKHI jati hai, advanceBalance NAHI katata.
// Actual consumption wahi settlement-par consumeOutletAdvance (FIFO) karta hai —
// no-minus invariant (balance kabhi negative nahi) bilkul waisa hi rehta hai.
// Double-claim band: available = advanceBalance − dusri UNSETTLED bills ki
// projections (CONFIRMED/PROCESSING) — do bills advance par claim nahi kar sakte.
// ============================================================

/**
 * Is bill par lagne wala return advance (projection, ledger-safe):
 *   available = advanceBalance − Σ(dusri unsettled bills ki advanceApplied)
 *   applied   = min(available, payable)   — FIFO purana return pehle
 * @param excludeOrderId edit/recompute par KHUD ko exclude karne ke liye
 * @returns applied (Rs) + note — "RET-12 (ORD-45) Rs 2,000.00 • ..." (chhoti detail)
 */
export async function computeAdvanceProjection(
  outletId: string,
  payable: number,
  excludeOrderId?: string,
): Promise<{ applied: number; note: string | null }> {
  const outlet = await db.outlet.findUnique({ where: { id: outletId }, select: { advanceBalance: true } })
  const advanceBalance = Math.max(0, r2(outlet?.advanceBalance ?? 0))
  if (advanceBalance <= 0.005) return { applied: 0, note: null }
  const claimed = await db.order.aggregate({
    where: {
      outletId,
      advanceApplied: { gt: 0.005 },
      status: { in: ['CONFIRMED', 'PROCESSING'] }, // DELIVERED/CANCELLED ka claim khatam
      ...(excludeOrderId ? { id: { not: excludeOrderId } } : {}),
    },
    _sum: { advanceApplied: true },
  })
  const available = Math.max(0, r2(advanceBalance - r2(claimed._sum.advanceApplied ?? 0)))
  if (available <= 0.005) return { applied: 0, note: null }
  const sources = await advanceSources(db, outletId)
  if (sources.length === 0) return { applied: 0, note: null }
  const plan = planAdvanceConsumption(sources, Math.min(available, Math.max(0, r2(payable))))
  if (plan.used <= 0.005) return { applied: 0, note: null }
  // Chhoti detail — bill/invoice par wahi dikhegi jo settlement ledger mein likhi jayegi
  const note = plan.allocations
    .map((a) => `${a.returnNo}${a.orderNo ? ` (${a.orderNo})` : ''} Rs ${a.amount.toFixed(2)}`)
    .join(' • ')
  return { applied: plan.used, note }
}
