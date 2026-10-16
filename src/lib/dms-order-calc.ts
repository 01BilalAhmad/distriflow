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
  /** Task 45: per-product GST (Products page se set hota hai — kuch bhi hardcoded nahi) */
  gstEnabled?: boolean
  gstRate?: number
  /** Task 55: category-wide scheme match — Product.category string isi se compare hota hai */
  category?: string | null
}

export interface CalcScheme {
  id: string
  name?: string
  type: string // BUY_X_GET_Y | PERCENT_DISCOUNT | FLAT_DISCOUNT
  channel: string | null
  productId: string | null
  /** Task 55: category-wide scheme — category NAME se match (Product.category string) */
  categoryName?: string | null
  /** Task 55: outlet tax-status scope — null = all outlets | FILER | NON_FILER */
  filerScope?: string | null
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
  /** Task 41: existing line ka BOOKED SCHEME SNAPSHOT — scheme baad me edit ho to
   * purani lines hamesha booking waqt ke type/value/buyQty/freeQty par re-apply hoti
   * hain, current scheme se nahi (bill jis % par bana, usi par rahe). */
  scheme?: { id: string; name?: string; type: string; value: number; buyQty: number; freeQty: number } | null
  /** Task 45: per-SKU Trade Offer Rs (booking form se) — discount ke ILAWA, kuch SKUs par */
  tradeOffer?: number | null
  /** Task 45: existing line ka BOOKED GST rate snapshot (stock-allocation edit par
   * re-apply hota hai — product ka current rate purane bill par asar nahi dalta) */
  bookedGstRate?: number | null
}

export interface CalcLine {
  productId: string
  qty: number
  freeQty: number
  rate: number
  discount: number
  schemeId: string | null
  // Task 41: scheme snapshot — line create/update par OrderItem par persist hota hai
  schemeType: string | null
  schemeValue: number | null
  schemeBuyQty: number | null
  schemeFreeQty: number | null
  schemeName: string | null
  // Task 45: GST + Trade Offer snapshot (OrderItem par persist)
  tradeOfferAmt: number
  gstRate: number | null
  gstAmt: number
  lineTotal: number
  /** Task 52: manual (order-level) discount ka is line ka hissa (pro-rata by net).
   * lineTotal = gross − discount − manualShare (merged net) — order.total ka EXACT column total.
   * Pass On column = discount + manualShare (bill par scheme + manual dono dikhte hain). */
  manualShare: number
}

export interface CalcResult {
  lines: CalcLine[]
  subtotal: number
  schemeDiscount: number
  /** Task 45: Σ line GST (purchase invoice ka taxTotal jaisa) */
  gstTotal: number
  /** Task 45: Σ line trade offer (purchase invoice ka tradeOfferTotal jaisa) */
  tradeOfferTotal: number
}

/**
 * Task 45: Grand payable — goods net (total) − trade offer + GST + advance tax.
 * Purchase invoice ke "Net Invoice Amount" jaisa hi chain. Old orders (fields 0)
 * par yehi total + advTax deta hai — backward compatible.
 */
export function orderGrandPayable(o: { total: number; tradeOfferTotal?: number | null; gstTotal?: number | null; advanceTax?: number | null }): number {
  return Math.round((o.total - (o.tradeOfferTotal ?? 0) + (o.gstTotal ?? 0) + (o.advanceTax ?? 0)) * 100) / 100
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
  /** Task 55: outlet ka filer status — filerScope wali schemes sirf matching outlets par */
  outletFilerStatus?: string | null,
): CalcResult {
  let subtotal = 0
  let schemeDiscount = 0
  let gstTotal = 0
  let tradeOfferTotal = 0
  const lines: CalcLine[] = []
  // Task 52: manual merge is function ke BAAD hota hai (manual order-level hai, lines ke baad)
  const manualShare = 0

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

    // Task 41: booked scheme snapshot (existing line) current schemes se pehle
    // check hota hai — sirf IS line ke booking waqt ke values re-apply hote hain
    const snapshot: CalcScheme | null = item.scheme
      ? { id: item.scheme.id, name: item.scheme.name, type: item.scheme.type, channel: null, productId: null, value: Number(item.scheme.value) || 0, buyQty: Number(item.scheme.buyQty) || 0, freeQty: Number(item.scheme.freeQty) || 0 }
      : null

    const applicable = snapshot
      ? [snapshot]
      : schemes
          // Task 55: filters AND hain — product + channel + category (naam se) + filer scope.
          // Legacy scheme (sab null) har jagah match — purana behavior bilkul same.
          .filter((s) =>
            (!s.productId || s.productId === p.id)
            && (!s.channel || s.channel === channel)
            && (!s.categoryName || s.categoryName === (p.category ?? ''))
            && (!s.filerScope || s.filerScope === (outletFilerStatus ?? ''))
          )
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

    const applied = schemeId ? applicable.find((s) => s.id === schemeId) ?? null : null

    // ---- Task 45: GST (purchase invoice jaisa chain) ----
    // GST base = line net (gross − scheme discount) — trade offer/manual discount base NAHI
    // badalte (purchase invoice: GST net excl. tax par, TO baad me minus). Rate snapshot:
    // existing line apna booked rate rakhti hai, nayi line product ke current rate se.
    // gstEnabled=false product par GST 0 — rate Products page se aata hai, hardcoded nahi.
    const gross = Math.round(ratePerPc * qty * 100) / 100
    const gstRate = item.bookedGstRate != null
      ? Math.max(0, Number(item.bookedGstRate) || 0)
      : (p.gstEnabled === false ? 0 : Math.max(0, Number(p.gstRate) || 0))
    const netExclTax = Math.max(0, gross - discount)
    const gstAmt = Math.round(netExclTax * (gstRate / 100) * 100) / 100

    // ---- Task 45: Trade Offer (per-SKU Rs, discount ke ilawa) ----
    const tradeOfferAmt = Math.max(0, Math.round((Number(item.tradeOffer) || 0) * 100) / 100)

    const lineTotal = gross - discount
    subtotal += gross
    schemeDiscount += discount
    gstTotal += gstAmt
    tradeOfferTotal += tradeOfferAmt
    lines.push({
      productId: p.id, qty, freeQty, rate: ratePerPc, discount, schemeId,
      schemeType: applied?.type ?? null,
      schemeValue: applied?.value ?? null,
      schemeBuyQty: applied?.buyQty ?? null,
      schemeFreeQty: applied?.freeQty ?? null,
      schemeName: applied?.name ?? null,
      tradeOfferAmt,
      gstRate: gstRate > 0 ? gstRate : null,
      gstAmt,
      lineTotal,
      manualShare,
    })
  }

  return {
    lines,
    subtotal: Math.round(subtotal * 100) / 100,
    schemeDiscount: Math.round(schemeDiscount * 100) / 100,
    gstTotal: Math.round(gstTotal * 100) / 100,
    tradeOfferTotal: Math.round(tradeOfferTotal * 100) / 100,
  }
}

