import { describe, it, expect } from 'vitest'
import {
  incomingPcs,
  computeOrderLines,
  computePurchaseLineTaxes,
  orderGrandPayable,
  splitManualByNet,
  applyManualMerge,
  recalcManualDiscount,
  aggregateSchemePromos,
  type CalcProduct,
  type CalcScheme,
  type CalcLine,
} from './dms-order-calc'

/**
 * Unit tests for the server-authoritative money math (audit Finding 2-d#1 —
 * "TOP 5 TESTS TO WRITE FIRST" #1). Every rupee on every bill flows through
 * computeOrderLines — these tests pin the documented behavior:
 * 3-unit conversion, scheme stacking (Task 58), GST base rule (Task 45),
 * manual discount merge (Task 52), and grand payable rounding.
 */

const P1: CalcProduct = {
  id: 'p1',
  unitsPerCarton: 10,
  pcsPerBox: 2,
  tradePrice: 100, // per carton → 10 per piece
  gstEnabled: true,
  gstRate: 18,
  category: 'Biscuits',
}

describe('incomingPcs — 3-unit conversion', () => {
  const p = P1

  it('adds ctn + box + pcs with pack config', () => {
    expect(incomingPcs({ productId: 'p1', ctn: 2, box: 1, pcs: 3 }, p)).toBe(2 * 10 + 1 * 2 + 3)
  })

  it('uses direct qty when ctn/box/pcs absent', () => {
    expect(incomingPcs({ productId: 'p1', qty: 7 }, p)).toBe(7)
  })

  it('ignores box when pcsPerBox is 0', () => {
    const noBox = { ...p, pcsPerBox: 0 }
    expect(incomingPcs({ productId: 'p1', ctn: 1, box: 9, pcs: 0 }, noBox)).toBe(10)
  })

  it('clamps negatives and floors fractions', () => {
    expect(incomingPcs({ productId: 'p1', ctn: -2, pcs: 1.9 }, p)).toBe(1)
    expect(incomingPcs({ productId: 'p1', qty: -5 }, p)).toBe(0)
  })
})

describe('computeOrderLines — base pricing', () => {
  it('prices lines at tradePrice / unitsPerCarton with no schemes', () => {
    const r = computeOrderLines([P1], [], [{ productId: 'p1', ctn: 2 }], 'KIRYANA')
    expect(r.lines).toHaveLength(1)
    const line = r.lines[0]
    expect(line.qty).toBe(20)
    expect(line.rate).toBe(10)
    expect(line.discount).toBe(0)
    expect(line.lineTotal).toBe(200)
    expect(r.subtotal).toBe(200)
    expect(r.schemeDiscount).toBe(0)
  })

  it('applies per-product GST on the scheme-discounted net (GST base = gross − scheme discount)', () => {
    const pct: CalcScheme = {
      id: 's1', type: 'PERCENT_DISCOUNT', channel: null, productId: 'p1',
      value: 10, buyQty: 0, freeQty: 0,
    }
    const r = computeOrderLines([P1], [pct], [{ productId: 'p1', ctn: 2 }], 'KIRYANA')
    // gross 200 → 10% = 20 discount → net 180 → GST 18% = 32.4
    expect(r.lines[0].gstAmt).toBeCloseTo(32.4, 2)
    expect(r.lines[0].lineTotal).toBe(180)
    expect(r.gstTotal).toBeCloseTo(32.4, 2)
  })

  it('skips unknown products and non-positive quantities', () => {
    const r = computeOrderLines(
      [P1],
      [],
      [
        { productId: 'ghost', ctn: 5 },
        { productId: 'p1', qty: 0 },
        { productId: 'p1', ctn: 1 },
      ],
      'KIRYANA',
    )
    expect(r.lines).toHaveLength(1)
    expect(r.lines[0].qty).toBe(10)
  })

  it('preserves booked snapshot rate and booked GST rate on existing lines', () => {
    const r = computeOrderLines(
      [P1],
      [],
      [{ productId: 'p1', ctn: 2, rate: 9, bookedGstRate: 5 }],
      'KIRYANA',
    )
    expect(r.lines[0].rate).toBe(9)
    expect(r.lines[0].gstAmt).toBeCloseTo(180 * 0.05, 2) // 9
    expect(r.lines[0].gstRate).toBe(5)
  })

  it(' zeroes GST for gstEnabled=false products', () => {
    const noGst = { ...P1, gstEnabled: false, gstRate: 18 }
    const r = computeOrderLines([noGst], [], [{ productId: 'p1', ctn: 1 }], 'KIRYANA')
    expect(r.lines[0].gstAmt).toBe(0)
    expect(r.lines[0].gstRate).toBeNull()
  })
})

