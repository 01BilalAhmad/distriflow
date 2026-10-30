import { describe, it, expect } from 'vitest'
import { liveRecalcFromParts, type LiveRecalcOrderParts } from '@/lib/dms-live-recalc'

/**
 * Task 112 — Process Anyway trim regression tests.
 * Jab office "Process Anyway" par kisi line ka stock cut karta hai, line qty=0 ho
 * sakti hai (fully-cut). Live recalc sirf ACTIVE (qty > 0) lines par chalna chahiye —
 * warna lines.length stale-guard recalc ko fail karta aur bill ke naye (trimmed)
 * totals persist hi nahi hote.
 */

const product = {
  unitsPerCarton: 12,
  pcsPerBox: 0,
  tradePrice: 1200,
  gstEnabled: false,
  gstRate: 0,
  category: null,
  consumerPrice: null,
  taxMode: 'CLAIM',
}

function parts(qtys: number[]): LiveRecalcOrderParts {
  return {
    channel: 'GENERAL',
    filerStatus: null,
    manualDiscType: null,
    manualDiscValue: null,
    items: qtys.map((qty, i) => ({
      id: `item-${i}`,
      productId: 'p1',
      qty,
      rate: 100,
      tradeOfferAmt: 0,
      gstRate: null,
      product,
    })),
  }
}

describe('liveRecalcFromParts — Task 112 fully-cut (qty=0) lines', () => {
  it('skips qty=0 cut lines and recalcs totals on active lines only', () => {
    // 1 line fully loaded (2 pcs) + 1 line fully cut (0 pcs) → recalc sirf loaded par
    const res = liveRecalcFromParts(parts([2, 0]), [])
    expect(res).not.toBeNull()
    expect(res!.lines.length).toBe(1)
    expect(res!.subtotal).toBe(200)
    expect(res!.total).toBe(200)
    expect(res!.gstTotal).toBe(0)
  })

  it('normal full-stock order stays unchanged', () => {
    const res = liveRecalcFromParts(parts([3]), [])
    expect(res).not.toBeNull()
    expect(res!.lines.length).toBe(1)
    expect(res!.subtotal).toBe(300)
    expect(res!.total).toBe(300)
  })

  it('mixed quantities recalc per-line totals exactly', () => {
    const res = liveRecalcFromParts(parts([1, 0, 4]), [])
    expect(res).not.toBeNull()
    expect(res!.lines.length).toBe(2)
    expect(res!.subtotal).toBe(500)
  })
})
