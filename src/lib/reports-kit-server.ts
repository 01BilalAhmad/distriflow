import { db } from '@/lib/db'
import { resolveScope, megaBlocked, jsonError } from '@/lib/dms-scope'

// ============================================================
// Task 66 — REPORTS MODULE shared server helpers.
// Har report route in helpers se scoping / date range / COGS
// (weighted average purchase cost) leta hai — logic ek jagah,
// sab reports se consistent.
// ============================================================

export type Guarded = { profileId: string; userId: string }

/**
 * Reports sirf DISTRIBUTOR ke liye hain — SALESMAN ka apna app hai,
 * MEGA_ADMIN ko business data locked hai (megaBlocked). Har report
 * route shuru mein yehi guard lagata hai.
 */
export async function distributorGuard(userId: string | null): Promise<Guarded | Response> {
  if (!userId) return jsonError('userId required')
  try {
    const ctx = await resolveScope(userId)
    const mb = megaBlocked(ctx.role)
    if (mb) return mb
    if (ctx.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!ctx.profileId) return jsonError('Distributor profile not found', 404)
    return { profileId: ctx.profileId, userId: ctx.userId }
  } catch {
    return jsonError('User not found', 404)
  }
}

export type Range = { from: Date; to: Date }

/** from/to ISO params (default = current month) — to ko END-OF-DAY inclusive rakhta hai */
export function parseRange(url: URL): Range {
  const { searchParams } = url
  const now = new Date()
  const defFrom = new Date(now.getFullYear(), now.getMonth(), 1)
  let from = searchParams.get('from') ? new Date(searchParams.get('from') as string) : defFrom
  let to = searchParams.get('to') ? new Date(searchParams.get('to') as string) : now
  if (isNaN(from.getTime())) from = defFrom
  if (isNaN(to.getTime())) to = now
  from = new Date(from)
  from.setHours(0, 0, 0, 0)
  to = new Date(to)
  to.setHours(23, 59, 59, 999)
  return { from, to }
}

/** Weighted-average per-unit (pcs) NET cost per product — purchase invoices se.
 *  NET = netAmount (line gross − pass-on discount) − tradeOfferAmt (company ka
 *  scheme wapas) — yehi asli kharcha hai jo company ko diya. GST recoverable
 *  (input credit) hai is liye cost ka hissa NAHI; advance tax 236H income-tax
 *  adjust hota hai, wo bhi nahi. Report end date tak ki saari invoices (stock jo
 *  becha ja raha hai uski asli keemat).
 *  Koi purchase na ho to caller product.purchasePrice / tradePrice fallback lagata hai. */
export async function unitCostMap(profileId: string, upTo: Date): Promise<Map<string, number>> {
  const rows = await db.purchaseInvoiceItem.findMany({
    where: { invoice: { distributorId: profileId, date: { lte: upTo } } },
    select: { productId: true, units: true, netAmount: true, tradeOfferAmt: true },
  })
  const agg = new Map<string, { units: number; amt: number }>()
  for (const r of rows) {
    if (!r.units || r.units <= 0) continue
    const a = agg.get(r.productId) ?? { units: 0, amt: 0 }
    a.units += r.units
    // per-line clamp 0 — scheme zyada ho to line negative cost poison na kare
    a.amt += Math.max(0, r2(r.netAmount - (r.tradeOfferAmt || 0)))
    agg.set(r.productId, a)
  }
  const map = new Map<string, number>()
  for (const [pid, a] of agg) if (a.units > 0) map.set(pid, Math.round((a.amt / a.units) * 100) / 100)
  return map
}

/** r2 = paisa rounding (2 decimals) — JS float sums ko clean rakhta hai */
export function r2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

/** Distributor ke bookers (SALESMAN users) — filter dropdowns ke liye */
export async function bookerList(profileId: string) {
  const dist = await db.distributorProfile.findUnique({ where: { id: profileId }, select: { userId: true } })
  if (!dist) return []
  return db.user.findMany({
    where: { parentId: dist.userId, role: 'SALESMAN' },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/** Distributor ki companies — filter dropdowns ke liye */
export function companyList(profileId: string) {
  return db.company.findMany({
    where: { distributorId: profileId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
}

/** Task 131 — distributor ki shops ke DISTINCT cities — City filter dropdown ke liye */
export async function cityList(profileId: string): Promise<string[]> {
  const rows = await db.outlet.findMany({
    where: { distributorId: profileId },
    select: { city: true },
    distinct: ['city'],
    orderBy: { city: 'asc' },
  })
  return rows.map((r) => r.city).filter(Boolean)
}

/** Task 131 — City filter ke liye outlet where ka city hissa (spread-ready) */
export function cityWhere(city: string | undefined): { city?: string } {
  return city ? { city } : {}
}

export type LedgerEntryLite = { type: string; amount: number; date: Date }

/**
 * Task 131 — FIFO uncovered debits: ledger entries (kisi bhi order mein) date-asc
 * sort karke credits sab se PURANE debits par FIFO apply karte hain — jo debits
 * end tak uncovered reh gaye wo array milta hai (amount bacha hua + date).
 * Aging reports isi par bucket lagati hain (aaj se umar). balance = ΣDEBIT − ΣCREDIT.
 */
export function fifoUncoveredDebits(
  entries: LedgerEntryLite[],
): { uncovered: Array<{ amount: number; date: Date }>; balance: number } {
  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime())
  const debits: Array<{ amount: number; date: Date }> = []
  let balance = 0
  for (const e of sorted) {
    if (e.type === 'DEBIT') {
      debits.push({ amount: e.amount, date: e.date })
      balance = r2(balance + e.amount)
    } else {
      let credit = e.amount
      while (credit > 0.005 && debits.length > 0) {
        const head = debits[0]
        const used = Math.min(head.amount, credit)
        head.amount = r2(head.amount - used)
        credit = r2(credit - used)
        if (head.amount <= 0.005) debits.shift()
      }
      balance = r2(balance - e.amount)
    }
  }
  return { uncovered: debits.filter((d) => d.amount > 0.005), balance }
}

/** Task 131 — umar (din) se bucket label — 0-30 / 31-60 / 61-90 / 90+ */
export function agingBucket(days: number): '0-30' | '31-60' | '61-90' | '90+' {
  return days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
}

export type SortOpts = Record<string, 'asc' | 'desc' | undefined>
