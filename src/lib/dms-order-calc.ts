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
  /** Task 26: company ka TAX MODE (product.company.taxMode se aata hai) —
   * 'INVOICE_DISCOUNT' = Trade Offer pehle minus, GST (net − TO) par (Noms/SalesFlo style);
   * undefined/'CLAIM' = GST line net par, TO baad me minus (purana behaviour). */
  taxMode?: string | null
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
  /** Task 56: TIER STACK — stacked line ka poora frozen scheme list (OrderItem.schemeStack
   * se). Mojood ho to single `scheme` ke bajaye ISI list se re-apply hota hai. */
  schemeStack?: CalcSchemeSnapshot[] | null
  /** Task 45: per-SKU Trade Offer Rs (booking form se) — discount ke ILAWA, kuch SKUs par */
  tradeOffer?: number | null
  /** Task 45: existing line ka BOOKED GST rate snapshot (stock-allocation edit par
   * re-apply hota hai — product ka current rate purane bill par asar nahi dalta) */
  bookedGstRate?: number | null
}

/** Task 56: frozen scheme shape (OrderItem.schemeStack rows + CalcLine.schemeStack).
 * Type alias (interface nahi) — implicit index signature milta hai, Prisma InputJson
 * assignability ke liye zaroori.
 * Task 57: per-scheme attribution — `amount` = is line par IS scheme ka apna Rs
 * discount (money schemes), `freeQtyGiven` = is line par IS BxGy scheme ke free pcs.
 * Combined line.discount/freeQty inhi ka sum hai — Promotions Applied / previews
 * har scheme ko APNI alag row/column par dikhati hain (ek column mein ek promotion). */
