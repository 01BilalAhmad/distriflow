/**
 * Shared order line calculation — POST (booking) aur PATCH UPDATE_ITEMS (stock
 * allocation edit) DONO jagah same math: 3-unit conversion, scheme (BUY_X_GET_Y /
 * PERCENT / FLAT), rate per piece, manual discount cap.
 * Server-authoritative: sirf yahan calc hota hai, UI sirf preview mangta hai.
 */

export interface CalcProduct {
  id: string
  unitsPerCarton: number
  pcsPerBox: number
  tradePrice: number
}

export interface CalcScheme {
  id: string
  type: string // BUY_X_GET_Y | PERCENT_DISCOUNT | FLAT_DISCOUNT
  channel: string | null
  productId: string | null
  value: number
  buyQty: number
  freeQty: number
}

export interface CalcIncomingItem {
  productId: string
  ctn?: number
  box?: number
  pcs?: number
  qty?: number // direct pieces
  /** Existing line ka booked rate (per pc) preserve karne ke liye — stock-allocation
   * edit par purani lines RE-PRICE nahi hotin (Task 17 principle: snapshot rate),
   * sirf nayi add ki hui lines current tradePrice par aati hain. */
  rate?: number
}

export interface CalcLine {
  productId: string
  qty: number
  freeQty: number
  rate: number
  discount: number
  schemeId: string | null
  lineTotal: number
}

export interface CalcResult {
  lines: CalcLine[]
  subtotal: number
  schemeDiscount: number
}

/** 3-unit ctn/box/pcs -> total PIECES (product pack config ke mutabiq) */
export function incomingPcs(item: CalcIncomingItem, p: CalcProduct): number {
  const upc = Math.max(1, p.unitsPerCarton)
  const pcsPerBox = p.pcsPerBox > 0 ? p.pcsPerBox : 0
  if (item.ctn != null || item.box != null || item.pcs != null) {
    const ctn = Math.max(0, Math.floor(Number(item.ctn) || 0))
    const box = pcsPerBox > 0 ? Math.max(0, Math.floor(Number(item.box) || 0)) : 0
    const pcs = Math.max(0, Math.floor(Number(item.pcs) || 0))
    return ctn * upc + box * pcsPerBox + pcs
  }
  return Math.max(0, Math.floor(Number(item.qty) || 0))
}

/**
 * Order lines compute karo (POST booking + PATCH stock-allocation edit dono use karte hain).
 * Unknown product / qty<=0 lines skip hoti hain (POST route jaisa hi behavior).
 */
export function computeOrderLines(
  products: CalcProduct[],
  schemes: CalcScheme[],
  items: CalcIncomingItem[],
  channel: string,
): CalcResult {
  let subtotal = 0
  let schemeDiscount = 0
  const lines: CalcLine[] = []

  for (const item of items) {
    const p = products.find((x) => x.id === item.productId)
    if (!p) continue
    const upc = Math.max(1, p.unitsPerCarton)
    const qty = incomingPcs(item, p)
    if (qty <= 0) continue

    const ratePerPc = (item.rate != null && Number(item.rate) > 0)
      ? Number(item.rate) // booked snapshot rate (existing line)
      : p.tradePrice / upc // nayi line — current rate

    // schemes carton-based hain (buyQty/freeQty/value per carton) — ctn-equivalent se compare
    const ctnEquiv = qty / upc
    let freeQty = 0
    let discount = 0
    let schemeId: string | null = null

    const applicable = schemes
      .filter((s) => (!s.productId || s.productId === p.id) && (!s.channel || s.channel === channel))
      .sort((a, b) => b.value - a.value)

    for (const s of applicable) {
      if (s.type === 'BUY_X_GET_Y' && s.buyQty > 0 && ctnEquiv >= s.buyQty) {
        freeQty = Math.round(Math.floor(ctnEquiv / s.buyQty) * s.freeQty * upc)
        schemeId = s.id
        break // one BxGy per line
      }
    }
    if (!schemeId) {
      for (const s of applicable) {
        // PERCENT discount = EXACT % of line GROSS (rate × qty), 2-decimal — whole-rupee
        // rounding nahi (warna chhoti line par flat Rs jaisa lagta tha: 92.29 ka 5% = 4.61, 5 nahi)
        if (s.type === 'PERCENT_DISCOUNT') {
          discount += Math.round(ratePerPc * qty * (s.value / 100) * 100) / 100
          schemeId = s.id
          break
        }
        if (s.type === 'FLAT_DISCOUNT') {
          discount += Math.round(s.value * ctnEquiv * 100) / 100
          schemeId = s.id
          break
        }
      }
    }

    const lineTotal = Math.round(ratePerPc * qty * 100) / 100 - discount
    subtotal += Math.round(ratePerPc * qty * 100) / 100
    schemeDiscount += discount
    lines.push({ productId: p.id, qty, freeQty, rate: ratePerPc, discount, schemeId, lineTotal })
  }

  return { lines, subtotal: Math.round(subtotal * 100) / 100, schemeDiscount }
}

/**
 * Manual (order-level) discount recalc — edit ke baad subtotal badalta hai to
 * PERCENT dobara apply hota hai, FLAT same rehta hai; dono capped so total >= 0.
 */
export function recalcManualDiscount(
  type: string | null | undefined,
  rawValue: number | null | undefined,
  subtotal: number,
  schemeDiscount: number,
): { manualDiscount: number; manualDiscType: string | null; manualDiscValue: number | null } {
  if ((type === 'PERCENT' || type === 'FLAT') && rawValue != null && Number.isFinite(Number(rawValue)) && Number(rawValue) > 0) {
    const v = Number(rawValue)
    let md = type === 'PERCENT'
      ? Math.round(subtotal * (v / 100) * 100) / 100
      : Math.round(v * 100) / 100
    md = Math.min(md, Math.max(0, subtotal - schemeDiscount))
    return { manualDiscount: Math.round(md * 100) / 100, manualDiscType: type, manualDiscValue: v }
  }
  return { manualDiscount: 0, manualDiscType: null, manualDiscValue: null }
}
