// ============================================================
// Task 101 — BILL-LINKED SALE RETURN core math (pure, shared)
//
// Konsi route isi se guzarti hain:
//   • POST /api/returns          — Return & Claims page ka bill-linked return
//   • PATCH /api/returns/[id]    — PENDING (salesman) return approve par effects
//   • /api/summaries/[id]/late-return — settled bill par late return
//   • /api/returns/[id]/cancel   — undo (exact reverse)
//   • /api/returns/bill-options  — dropdown ka returnable preview
//
// NO-MINUS GUARD (user rule: "return ke baad amount minus mein nahi jani chahiye"):
//   1. ITEM CAP  — return qty <= billed − already returned (zyada return possible hi nahi)
//   2. BILL FLOOR — pro-rata reversals settlement row ki bachti raqam par capped
//                   => bill ka net payable return ke baad 0 se neeche nahi gir sakta
//   3. SHOP FLOOR — ledger credit sirf outstanding (udhaar) tak; agar bill pehle hi
//                   paid hai to bachi raqam shop ke ADVANCE mein jati hai (positive,
//                   Outlet.advanceBalance) — ledger balance KABHI negative nahi hota.
//                   Agli settlement par advance auto-adjust (FIFO, return-wise detail).
// ============================================================

export const r2c = (n: number) => Math.round(n * 100) / 100

/**
 * Task 63 pattern — per-PIECE effective rate: lineTotal/qty (scheme + manual discount
 * ke BAAD ka net rate). Trade price use karne par full return bill se ZYADA credit
 * bantha tha => ledger/net MINUS (woi masla jo Task 101 band karta hai).
 * Legacy guard: lineTotal 0 (purane pre-Task 45 orders) par booked rate fallback.
 */
export function effRateOf(it: { qty: number; rate: number; lineTotal: number }): number {
  return it.qty > 0 && it.lineTotal > 0 ? it.lineTotal / it.qty : it.rate
}

export interface ReturnCoreBillLine {
  productId: string
  qty: number // billed pcs
  rate: number
  lineTotal: number
  productName?: string | null
}
export interface ReturnCoreInput { productId: string; qty: number }
export interface ReturnCoreLine { productId: string; qty: number; rate: number; value: number }

/** Returned qty lookup (productId -> pcs) — APPROVED returns ka sum */
export type ReturnedMap = Map<string, number> | Record<string, number>

function returnedOf(map: ReturnedMap, productId: string): number {
  if (map instanceof Map) return map.get(productId) ?? 0
  return map[productId] ?? 0
}

/**
 * Return lines + CAP enforcement (server-side truth).
 * Item cap: qty <= billed − already returned — warna clear error (UI bhi yehi
 * returnable dikhata hai, ye double-check hai).
 * @throws Error `${name}: sirf X pcs return ho sakte hain (billed Y, pehle se wapas Z)`
 */
export function computeReturnLines(
  billLines: ReturnCoreBillLine[],
  items: ReturnCoreInput[],
  returnedMap: ReturnedMap,
): { lines: ReturnCoreLine[]; returnValue: number } {
  const byProduct = new Map(billLines.map((l) => [l.productId, l]))
  const lines: ReturnCoreLine[] = []
  let returnValue = 0
  for (const ri of items) {
    const qty = Math.max(0, Math.floor(Number(ri.qty) || 0))
    if (qty <= 0) continue
    const bl = byProduct.get(ri.productId)
    if (!bl) throw new Error('Return item invoice ka hissa nahi hai')
    const already = returnedOf(returnedMap, ri.productId)
    if (qty > bl.qty - already) {
      throw new Error(
        `${bl.productName ?? 'Item'}: sirf ${bl.qty - already} pcs return ho sakte hain (billed ${bl.qty}, pehle se wapas ${already})`,
      )
    }
    const rate = effRateOf(bl)
    const value = r2c(qty * rate)
    lines.push({ productId: ri.productId, qty, rate, value })
    returnValue += value
  }
  if (lines.length === 0) throw new Error('Return qty 0 hai')
  return { lines, returnValue: r2c(returnValue) }
}

