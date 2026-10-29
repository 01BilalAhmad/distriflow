import { describe, it, expect } from 'vitest'
import {
  effRateOf,
  computeReturnLines,
  proRataReversals,
  returnCreditOf,
  splitReturnCredit,
  planAdvanceConsumption,
  advanceNote,
  claimAdjustTitle,
  returnTypeLabel,
  advanceAllocParts,
  recalcSettlementRow,
} from './dms-return-core'

// Task 101 — bill-linked return core math. Sab se ahem invariant:
// NO-MINUS — return ke baad shop ka balance / bill net kabhi negative nahi.

describe('effRateOf', () => {
  it('lineTotal/qty deta hai (scheme + manual discount ke baad ka net rate)', () => {
    expect(effRateOf({ qty: 10, rate: 100, lineTotal: 950 })).toBe(95)
  })
  it('legacy fallback — lineTotal 0 par booked rate', () => {
    expect(effRateOf({ qty: 10, rate: 100, lineTotal: 0 })).toBe(100)
  })
  it('qty 0 par booked rate (division guard)', () => {
    expect(effRateOf({ qty: 0, rate: 100, lineTotal: 500 })).toBe(100)
  })
})

describe('computeReturnLines — ITEM CAP', () => {
  const bill = [
    { productId: 'p1', qty: 10, rate: 100, lineTotal: 950, productName: 'SKU A' },
    { productId: 'p2', qty: 5, rate: 200, lineTotal: 1000, productName: 'SKU B' },
  ]
  it('valid return compute hota hai effRate par', () => {
    const { lines, returnValue } = computeReturnLines(bill, [{ productId: 'p1', qty: 3 }], {})
    expect(lines).toEqual([{ productId: 'p1', qty: 3, rate: 95, value: 285 }])
    expect(returnValue).toBe(285)
  })
  it('already returned minus hota hai (returnedMap)', () => {
    const { lines } = computeReturnLines(bill, [{ productId: 'p1', qty: 5 }], { p1: 4 })
    expect(lines[0].value).toBe(475) // sirf 6 returnable the, 5 manga — allowed
  })
  it('cap cross par clear error — over-return impossible', () => {
    expect(() => computeReturnLines(bill, [{ productId: 'p1', qty: 11 }], {})).toThrow(
      'SKU A: sirf 10 pcs return ho sakte hain (billed 10, pehle se wapas 0)',
    )
    expect(() => computeReturnLines(bill, [{ productId: 'p1', qty: 7 }], { p1: 4 })).toThrow(
      'sirf 6 pcs return ho sakte hain (billed 10, pehle se wapas 4)',
    )
  })
  it('bill ka hissa na hone par error', () => {
    expect(() => computeReturnLines(bill, [{ productId: 'nope', qty: 1 }], {})).toThrow('hissa nahi hai')
  })
  it('sab qty 0 par error', () => {
    expect(() => computeReturnLines(bill, [{ productId: 'p1', qty: 0 }], {})).toThrow('Return qty 0 hai')
  })
})

describe('proRataReversals — pro-rata + BILL FLOOR caps', () => {
  const order = { total: 1000, advanceTax: 25, gstTotal: 100, tradeOfferTotal: 50 }
  it('half return par aadha tax/GST/TO reversal', () => {
    const rev = proRataReversals(order, 500, { advanceTax: 25, gstTotal: 100, tradeOfferTotal: 50 })
    expect(rev).toEqual({ taxRev: 12.5, gstRev: 50, toRev: 25 })
  })
  it('st remaining par capped (pehle return ka asar)', () => {
    const rev = proRataReversals(order, 800, { advanceTax: 5, gstTotal: 20, tradeOfferTotal: 50 })
    expect(rev.taxRev).toBe(5) // min(20, 5)
    expect(rev.gstRev).toBe(20) // min(80, 20)
    expect(rev.toRev).toBe(40) // min(40, 50)
  })
  it('st null par order full se cap (settlement row nahi — legacy)', () => {
    const rev = proRataReversals(order, 500, null)
    expect(rev).toEqual({ taxRev: 12.5, gstRev: 50, toRev: 25 })
  })
  it('returnValue 0 par sab zero', () => {
    expect(proRataReversals(order, 0, { advanceTax: 25, gstTotal: 100, tradeOfferTotal: 50 })).toEqual({
      taxRev: 0, gstRev: 0, toRev: 0,
    })
  })
})