/**
 * Task 52: manual (order-level) discount ko lines mein pro-rata TORE karne ke lie
 * pure helper — har line ka share uske NET (gross − scheme discount) ke weight se.
 * NET-weight isliye taake jo line pehle hi scheme se kam ho gayi wo extra na uthaye,
 * aur merged net kabhi negative na ho (share <= net guarantee).
 * Σ shares EXACTLY manual ke barabar (aakhri line rounding kha jati hai, clamp +
 * redistribution edge cases bhi handle) — order.total ka column total kabhi nahi toota.
 */
export function splitManualByNet(nets: number[], manual: number): number[] {
  const n = nets.length
  const shares = new Array<number>(n).fill(0)
  if (!(manual > 0) || n === 0) return shares
  const capped = Math.min(Math.round(manual * 100) / 100, Math.round(nets.reduce((s, v) => s + Math.max(0, v), 0) * 100) / 100)
  if (capped <= 0) return shares
  const netAll = Math.round(nets.reduce((s, v) => s + Math.max(0, v), 0) * 100) / 100
  let left = capped
  for (let i = 0; i < n - 1; i++) {
    const net = Math.max(0, nets[i])
    const share = Math.min(net, Math.round(capped * (net / netAll) * 100) / 100)
    shares[i] = share
    left = Math.round((left - share) * 100) / 100
  }
  shares[n - 1] = Math.min(Math.max(0, nets[n - 1]), Math.max(0, left))
  // Edge: clamp/redistribution ne manual poora nahi tora to bacha hua headroom wali
  // lines mein daal do (deterministic index order — chhota data, cheap)
  let residual = Math.round((capped - shares.reduce((s, v) => s + v, 0)) * 100) / 100
  for (let i = 0; residual > 0 && i < n; i++) {
    const head = Math.round((Math.max(0, nets[i]) - shares[i]) * 100) / 100
    const add = Math.min(head, residual)
    if (add > 0) {
      shares[i] = Math.round((shares[i] + add) * 100) / 100
      residual = Math.round((residual - add) * 100) / 100
    }
  }
  return shares
}

/**
 * Task 52: MANUAL DISCOUNT = PASS ON MERGE.
 * Manual (order-level) discount lines mein pro-rata (by net) tor kar har line par
 * lagao: manualShare persist + lineTotal merged net + GST naye net par recompute.
 * Isse bill ke Pass On column ka total == Promotions Applied ka Total Discount,
 * Net column ka total == order.total, aur Sales Tax = Net × rate (real invoice rule).
 * Returns merged Σ gstAmt (routes isi ko gstTotal ke tor par persist karte hain).
 * Mutates lines in-place. manual <= 0 par koi asar nahi (legacy orders safe).
 */
export function applyManualMerge(lines: CalcLine[], manualDiscount: number): number {
  if (!(manualDiscount > 0) || lines.length === 0) {
    return Math.round(lines.reduce((s, l) => s + l.gstAmt, 0) * 100) / 100
  }
  const shares = splitManualByNet(lines.map((l) => l.lineTotal), manualDiscount)
  lines.forEach((l, i) => {
    l.manualShare = shares[i]
    l.lineTotal = Math.round(Math.max(0, l.lineTotal - shares[i]) * 100) / 100
    l.gstAmt = l.gstRate && l.gstRate > 0
      ? Math.round(l.lineTotal * (l.gstRate / 100) * 100) / 100
      : 0
  })
  return Math.round(lines.reduce((s, l) => s + l.gstAmt, 0) * 100) / 100
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