describe('computeOrderLines — scheme stacking (Task 58 full stack)', () => {
  // 3% product-tier + 2% category-tier + 2% blanket = 7% of gross
  const schemes: CalcScheme[] = [
    { id: 'cat', name: 'Khushhali', type: 'PERCENT_DISCOUNT', channel: null, productId: null, categoryName: 'Biscuits', value: 2, buyQty: 0, freeQty: 0 },
    { id: 'blanket', name: 'All-Pak', type: 'PERCENT_DISCOUNT', channel: null, productId: null, value: 2, buyQty: 0, freeQty: 0 },
    { id: 'prod', name: 'Eclair', type: 'PERCENT_DISCOUNT', channel: null, productId: 'p1', value: 3, buyQty: 0, freeQty: 0 },
  ]

  it('stacks all qualifying percent schemes, product tier first', () => {
    const r = computeOrderLines([P1], schemes, [{ productId: 'p1', ctn: 1 }], 'KIRYANA')
    const line = r.lines[0]
    expect(line.schemeStack).toHaveLength(3)
    expect(line.schemeStack?.[0]?.id).toBe('prod') // most specific first
    expect(line.discount).toBeCloseTo(7, 2) // 3 + 2 + 2 of gross 100
    expect(line.lineTotal).toBeCloseTo(93, 2)
    expect(line.schemeName).toBe('Eclair + Khushhali + All-Pak')
    expect(r.schemeDiscount).toBeCloseTo(7, 2)
  })

  it('records per-scheme amounts in stack rows (Task 57 attribution)', () => {
    const r = computeOrderLines([P1], schemes, [{ productId: 'p1', ctn: 1 }], 'KIRYANA')
    const rows = r.lines[0].schemeStack ?? []
    expect(rows.find((s) => s.id === 'prod')?.amount).toBeCloseTo(3, 2)
    expect(rows.find((s) => s.id === 'cat')?.amount).toBeCloseTo(2, 2)
    expect(rows.find((s) => s.id === 'blanket')?.amount).toBeCloseTo(2, 2)
  })

  it('filters by channel and filerScope', () => {
    const scoped: CalcScheme[] = [
      { id: 'ch', name: 'Channel', type: 'PERCENT_DISCOUNT', channel: 'WHOLESALE', productId: 'p1', value: 5, buyQty: 0, freeQty: 0 },
      { id: 'filer', name: 'FilerOnly', type: 'PERCENT_DISCOUNT', channel: null, productId: 'p1', filerScope: 'FILER', value: 4, buyQty: 0, freeQty: 0 },
    ]
    const noMatch = computeOrderLines([P1], scoped, [{ productId: 'p1', ctn: 1 }], 'KIRYANA')
    expect(noMatch.lines[0].discount).toBe(0)

    const filer = computeOrderLines([P1], scoped, [{ productId: 'p1', ctn: 1 }], 'KIRYANA', 'FILER')
    expect(filer.lines[0].discount).toBeCloseTo(4, 2)
  })

  it('applies BUY_X_GET_Y in carton equivalents only when threshold met', () => {
    const bxgy: CalcScheme[] = [
      { id: 'bx', name: 'Buy2Get1', type: 'BUY_X_GET_Y', channel: null, productId: 'p1', value: 0, buyQty: 2, freeQty: 1 },
    ]
    const qualified = computeOrderLines([P1], bxgy, [{ productId: 'p1', ctn: 4 }], 'KIRYANA')
    expect(qualified.lines[0].freeQty).toBe(Math.floor(4 / 2) * 1 * 10) // 20 free pcs

    const notQualified = computeOrderLines([P1], bxgy, [{ productId: 'p1', ctn: 1 }], 'KIRYANA')
    expect(notQualified.lines[0].freeQty).toBe(0)
  })

  it('applies FLAT_DISCOUNT per carton equivalent', () => {
    const flat: CalcScheme[] = [
      { id: 'f', name: 'Rs50', type: 'FLAT_DISCOUNT', channel: null, productId: 'p1', value: 50, buyQty: 0, freeQty: 0 },
    ]
    const r = computeOrderLines([P1], flat, [{ productId: 'p1', ctn: 2 }], 'KIRYANA')
    expect(r.lines[0].discount).toBeCloseTo(100, 2)
  })

  it('re-applies the frozen schemeStack on edit instead of current schemes (Task 56)', () => {
    // Line was booked when scheme 'old' gave 10%; scheme has since changed to 50%.
    const r = computeOrderLines(
      [P1],
      [{ id: 'new', name: 'New50', type: 'PERCENT_DISCOUNT', channel: null, productId: 'p1', value: 50, buyQty: 0, freeQty: 0 }],
      [{
        productId: 'p1',
        ctn: 1,
        schemeStack: [{ id: 'old', name: 'Old10', type: 'PERCENT_DISCOUNT', value: 10, buyQty: 0, freeQty: 0 }],
      }],
      'KIRYANA',
    )
    expect(r.lines[0].discount).toBeCloseTo(10, 2) // frozen 10%, not 50%
  })
})