export interface OrderTaxParts {
  total: number
  advanceTax?: number | null
  gstTotal?: number | null
  tradeOfferTotal?: number | null
}
/** Settlement row ki EFFECTIVE (reversal ke baad) bachti raqamen — null = settlement row nahi */
export interface SettlementRemaining {
  advanceTax: number
  gstTotal: number
  tradeOfferTotal: number
}
export interface ProRataReversals { taxRev: number; gstRev: number; toRev: number }

/**
 * Pro-rata tax/GST/TO reversal — EXACT wohi pattern jo settle + late-return routes
 * use karte hain: reversal = min(orderFull × returnValue / orderTotal, stRemaining).
 * Caps guarantee: bill ke net payable mein kabhi minus nahi (BILL FLOOR).
 * GST wapas milta hai (+), Trade Offer wapas LENA hai (−) — shop TO benefit
 * returned goods ka kho deta hai.
 */
export function proRataReversals(
  order: OrderTaxParts,
  returnValue: number,
  st?: SettlementRemaining | null,
): ProRataReversals {
  const total = order.total > 0 ? order.total : 0
  const taxFull = r2c(Math.max(0, order.advanceTax ?? 0))
  const gstFull = r2c(Math.max(0, order.gstTotal ?? 0))
  const toFull = r2c(Math.max(0, order.tradeOfferTotal ?? 0))
  const cap = (full: number, remaining: number | undefined) =>
    returnValue > 0 && total > 0 && full > 0
      ? Math.min(r2c((full * returnValue) / total), remaining !== undefined ? remaining : full)
      : 0
  return {
    taxRev: cap(taxFull, st?.advanceTax),
    gstRev: cap(gstFull, st?.gstTotal),
    toRev: cap(toFull, st?.tradeOfferTotal),
  }
}

/** Shop ko milne wala total credit: goods + GST reversal + AdvTax reversal − TO reversal */
export function returnCreditOf(returnValue: number, rev: ProRataReversals): number {
  return Math.max(0, r2c(returnValue + rev.gstRev + rev.taxRev - rev.toRev))
}

/** NO-MINUS split (SHOP FLOOR): ledger credit outstanding tak; excess = advance (positive) */
export function splitReturnCredit(
  returnCredit: number,
  outstandingBefore: number,
): { ledgerCredit: number; advancePosted: number } {
  const credit = Math.max(0, r2c(returnCredit))
  const outstanding = Math.max(0, r2c(outstandingBefore))
  const ledgerCredit = Math.min(credit, outstanding)
  const advancePosted = r2c(credit - ledgerCredit)
  return { ledgerCredit: r2c(ledgerCredit), advancePosted }
}

// ---------------- ADVANCE FIFO CONSUMPTION ----------------

export interface AdvanceSource {
  returnId: string
  returnNo: string
  orderNo: string | null
  /** Task 103: return ka type — note mein user ki zubaan mein label (Return Stock / Damage & Expiry Claim) */
  type?: string | null
  /** is return ka abhi tak un-consumed advance (advancePosted − advanceConsumed) */
  available: number
}
export interface AdvanceAllocation { returnId: string; returnNo: string; orderNo: string | null; type?: string | null; amount: number }

/**
 * Task 103 — return type ko USER KI ZUBAAN mein label karo (wohi jo return waqt
 * dropdown se select hota hai): DAMAGED/EXPIRED => "Damage & Expiry Claim",
 * UNSOLD (sellable maal wapas) => "Return Stock". Unknown/legacy => "Return Stock".
 * User: "Yahn pr wohi likha ho jo hm return krty huy select krty hn — return stock
 * ya damage & expiry claim"
 */
export function returnTypeLabel(type?: string | null): string {
  if (type === 'DAMAGED' || type === 'EXPIRED') return 'Damage & Expiry Claim'
  return 'Return Stock'
}

/**
 * FIFO consumption plan — sab se PURANA advance pehle kharch hota hai (khate ki tarah).
 * Note bhi isi order mein banta hai => user ki "chhoti detail": deduction kis return ki hai.
 */