describe('splitReturnCredit — SHOP FLOOR (no-minus ka dil)', () => {
  it('outstanding zyada — poora credit ledger mein, advance 0', () => {
    expect(splitReturnCredit(2000, 5000)).toEqual({ ledgerCredit: 2000, advancePosted: 0 })
  })
  it('outstanding kam — hissa udhaar mein, bachi raqam ADVANCE (positive)', () => {
    expect(splitReturnCredit(2000, 1500)).toEqual({ ledgerCredit: 1500, advancePosted: 500 })
  })
  it('bill fully paid (outstanding 0) — poora credit advance mein, ledger 0', () => {
    expect(splitReturnCredit(2000, 0)).toEqual({ ledgerCredit: 0, advancePosted: 2000 })
  })
  it('ledger + advance hamesha = total credit (na zyada, na kam)', () => {
    for (const [credit, outstanding] of [[100, 0], [100, 30], [100, 100], [100, 250]] as const) {
      const s = splitReturnCredit(credit, outstanding)
      expect(s.ledgerCredit + s.advancePosted).toBe(credit)
      expect(s.ledgerCredit).toBeGreaterThanOrEqual(0)
      expect(s.advancePosted).toBeGreaterThanOrEqual(0)
    }
  })
  it('credit kabhi negative nahi (TO reversal zyada hone par bhi)', () => {
    expect(returnCreditOf(100, { taxRev: 0, gstRev: 0, toRev: 150 })).toBe(0)
  })
})

describe('planAdvanceConsumption — FIFO', () => {
  const sources = [
    { returnId: 'r1', returnNo: 'RET-101', orderNo: 'ORD-1', type: 'DAMAGED', available: 500 },
    { returnId: 'r2', returnNo: 'RET-102', orderNo: null, type: 'UNSOLD', available: 800 },
    { returnId: 'r3', returnNo: 'RET-103', orderNo: 'ORD-3', type: 'EXPIRED', available: 200 },
  ]
  it('purana advance pehle kharch', () => {
    const p = planAdvanceConsumption(sources, 600)
    expect(p.used).toBe(600)
    expect(p.allocations).toEqual([
      { returnId: 'r1', returnNo: 'RET-101', orderNo: 'ORD-1', type: 'DAMAGED', amount: 500 },
      { returnId: 'r2', returnNo: 'RET-102', orderNo: null, type: 'UNSOLD', amount: 100 },
    ])
  })
  it('sab se zyada maanga — total available tak', () => {
    const p = planAdvanceConsumption(sources, 99999)
    expect(p.used).toBe(1500)
    expect(p.allocations).toHaveLength(3)
  })
  it('zero demand — koi allocation nahi', () => {
    expect(planAdvanceConsumption(sources, 0)).toEqual({ allocations: [], used: 0 })
  })
  it('note mein returnNo + orderNo + TYPE label (user ki chhoti detail) hoti hai', () => {
    const p = planAdvanceConsumption(sources, 600)
    expect(advanceNote(p.allocations, 'ORD-900')).toBe(
      'Claim adjust: RET-101 (ORD-1) Rs 500.00 — Damage & Expiry Claim • RET-102 Rs 100.00 — Return Stock • ORD-900',
    )
  })
})

describe('returnTypeLabel — Task 103 (user ki zubaan)', () => {
  it('DAMAGED/EXPIRED => Damage & Expiry Claim', () => {
    expect(returnTypeLabel('DAMAGED')).toBe('Damage & Expiry Claim')
    expect(returnTypeLabel('EXPIRED')).toBe('Damage & Expiry Claim')
  })
  it('UNSOLD => Return Stock', () => {
    expect(returnTypeLabel('UNSOLD')).toBe('Return Stock')
  })
  it('unknown/legacy null => Return Stock fallback', () => {
    expect(returnTypeLabel(null)).toBe('Return Stock')
    expect(returnTypeLabel(undefined)).toBe('Return Stock')
  })
  it('advanceAllocParts — label allocation ke sath', () => {
    expect(
      advanceAllocParts([{ returnId: 'r1', returnNo: 'RET-1', orderNo: 'ORD-2', type: 'DAMAGED', amount: 1500 }]),
    ).toBe('RET-1 (ORD-2) Rs 1500.00 — Damage & Expiry Claim')
  })
})