describe('splitManualByNet — pro-rata manual discount (Task 52)', () => {
  it('splits by net weight and sums exactly to the manual amount', () => {
    const shares = splitManualByNet([100, 50], 30)
    expect(shares[0]).toBeCloseTo(20, 2)
    expect(shares[1]).toBeCloseTo(10, 2)
    expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(30, 2)
  })

  it('caps the manual amount at the total net', () => {
    const shares = splitManualByNet([10, 0], 100)
    expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(10, 2)
    expect(shares.every((v) => v >= 0)).toBe(true)
  })

  it('returns all zeros for non-positive manual', () => {
    expect(splitManualByNet([100, 50], 0)).toEqual([0, 0])
    expect(splitManualByNet([], 50)).toEqual([])
  })
})

describe('applyManualMerge — pass-on merge (Task 52)', () => {
  function baseLines(): CalcLine[] {
    return computeOrderLines(
      [P1],
      [],
      [{ productId: 'p1', ctn: 1 }, { productId: 'p1', ctn: 2 }],
      'KIRYANA',
    ).lines
  }

  it('merges shares into lines, keeps column totals exact, recomputes GST', () => {
    const lines = baseLines()
    const before = lines.reduce((s, l) => s + l.lineTotal, 0) // 300
    const gst = applyManualMerge(lines, 30)

    const totalAfter = lines.reduce((s, l) => s + l.lineTotal, 0)
    expect(totalAfter).toBeCloseTo(before - 30, 2) // 270
    const shareSum = lines.reduce((s, l) => s + l.manualShare, 0)
    expect(shareSum).toBeCloseTo(30, 2)
    expect(gst).toBeCloseTo(270 * 0.18, 2) // 48.6
  })

  it('is a no-op for non-positive manual', () => {
    const lines = baseLines()
    const before = lines.map((l) => ({ ...l }))
    applyManualMerge(lines, 0)
    expect(lines).toEqual(before)
  })
})

describe('recalcManualDiscount — cap rule', () => {
  it('computes PERCENT from subtotal', () => {
    const r = recalcManualDiscount('PERCENT', 10, 500, 20)
    expect(r.manualDiscount).toBeCloseTo(50, 2)
    expect(r.manualDiscType).toBe('PERCENT')
  })

  it('caps so subtotal − schemeDiscount − manual ≥ 0', () => {
    const r = recalcManualDiscount('FLAT', 100000, 500, 20)
    expect(r.manualDiscount).toBeCloseTo(480, 2)
  })

  it('returns zeros for absent/unknown types', () => {
    expect(recalcManualDiscount(null, 10, 500, 0).manualDiscount).toBe(0)
    expect(recalcManualDiscount('MYSTERY', 10, 500, 0).manualDiscount).toBe(0)
  })
})

describe('orderGrandPayable', () => {
  it('follows the goods − tradeOffer + GST + advanceTax chain', () => {
    expect(orderGrandPayable({ total: 1000, tradeOfferTotal: 50, gstTotal: 180, advanceTax: 10 })).toBe(1140)
  })

  it('treats missing legs as zero (backward compatible for old orders)', () => {
    expect(orderGrandPayable({ total: 1000 })).toBe(1000)
  })

  it('rounds to 2 decimal places', () => {
    expect(orderGrandPayable({ total: 100.005, gstTotal: 0.001 })).toBe(100.01)
  })
})