export function planAdvanceConsumption(
  sources: AdvanceSource[],
  upto: number,
): { allocations: AdvanceAllocation[]; used: number } {
  let remaining = Math.max(0, r2c(upto))
  const allocations: AdvanceAllocation[] = []
  for (const src of sources) {
    if (remaining <= 0.005) break
    const take = Math.min(r2c(src.available), remaining)
    if (take <= 0) continue
    allocations.push({ returnId: src.returnId, returnNo: src.returnNo, orderNo: src.orderNo, type: src.type ?? null, amount: take })
    remaining = r2c(remaining - take)
  }
  return { allocations, used: r2c(allocations.reduce((t, a) => t + a.amount, 0)) }
}

/**
 * Allocation parts — "RET-12 (ORD-45) Rs 2,000.00 — Damage & Expiry Claim • ..."
 * Task 103: har allocation ke sath return ka TYPE label (user ki chhoti detail ab
 * batati hai deduction kis return ki AUR kis qism ki hai).
 */
export function advanceAllocParts(allocations: AdvanceAllocation[]): string {
  return allocations
    .map(
      (a) =>
        `${a.returnNo}${a.orderNo ? ` (${a.orderNo})` : ''} Rs ${a.amount.toFixed(2)} — ${returnTypeLabel(a.type)}`,
    )
    .join(' • ')
}

/** Consumption note — settlement sheet/ledger par yehi "chhoti detail" dikhti hai */
export function advanceNote(
  allocations: AdvanceAllocation[],
  orderNo?: string | null,
): string {
  const base = `Advance adjust: ${advanceAllocParts(allocations)}`
  return orderNo ? `${base} • ${orderNo}` : base
}

// ---------------- SETTLEMENT ROW RECALC ----------------

export interface SettlementRowBase {
  billAmount: number
  returnAmount: number
  advanceTax: number
  gstTotal: number
  tradeOfferTotal: number
  cashAmount: number
}
/** Signed deltas — return: +values, cancel/undo: −values (Task 64 exact reverse) */
export interface SettlementDeltas {
  returnValue: number
  taxRev: number
  gstRev: number
  toRev: number
}
export interface RecalcSettlementResult {
  returnAmount: number
  advanceTax: number
  gstTotal: number
  tradeOfferTotal: number
  net: number
  creditAmount: number
  status: 'CASH' | 'PARTIAL' | 'CREDIT'
  creditDelta: number
}

/**
 * Settlement row recalc (late-return + cancel dono use karte hain).
 * net = bill − return + GST − TO + advTax
 * Task 101: creditAmount = max(0, net − cash) — KABHI negative nahi (no-minus).
 * Purane code mein return > net par creditAmount negative ho jati thi (shop ko wapasi);
 * ab wo hissa shop ke ADVANCE mein jata hai (splitReturnCredit) — row par sirf udhaar.
 * creditDelta = newCredit − oldCredit — summary settledCredit isi se update hota hai.
 */
export function recalcSettlementRow(
  st: SettlementRowBase,
  delta: SettlementDeltas,
): RecalcSettlementResult {
  const returnAmount = Math.max(0, r2c(st.returnAmount + delta.returnValue))
  const advanceTax = Math.max(0, r2c(st.advanceTax - delta.taxRev))
  const gstTotal = Math.max(0, r2c(st.gstTotal - delta.gstRev))
  const tradeOfferTotal = Math.max(0, r2c(st.tradeOfferTotal - delta.toRev))
  const net = r2c(st.billAmount - returnAmount + gstTotal - tradeOfferTotal + advanceTax)
  const creditAmount = Math.max(0, r2c(net - st.cashAmount))
  // oldCredit — delta ke pehle wali clamped credit (creditDelta isi se compute hota hai)
  const oldNet = r2c(st.billAmount - st.returnAmount + st.gstTotal - st.tradeOfferTotal + st.advanceTax)
  const oldCredit = Math.max(0, r2c(oldNet - st.cashAmount))
  const status = st.cashAmount <= 0 ? 'CREDIT' : st.cashAmount >= net ? 'CASH' : 'PARTIAL'
  return {
    returnAmount,
    advanceTax,
    gstTotal,
    tradeOfferTotal,
    net,
    creditAmount,
    status,
    creditDelta: r2c(creditAmount - oldCredit),
  }
}