describe('claimAdjustTitle — Task 28 (user ki zubaan: Advance Adjustment nahi, Claim Adjustment)', () => {
  it('sab allocations Damage & Expiry => title mein bhi wahi qism', () => {
    expect(
      claimAdjustTitle([
        { returnId: 'r1', returnNo: 'RET-1', orderNo: null, type: 'DAMAGED', amount: 500 },
        { returnId: 'r2', returnNo: 'RET-2', orderNo: null, type: 'EXPIRED', amount: 100 },
      ]),
    ).toBe('Claim Adjustment (Damage & Expiry Claim)')
  })
  it('sab Return Stock => Claim Adjustment (Return Stock)', () => {
    expect(
      claimAdjustTitle([{ returnId: 'r1', returnNo: 'RET-1', orderNo: null, type: 'UNSOLD', amount: 200 }]),
    ).toBe('Claim Adjustment (Return Stock)')
  })
  it('mixed qism => generic Claim Adjustment (per-RET qism note mein hai)', () => {
    expect(
      claimAdjustTitle([
        { returnId: 'r1', returnNo: 'RET-1', orderNo: null, type: 'DAMAGED', amount: 500 },
        { returnId: 'r2', returnNo: 'RET-2', orderNo: null, type: 'UNSOLD', amount: 100 },
      ]),
    ).toBe('Claim Adjustment')
  })
  it('khali/legacy => generic Claim Adjustment', () => {
    expect(claimAdjustTitle([])).toBe('Claim Adjustment')
    expect(claimAdjustTitle([{ returnId: 'r1', returnNo: 'RET-1', orderNo: null, type: null, amount: 50 }])).toBe('Claim Adjustment (Return Stock)')
  })
})

describe('recalcSettlementRow — clamped credit + creditDelta', () => {
  const st = { billAmount: 10000, returnAmount: 0, advanceTax: 250, gstTotal: 1000, tradeOfferTotal: 500, cashAmount: 10750 }
  // oldNet = 10000 + 1000 − 500 + 250 = 10750; oldCredit = 0 (fully cash)

  it('normal partial return — credit badhta hai, delta sahi', () => {
    // return 2000, taxRev 50, gstRev 200, toRev 100 → net = 10000−2000+800−400+200 = 8600
    const r = recalcSettlementRow(st, { returnValue: 2000, taxRev: 50, gstRev: 200, toRev: 100 })
    expect(r.net).toBe(8600)
    expect(r.creditAmount).toBe(0) // cash 10750 >= net → CASH, clamp 0
    expect(r.status).toBe('CASH')
    expect(r.creditDelta).toBe(0)
  })

  it('udhaar bill par return — credit kam hota hai (delta negative)', () => {
    const creditSt = { ...st, cashAmount: 0 }
    const r = recalcSettlementRow(creditSt, { returnValue: 2000, taxRev: 50, gstRev: 200, toRev: 100 })
    expect(r.net).toBe(8600)
    expect(r.creditAmount).toBe(8600)
    expect(r.status).toBe('CREDIT')
    // oldCredit 10750 (poora udhaar) → newCredit 8600
    expect(r.creditDelta).toBe(-2150)
  })

  it('NO-MINUS: net cash se neeche gir jaye to credit 0 — negative kabhi nahi', () => {
    const r = recalcSettlementRow(st, { returnValue: 5000, taxRev: 125, gstRev: 500, toRev: 250 })
    // net = 10000 − 5000 + 500 − 250 + 125 = 5375; cash 10750 >= net → CASH
    expect(r.net).toBe(5375)
    expect(r.creditAmount).toBe(0)
    expect(r.creditAmount).toBeGreaterThanOrEqual(0)
  })

  it('cancel (negative deltas) — row wapas pehli state', () => {
    const after = recalcSettlementRow(st, { returnValue: 2000, taxRev: 50, gstRev: 200, toRev: 100 })
    const restored = recalcSettlementRow(
      { ...st, returnAmount: after.returnAmount, advanceTax: after.advanceTax, gstTotal: after.gstTotal, tradeOfferTotal: after.tradeOfferTotal },
      { returnValue: -2000, taxRev: -50, gstRev: -200, toRev: -100 },
    )
    expect(restored.returnAmount).toBe(0)
    expect(restored.net).toBe(10750)
    expect(restored.creditAmount).toBe(0)
  })
})