describe('aggregateSchemePromos — per-scheme rows (Task 57)', () => {
  it('aggregates stack rows per scheme id (BxGy pcs vs money amounts)', () => {
    const rows = aggregateSchemePromos([
      {
        qty: 20, rate: 10, discount: 7, unitsPerCarton: 10,
        schemeStack: [
          { id: 'bx', name: 'Buy2Get1', type: 'BUY_X_GET_Y', value: 0, buyQty: 2, freeQty: 1, freeQtyGiven: 10 },
          { id: 'pct', name: 'Eclair', type: 'PERCENT_DISCOUNT', value: 3, buyQty: 0, freeQty: 0, amount: 6 },
        ],
      },
    ])
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.id === 'bx')?.freePcs).toBe(10)
    expect(rows.find((r) => r.id === 'pct')?.amount).toBeCloseTo(6, 2)
  })

  it('falls back to schemeName + line discount for legacy lines (pre-Task 56)', () => {
    const rows = aggregateSchemePromos([
      { qty: 10, rate: 10, discount: 12, schemeName: 'Old Promo' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('Old Promo')
    expect(rows[0].amount).toBeCloseTo(12, 2)
  })
})

describe('Task 26 — TAX MODE: INVOICE_DISCOUNT (GST on net − Trade Offer)', () => {
  // Noms/SalesFlo ladder: Gross → Offers → Net → GST. TO pehle minus hota hai,
  // GST baqi (net − TO) par lagta hai. CLAIM (default) = purana rule (GST net par).
  const PA: CalcProduct = { ...P1, taxMode: 'INVOICE_DISCOUNT' } // gross 100/ctn, GST 18%

  it('CLAIM (default, no taxMode) keeps the old GST base = net — TO baad me minus', () => {
    const r = computeOrderLines([P1], [], [{ productId: 'p1', ctn: 2, tradeOffer: 40 }], 'KIRYANA')
    expect(r.lines[0].gstAmt).toBeCloseTo(200 * 0.18, 2) // 36 — base untouched by TO
    expect(r.lines[0].taxMode).toBe('CLAIM')
    expect(r.tradeOfferTotal).toBe(40)
  })

  it('INVOICE_DISCOUNT: GST base = net − per-line TO (SalesFlo/Noms style)', () => {
    const r = computeOrderLines([PA], [], [{ productId: 'p1', ctn: 2, tradeOffer: 40 }], 'KIRYANA')
    expect(r.lines[0].gstAmt).toBeCloseTo((200 - 40) * 0.18, 2) // 28.8
    expect(r.lines[0].taxMode).toBe('INVOICE_DISCOUNT')
  })

  it('zero TO par dono modes SAME GST (regression guard)', () => {
    const claim = computeOrderLines([P1], [], [{ productId: 'p1', ctn: 2 }], 'KIRYANA')
    const inv = computeOrderLines([PA], [], [{ productId: 'p1', ctn: 2 }], 'KIRYANA')
    expect(inv.lines[0].gstAmt).toBe(claim.lines[0].gstAmt)
    expect(claim.lines[0].gstAmt).toBeCloseTo(36, 2)
  })

  it('TO > net line par clamp 0 — extra TO dusri lines ka base NAHI khatata (mixed order)', () => {
    const claimP: CalcProduct = { ...P1, id: 'pclaim' } // CLAIM line: gross 100
    const r = computeOrderLines(
      [PA, claimP],
      [],
      [
        { productId: 'p1', ctn: 1, tradeOffer: 150 }, // mode A: net 100, TO 150 → GST base 0
        { productId: 'pclaim', ctn: 1, tradeOffer: 0 }, // CLAIM: net 100 → GST base 100
      ],
      'KIRYANA',
    )
    expect(r.lines[0].gstAmt).toBe(0) // clamped
    expect(r.lines[1].gstAmt).toBeCloseTo(18, 2) // unaffected by p1 ka extra TO
    // Mixed order — do modes ek bill mein, har line apne rule par
    expect(r.lines[0].taxMode).toBe('INVOICE_DISCOUNT')
    expect(r.lines[1].taxMode).toBe('CLAIM')
  })

  it('applyManualMerge re-computes Mode A GST on (merged net − TO)', () => {
    const r = computeOrderLines([PA], [], [{ productId: 'p1', ctn: 2, tradeOffer: 40 }], 'KIRYANA')
    const gst = applyManualMerge(r.lines, 20) // manual 20 → merged net 180, base 180−40=140
    expect(r.lines[0].lineTotal).toBe(180)
    expect(gst).toBeCloseTo(140 * 0.18, 2) // 25.2
  })

  it('applyManualMerge CLAIM lines unchanged (merged net × rate)', () => {
    const r = computeOrderLines([P1], [], [{ productId: 'p1', ctn: 2, tradeOffer: 40 }], 'KIRYANA')
    const gst = applyManualMerge(r.lines, 20) // merged net 180 — TO base se bahar
    expect(gst).toBeCloseTo(180 * 0.18, 2) // 32.4
  })

  it('236H base chain (total − TO + GST) Mode A par SalesFlo-exact rahta hai', () => {
    // Gross 217,330.40 jaisa structure — chhota example: total 200, TO 40, GST 28.8
    const r = computeOrderLines([PA], [], [{ productId: 'p1', ctn: 2, tradeOffer: 40 }], 'KIRYANA')
    const total = r.subtotal - r.schemeDiscount // 200
    const advBase = total - r.tradeOfferTotal + r.gstTotal // 200 − 40 + 28.8 = 188.8
    expect(advBase).toBeCloseTo(188.8, 2)
    // orderGrandPayable formula unchanged — dono modes par wahi chain
    expect(orderGrandPayable({ total, tradeOfferTotal: r.tradeOfferTotal, gstTotal: r.gstTotal, advanceTax: 0 })).toBe(188.8)
  })
})

describe('Task 108: computePurchaseLineTaxes — purchase ladder company tax-mode ke mutabiq', () => {
  it('CLAIM (default) — purana rule barqarar: GST poore net par, TO baad me minus', () => {
    const r = computePurchaseLineTaxes({ gross: 10000, discAmt: 0, gstRate: 18, furtherTaxPct: 0, tradeOfferRequest: 500, advanceTaxPct: 0.5 })
    expect(r.netAmount).toBe(10000)
    expect(r.salesTax).toBe(1800) // 10,000 × 18% — TO base se bahar
    expect(r.totalTax).toBe(1800)
    expect(r.tradeOfferAmt).toBe(500)
    expect(r.advanceTax).toBe(56.5) // 0.5% × (10,000 + 1,800 − 500)
    expect(r.amountInclusive).toBe(11356.5)
  })

  it('INVOICE_DISCOUNT (Noms) — REAL SalesFlo bill row 1 exact: Gross 6,240.24, Dist 8%, TO 6%, GST 18% = 965.99', () => {
    const r = computePurchaseLineTaxes({ gross: 6240.24, discAmt: 499.22, gstRate: 18, furtherTaxPct: 0, tradeOfferRequest: 374.41, advanceTaxPct: 0, taxMode: 'INVOICE_DISCOUNT' })
    expect(r.netAmount).toBe(5741.02) // gross − dist (TO iske BAAD katata hai ladder)
    expect(r.salesTax).toBe(965.99) // (5,741.02 − 374.41) × 18% = 5,366.61 × 18% — NOMS bill PDF row 1 exact
    expect(r.tradeOfferAmt).toBe(374.41)
    expect(r.amountInclusive).toBe(6332.6) // 5,741.02 + 965.99 − 374.41 (NOMS Total Amount column)
  })

  it('INVOICE_DISCOUNT — 18% GST net−TO par (row 2: 9,540.33 base → 1,717.26)', () => {
    const r = computePurchaseLineTaxes({ gross: 11093.4, discAmt: 887.47, gstRate: 18, furtherTaxPct: 0, tradeOfferRequest: 665.6, advanceTaxPct: 0, taxMode: 'INVOICE_DISCOUNT' })
    expect(r.salesTax).toBe(1717.26) // NOMS bill PDF row 2 exact
  })

  it('INVOICE_DISCOUNT — TO cap net tak, GST base kabhi negative nahi', () => {
    const r = computePurchaseLineTaxes({ gross: 1000, discAmt: 0, gstRate: 18, furtherTaxPct: 0, tradeOfferRequest: 5000, advanceTaxPct: 0.5, taxMode: 'INVOICE_DISCOUNT' })
    expect(r.tradeOfferAmt).toBe(1000) // net se zyada nahi
    expect(r.salesTax).toBe(0) // base 0
  })

  it('CLAIM — TO cap net+tax tak (purana behaviour)', () => {
    const r = computePurchaseLineTaxes({ gross: 1000, discAmt: 0, gstRate: 18, furtherTaxPct: 0, tradeOfferRequest: 5000, advanceTaxPct: 0 })
    expect(r.salesTax).toBe(180) // GST poore net par
    expect(r.tradeOfferAmt).toBe(1180) // net + totalTax
    expect(r.amountInclusive).toBe(0)
  })

  it('Further Tax bhi company ke GST base par (mode-aware)', () => {
    const claim = computePurchaseLineTaxes({ gross: 1000, discAmt: 0, gstRate: 0, furtherTaxPct: 2, tradeOfferRequest: 100, advanceTaxPct: 0 })
    const noms = computePurchaseLineTaxes({ gross: 1000, discAmt: 0, gstRate: 0, furtherTaxPct: 2, tradeOfferRequest: 100, advanceTaxPct: 0, taxMode: 'INVOICE_DISCOUNT' })
    expect(claim.furtherTax).toBe(20) // 1000 par
    expect(noms.furtherTax).toBe(18) // 900 par
  })
})