export type CalcSchemeSnapshot = {
  id: string
  name?: string
  type: string
  value: number
  buyQty: number
  freeQty: number
  /** Task 57: is line par is scheme ka apna Rs contribution (BxGy par 0/absent) */
  amount?: number
  /** Task 57: is line par is BxGy scheme ke free pcs (money schemes par 0/absent) */
  freeQtyGiven?: number
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
  /** Task 56: TIER STACK — line par lagee SAB schemes (tier order: product > category >
   * all-products). Persist OrderItem.schemeStack par hota hai — edit par ISI se re-apply.
   * Single scheme line par bhi list length 1 persist hoti hai (uniform re-apply path). */
  schemeStack?: CalcSchemeSnapshot[]
  // Task 45: GST + Trade Offer snapshot (OrderItem par persist)
  tradeOfferAmt: number
  gstRate: number | null
  gstAmt: number
  lineTotal: number
  /** Task 26: is line ke company ka tax mode (GST base rule) — applyManualMerge isi se
   * merged net par dobara GST lagata hai. Persist NAHI hota (Order.taxMode snapshot
   * order-level par hai); sirf calc-chain ke liye. */
  taxMode?: string | null
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

    // Task 41: booked scheme snapshot (existing line) current schemes se pehle
    // check hota hai — sirf IS line ke booking waqt ke values re-apply hote hain
    const snapshot: CalcScheme | null = item.scheme
      ? { id: item.scheme.id, name: item.scheme.name, type: item.scheme.type, channel: null, productId: null, value: Number(item.scheme.value) || 0, buyQty: Number(item.scheme.buyQty) || 0, freeQty: Number(item.scheme.freeQty) || 0 }
      : null

    // ---- Task 58: FULL STACKING (user rule) ----
    // "Main jitny bhi promotions banata jaon, jo bill qualify karein wo SAB auto
    // lagin" — pehli column Eclair, doosri Khushhali, teesri agli (Task 56/57 spec).
    // Koi tier competition / best-wins NAHI: har scheme jo 4 AND filters (product +
    // channel + category + filerScope) pass kare wo stack hoti hai — e.g. KIRYANA
    // non-filer outlet par Eclair product 3% + Test 2% + Khushhali 2% = 7% (3 alag
    // rows). BxGy sirf qty qualify kare to; money schemes hamesha. Order:
    // product-tier pehle, phir category, phir blanket (specific → general; legacy
    // primary stack[0] = most specific). Legacy paths preserved: frozen-stack /
    // snapshot pehle, filter wale 4 AND-conditions waise hi.
    const tierOf = (s: CalcScheme) => (s.productId ? 0 : s.categoryName ? 1 : 2)
    const qualifiesBxGy = (s: CalcScheme) => s.type === 'BUY_X_GET_Y' && s.buyQty > 0 && ctnEquiv >= s.buyQty

    // Frozen stack (Task 56 edit path) — booking waqt ki poori list, isi tarteeb se
    // re-apply (BxGy dobara qualify karta hai, percent/flat hamesha)
    const frozenStack: CalcScheme[] | null = item.schemeStack?.length
      ? item.schemeStack.map((s) => ({ id: s.id, name: s.name, type: s.type, channel: null, productId: null, value: Number(s.value) || 0, buyQty: Number(s.buyQty) || 0, freeQty: Number(s.freeQty) || 0 }))
      : null

    const stack: CalcScheme[] = []
    if (frozenStack) {
      for (const s of frozenStack) {
        if (s.type === 'BUY_X_GET_Y') { if (qualifiesBxGy(s)) stack.push(s) } else stack.push(s)
      }
    } else if (snapshot) {
      // Legacy single-snapshot line — wahi purana behavior (BxGy qualify na kare to
      // line par koi scheme nahi, discount 0)
      if (snapshot.type === 'BUY_X_GET_Y') { if (qualifiesBxGy(snapshot)) stack.push(snapshot) } else stack.push(snapshot)
    } else {
      // Task 58: FULL STACK — jitni schemes bill qualify karein SAB lagti hain
      // (tier sirf ORDER ke liye: product > category > blanket; competition nahi)
      schemes
        .filter((s) =>
          (!s.productId || s.productId === p.id)
          && (!s.channel || s.channel === channel)
          && (!s.categoryName || s.categoryName === (p.category ?? ''))
          && (!s.filerScope || s.filerScope === (outletFilerStatus ?? ''))
        )
        .sort((a, b) => tierOf(a) - tierOf(b))
        .forEach((s) => {
          if (s.type === 'BUY_X_GET_Y') { if (qualifiesBxGy(s)) stack.push(s) }
          else stack.push(s)
        })
    }

    // Stack contributions: BxGy = free pcs, PERCENT = gross ka exact %, FLAT = per-ctn Rs.
    // Task 58 full stack: jitni schemes lagin unke percent/flat ADD hote hain
    // (3% + 2% + 2% = 7% of gross) — user mental model, har promotion apni row par.
    // Task 57: har scheme ka APNA contribution bhi record hota hai (amount / freeQtyGiven)
    // — persisted schemeStack row ke andar freeze hota hai taake bill + previews har
    // promotion ko alag row par apne amount ke sath dikhayen (combined totals inhi ka sum).
    let freeQty = 0
    let discount = 0
    const stackRows: CalcSchemeSnapshot[] = []
    for (const s of stack) {
      let amount = 0
      let freeGiven = 0
      if (qualifiesBxGy(s)) {
        freeGiven = Math.round(Math.floor(ctnEquiv / s.buyQty) * s.freeQty * upc)
        freeQty += freeGiven
      } else if (s.type === 'PERCENT_DISCOUNT') {
        amount = Math.round(ratePerPc * qty * (s.value / 100) * 100) / 100
        discount += amount
      } else if (s.type === 'FLAT_DISCOUNT') {
        amount = Math.round(s.value * ctnEquiv * 100) / 100
        discount += amount
      }
      stackRows.push({ id: s.id, name: s.name, type: s.type, value: s.value, buyQty: s.buyQty, freeQty: s.freeQty, ...(s.type === 'BUY_X_GET_Y' ? { freeQtyGiven: freeGiven } : { amount }) })
    }

    // Primary (single fields) = sab se SPECIFIC tier wali scheme (stack[0]) — legacy
    // readers (print, summaries) waisa hi chalte hain; schemeName combined dikhta hai
    const applied = stack[0] ?? null
    const schemeNameCombined = stack.length > 1
      ? stack.map((s) => s.name).filter(Boolean).join(' + ')
      : applied?.name ?? null

    // ---- Task 45: Trade Offer (per-SKU Rs, discount ke ilawa) ----
    // Task 26: Mode A (INVOICE_DISCOUNT) mein GST base ke andar jata hai — is liye
    // GST se PEHLE compute hota hai (Task 26 se pehle GST baad me tha, same result).
    const tradeOfferAmt = Math.max(0, Math.round((Number(item.tradeOffer) || 0) * 100) / 100)

    // ---- Task 45: GST (purchase invoice jaisa chain) ----
    // GST base = line net (gross − scheme discount) — trade offer/manual discount base NAHI
    // badalte (purchase invoice: GST net excl. tax par, TO baad me minus). Rate snapshot:
    // existing line apna booked rate rakhti hai, nayi line product ke current rate se.
    // gstEnabled=false product par GST 0 — rate Products page se aata hai, hardcoded nahi.
    // ---- Task 26: TAX MODE — company-level GST/Trade-Offer timing ----
    //   CLAIM (default): GST base = net (gross − scheme) — TO baad me minus (purana rule)
    //   INVOICE_DISCOUNT: TO pehle minus → GST base = (net − TO) — Noms/SalesFlo invoice
    //     jaisa ladder (Gross → Offers → Net → GST). Per-line hai kyunki TO bhi per-SKU hai:
    //     mixed order mein A-mode lines net−TO par, CLAIM lines net par GST lagti hai.
    //     Clamp 0: TO > net ho to line GST 0 (extra TO dusri lines ka base NAHI khatata).
    const gross = Math.round(ratePerPc * qty * 100) / 100
    const gstRate = item.bookedGstRate != null
      ? Math.max(0, Number(item.bookedGstRate) || 0)
      : (p.gstEnabled === false ? 0 : Math.max(0, Number(p.gstRate) || 0))
    const netExclTax = Math.max(0, gross - discount)
    const modeA = p.taxMode === 'INVOICE_DISCOUNT'
    const gstBase = modeA ? Math.max(0, netExclTax - tradeOfferAmt) : netExclTax
    const gstAmt = Math.round(gstBase * (gstRate / 100) * 100) / 100

    const lineTotal = gross - discount
    subtotal += gross
    schemeDiscount += discount
    gstTotal += gstAmt
    tradeOfferTotal += tradeOfferAmt
    lines.push({
      productId: p.id, qty, freeQty, rate: ratePerPc, discount,
      schemeId: applied?.id ?? null,
      schemeType: applied?.type ?? null,
      schemeValue: applied?.value ?? null,
      schemeBuyQty: applied?.buyQty ?? null,
      schemeFreeQty: applied?.freeQty ?? null,
      schemeName: schemeNameCombined,
      // Task 56: poora stack freeze hota hai (single line par length-1 list) — edit
      // par isi se re-apply, warna stacked discount ghatak kar bhi jata.
      // Task 57: rows mein per-scheme amount/freeQtyGiven bhi freeze (Promotions Applied
      // har scheme ki alag row print karta hai — combined name + combined amount nahi).
      schemeStack: stackRows.length ? stackRows : undefined,
      tradeOfferAmt,
      gstRate: gstRate > 0 ? gstRate : null,
      gstAmt,
      lineTotal,
      taxMode: modeA ? 'INVOICE_DISCOUNT' : 'CLAIM',
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
 * Task 57: Promotions Applied rows — HAR scheme apni ALAG row (ek column mein ek hi
 * promotion, combined nahi). Booked lines ke frozen schemeStack se per-scheme amount
 * (money) / free pcs (BxGy) aggregate karta hai. Print bill, order detail dialog aur
 * koi bhi "applied promotions" display ISI helper se chalta hai — sab jagah same rows.
 * Fallbacks (purane orders, koi migration nahi):
 *  - Task 56 stack rows bina amount → type/value + line qty/rate se same engine math recompute
 *  - pre-56 single-scheme lines (stack nahi) → schemeName + line.discount (purana behaviour)
 */
export interface SchemePromoRow {
  id: string
  name: string
  /** money schemes (PERCENT/FLAT) ka aggregate Rs contribution */
  amount: number
  /** BxGy schemes ke aggregate free pieces */
  freePcs: number
}

export function aggregateSchemePromos(
  items: {
    qty: number
    rate: number
    discount: number
    unitsPerCarton?: number
    schemeName?: string | null
    schemeStack?: CalcSchemeSnapshot[] | null
  }[],
): SchemePromoRow[] {
  const map = new Map<string, SchemePromoRow>()
  const touch = (key: string, name: string): SchemePromoRow => {
    let e = map.get(key)
    if (!e) { e = { id: key, name, amount: 0, freePcs: 0 }; map.set(key, e) }
    return e
  }
  for (const it of items) {
    const stack = Array.isArray(it.schemeStack) && it.schemeStack.length > 0 ? it.schemeStack : null
    if (stack) {
      const upc = it.unitsPerCarton && it.unitsPerCarton > 0 ? it.unitsPerCarton : 1
      const ctnEquiv = it.qty / upc
      for (const s of stack) {
        const e = touch(s.id || s.name || 'Trade Discount', s.name ?? 'Trade Discount')
        if (s.type === 'BUY_X_GET_Y') {
          e.freePcs += s.freeQtyGiven != null
            ? s.freeQtyGiven
            : Math.round(Math.floor(ctnEquiv / Math.max(1, s.buyQty)) * s.freeQty * upc)
        } else {
          const amt = s.amount != null
            ? s.amount
            : s.type === 'PERCENT_DISCOUNT'
              ? Math.round(it.rate * it.qty * (s.value / 100) * 100) / 100
              : Math.round(s.value * ctnEquiv * 100) / 100
          e.amount = Math.round((e.amount + amt) * 100) / 100
        }
      }
    } else if (it.discount > 0) {
      const name = it.schemeName ?? 'Trade Discount'
      const e = touch(name, name)
      e.amount = Math.round((e.amount + it.discount) * 100) / 100
    }
  }
  return [...map.values()].filter((e) => e.amount > 0 || e.freePcs > 0)
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
    // Task 26: GST recompute bhi tax-mode aware — INVOICE_DISCOUNT line ka base merged
    // net − TO hai (computeOrderLines jaisa hi rule, warna manual discount Mode A ka
    // GST base toor deta). Clamp 0 same.
    const base = l.taxMode === 'INVOICE_DISCOUNT'
      ? Math.max(0, l.lineTotal - Math.max(0, l.tradeOfferAmt))
      : l.lineTotal
    l.gstAmt = l.gstRate && l.gstRate > 0
      ? Math.round(base * (l.gstRate / 100) * 100) / 100
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

/* ==================== Task 108: PURCHASE LINE TAX CHAIN (company tax-mode aware) ====================
 * Purchase invoice ki per-line tax ladder — AB COMPANY KE TAX MODE KE MUTABIQ:
 *   CLAIM (default / Cadbury style):  GST poore net par, Trade Offer baad me minus
 *   INVOICE_DISCOUNT (Noms style):    Trade Offer pehle net se kaata → GST (net − TO) par
 * (Real Noms/SalesFlo bill se verified: net 5,366.61 × 18% = 965.99 — PDF row 1.)
 * Pure function — POST route + purchase entry preview dono isi se chalte hain (preview == booked bill). */

export interface PurchaseLineTaxInput {
  /** gross = trade price × cartons */
  gross: number
  /** Pass On discount Rs (gross ka % ya flat — UI se) */
  discAmt: number
  /** GST % snapshot (product rate ya line override) */
  gstRate: number
  /** Further Sales Tax % (invoice column) */
  furtherTaxPct: number
  /** Trade Offer Rs request (UI se) — cap lagega */
  tradeOfferRequest: number
  /** Advance Tax 236H % (invoice-level) */
  advanceTaxPct: number
  /** company ka tax mode — 'INVOICE_DISCOUNT' = Noms ladder, baqi sab CLAIM */
  taxMode?: string | null
}

export interface PurchaseLineTaxResult {
  netAmount: number
  salesTax: number
  furtherTaxPct: number
  furtherTax: number
  totalTax: number
  tradeOfferAmt: number
  advanceTax: number
  amountInclusive: number
}

const r2 = (v: number) => Math.round(v * 100) / 100

export function computePurchaseLineTaxes(i: PurchaseLineTaxInput): PurchaseLineTaxResult {
  const netAmount = r2(Math.max(0, i.gross - i.discAmt))
  const modeA = i.taxMode === 'INVOICE_DISCOUNT'
  const toReq = Math.max(0, r2(Number(i.tradeOfferRequest) || 0))
  const gstRate = Math.min(100, Math.max(0, Number(i.gstRate) || 0))
  const furtherTaxPct = Math.min(100, Math.max(0, Number(i.furtherTaxPct) || 0))
  // Task 108: GST base company ke tax mode se — INVOICE_DISCOUNT = net − Trade Offer (clamp 0)
  const gstBase = modeA ? Math.max(0, netAmount - toReq) : netAmount
  const salesTax = r2((gstBase * gstRate) / 100)
  const furtherTax = r2((gstBase * furtherTaxPct) / 100)
  const totalTax = r2(salesTax + furtherTax)
  // TO cap: INVOICE_DISCOUNT me TO GST se PEHLE kaata jata hai (net tak), CLAIM me net+tax tak
  const tradeOfferAmt = Math.min(modeA ? netAmount : r2(netAmount + totalTax), toReq)
  const advanceTax = r2(Math.max(0, netAmount + totalTax - tradeOfferAmt) * Math.min(100, Math.max(0, Number(i.advanceTaxPct) || 0)) / 100)
  const amountInclusive = r2(netAmount + totalTax - tradeOfferAmt + advanceTax)
  return { netAmount, salesTax, furtherTaxPct, furtherTax, totalTax, tradeOfferAmt, advanceTax, amountInclusive }
}
