import { db } from '@/lib/db'
import {
  computeOrderLines, recalcManualDiscount, applyManualMerge, orderGrandPayable,
  type CalcIncomingItem, type CalcProduct, type CalcScheme, type CalcLine, type CalcSchemeSnapshot,
} from '@/lib/dms-order-calc'
import { advanceTaxFor, getTaxRates } from '@/lib/dms-settings'
import { ensureOutletBalance, computeAdvanceProjection } from '@/lib/dms-credit'

/**
 * Task 86 — LIVE SCHEME RECALC (unprocessed bills):
 * User rule — "unprocessed bill par scheme/promotion REAL TIME change ho; processed
 * bill par kabhi nahi; unprocess karke dobara process par NAYA scheme lage."
 *
 * Pehle (Task 41 snapshot): booking par scheme values OrderItem par freeze hoti thin —
 * backend scheme update ka unprocessed bill par bhi asar nahi hota tha. Ab:
 *   - CONFIRMED (unprocessed) bill = LIVE — jitni dafa dekho/preview/process karo,
 *     scheme CURRENT Scheme table se re-evaluate hoti hai (rate/GST-rate/trade-offer
 *     aur manual discount ka RULE booked snapshots par hi freeze rehte hain).
 *   - PROCESS par yahi recalc persist hota hai (snapshot refresh) — phir bill frozen.
 *   - UNPROCESS ke baad bill wapas CONFIRMED = wapas live zone (kuch karna nahi parta).
 *
 * Live engine = wahi computeOrderLines jo booking par chalta hai — FARQ sirf ye hai ke
 * incoming items par koi scheme/schemeStack snapshot attach NAHI hota (snapshot dete hi
 * calc frozen path par chala jata hai — Task 41/56). Snapshot ke bagair calc Task 58
 * full-stack path par CURRENT schemes se stack banata hai.
 */

/** Tenant ki ACTIVE schemes (booking route jaisa hi where) — CalcScheme shape mein */
export async function loadActiveSchemes(distributorId: string): Promise<CalcScheme[]> {
  const raw = await db.scheme.findMany({
    where: { isActive: true, distributorId, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
    include: { category: { select: { name: true } } },
  })
  return raw.map((s) => ({
    id: s.id, name: s.name, type: s.type, channel: s.channel, productId: s.productId,
    categoryName: s.category?.name ?? null, filerScope: s.filerScope ?? null,
    value: s.value, buyQty: s.buyQty, freeQty: s.freeQty,
  }))
}

/** Live recalc ke liye order ka minimal shape (list route preloaded objects pass karta hai) */
export interface LiveRecalcOrderParts {
  channel: string
  filerStatus: string | null
  manualDiscType: string | null
  manualDiscValue: number | null
  items: {
    id: string
    productId: string
    qty: number
    rate: number
    tradeOfferAmt: number
    gstRate: number | null
    product: {
      unitsPerCarton: number
      pcsPerBox: number
      tradePrice: number
      gstEnabled: boolean | null
      gstRate: number | null
      /** Product.category STRING column hai (relation nahi) — scheme category-match isi se */
      category?: string | null
      /** Task 109: RETAIL price/pc — RETAIL_GST (Cadbury) mode ka GST base isi se banta hai */
      consumerPrice?: number | null
      /** Task 26: company ka tax mode (product.company.taxMode) — per-line GST base rule */
      taxMode?: string | null
    }
  }[]
}

export interface LiveRecalcPart {
  subtotal: number
  schemeDiscount: number
  manualDiscount: number
  total: number
  tradeOfferTotal: number
  gstTotal: number
  totalFreePcs: number
  lines: CalcLine[]
}

/**
 * PURE live recalc — preloaded order parts + current schemes se.
 * null return = stale (product delete ho gaya / line map toot gaya) — caller STORED
 * values hi dikhaye (koi crash nahi, koi galat number nahi).
 * Rate freeze (Task 17): item.rate pass hota hai — line booked rate par re-price NAHI hoti.
 * GST-rate freeze (Task 45): item.gstRate bookedGstRate ke tor par pass hota hai.
 * Manual discount: RULE (type/value) booked wahi — amount naye subtotal par recompute
 * (FLAT = same Rs, PERCENT = same % naye subtotal par — user rule "waisy ka waisa").
 */
export function liveRecalcFromParts(
  order: LiveRecalcOrderParts,
  schemes: CalcScheme[],
): LiveRecalcPart | null {
  // Task 112: Process Anyway trim se qty=0 (fully-cut) lines aa sakti hain — recalc sirf
  // active (qty > 0) lines par chale, warna lines.length guard stale return karta rehta.
  const activeItems = order.items.filter((it) => it.qty > 0)
  const products: CalcProduct[] = activeItems.map((it) => ({
    id: it.productId,
    unitsPerCarton: it.product.unitsPerCarton,
    pcsPerBox: it.product.pcsPerBox,
    tradePrice: it.product.tradePrice,
    gstEnabled: it.product.gstEnabled ?? undefined,
    gstRate: it.product.gstRate ?? undefined,
    category: it.product.category ?? null,
    consumerPrice: it.product.consumerPrice ?? null,
    taxMode: it.product.taxMode ?? 'CLAIM',
  }))
  // LIVE PATH: koi scheme/schemeStack attach nahi — current schemes se full stack (Task 58)
  const incoming: CalcIncomingItem[] = activeItems.map((it) => ({
    productId: it.productId,
    qty: it.qty,
    rate: it.rate,
    tradeOffer: it.tradeOfferAmt,
    bookedGstRate: it.gstRate,
  }))
  const res = computeOrderLines(products, schemes, incoming, order.channel, order.filerStatus)
  if (res.lines.length !== activeItems.length) return null // stale — stored values rehne do

  const manual = recalcManualDiscount(order.manualDiscType, order.manualDiscValue, res.subtotal, res.schemeDiscount)
  const gstTotal = applyManualMerge(res.lines, manual.manualDiscount)
  const total = Math.round((res.subtotal - res.schemeDiscount - manual.manualDiscount) * 100) / 100
  return {
    subtotal: res.subtotal,
    schemeDiscount: res.schemeDiscount,
    manualDiscount: manual.manualDiscount,
    total,
    tradeOfferTotal: res.tradeOfferTotal,
    gstTotal,
    totalFreePcs: res.lines.reduce((s, l) => s + l.freeQty, 0),
    lines: res.lines,
  }
}

/** Per-item refresh payload (process route isse OrderItems persist karta hai) */
export interface LiveItemUpdate {
  id: string
  freeQty: number
  discount: number
  schemeId: string | null
  schemeType: string | null
  schemeValue: number | null
  schemeBuyQty: number | null
  schemeFreeQty: number | null
  schemeName: string | null
  schemeStack: CalcSchemeSnapshot[] | null
  gstAmt: number
  lineTotal: number
  manualShare: number
}

export interface LiveRecalcFull extends LiveRecalcPart {
  advanceTax: number
  advanceTaxRate: number
  filerStatus: string
  payable: number
  items: LiveItemUpdate[]
}

/**
 * FULL live recalc — order load + current schemes + advance tax (current settings).
 * Sirf CONFIRMED orders par call hona chahiye (processed frozen hai) — guard andar hai.
 */
export async function liveRecalcOrder(orderId: string): Promise<LiveRecalcFull | null> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      outlet: { select: { filerStatus: true } },
      // Task 26: company taxMode include — live recalc booked GST-base rule par chale
      items: { include: { product: { include: { company: { select: { taxMode: true } } } } } },
    },
  })
  if (!order || order.status !== 'CONFIRMED') return null

  const schemes = await loadActiveSchemes(order.distributorId)
  // Task 112: qty=0 (fully-cut) lines recalc se bahar — id mapping bhi isi filtered list par
  const activeItems = order.items.filter((it) => it.qty > 0)
  const part = liveRecalcFromParts(
    {
      channel: order.channel,
      filerStatus: order.filerStatus ?? order.outlet?.filerStatus ?? null,
      manualDiscType: order.manualDiscType,
      manualDiscValue: order.manualDiscValue,
      items: activeItems.map((it) => ({
        id: it.id, productId: it.productId, qty: it.qty, rate: it.rate,
        tradeOfferAmt: it.tradeOfferAmt, gstRate: it.gstRate,
        // Task 26: company taxMode CalcProduct shape mein resolve
        product: { ...it.product, taxMode: it.product.company?.taxMode ?? 'CLAIM' },
      })),
    },
    schemes,
  )
  if (!part) return null

  const filerStatus = order.filerStatus ?? order.outlet?.filerStatus ?? 'NON_FILER'
  const rates = await getTaxRates(order.distributorId)
  const advBase = Math.max(0, Math.round((part.total - part.tradeOfferTotal + part.gstTotal) * 100) / 100)
  const tax = advanceTaxFor(advBase, filerStatus, rates)
  return {
    ...part,
    advanceTax: tax.amount,
    advanceTaxRate: tax.rate,
    filerStatus,
    payable: orderGrandPayable({ total: part.total, tradeOfferTotal: part.tradeOfferTotal, gstTotal: part.gstTotal, advanceTax: tax.amount }),
    items: part.lines.map((l, i) => ({
      id: activeItems[i].id,
      freeQty: l.freeQty,
      discount: l.discount,
      schemeId: l.schemeId,
      schemeType: l.schemeType,
      schemeValue: l.schemeValue,
      schemeBuyQty: l.schemeBuyQty,
      schemeFreeQty: l.schemeFreeQty,
      schemeName: l.schemeName,
      schemeStack: (l.schemeStack ?? null) as CalcSchemeSnapshot[] | null,
      gstAmt: l.gstAmt,
      lineTotal: l.lineTotal,
      manualShare: l.manualShare,
    })),
  }
}

/**
 * Process route helper — live recalc PERSIST karo (order + items snapshot refresh)
 * aur in-memory order object bhi update kar do (summary.subtotal naye totals se bane).
 * Return: refresh ho gaya? (false = stale/failed — stored values par hi process hoga)
 */
export async function persistLiveRecalc(
  o: { id: string; status: string; subtotal: number; schemeDiscount: number; manualDiscount: number; total: number; tradeOfferTotal: number; gstTotal: number; filerStatus: string | null; advanceTaxRate: number | null; advanceTax: number },
): Promise<boolean> {
  const live = await liveRecalcOrder(o.id)
  if (!live) return false
  // Task 102: process-time refresh par invoice account snapshot bhi naye payable par
  // re-freeze (prevBalance current outstanding, advance projection FIFO dobara)
  const own = await db.order.findUnique({ where: { id: o.id }, select: { outletId: true } })
  let prevBalance = 0
  let advanceApplied = 0
  let advanceAppliedNote: string | null = null
  if (own) {
    prevBalance = Math.max(0, await ensureOutletBalance(own.outletId))
    const proj = await computeAdvanceProjection(own.outletId, live.payable, o.id)
    advanceApplied = proj.applied
    advanceAppliedNote = proj.note
  }
  await db.order.update({
    where: { id: o.id },
    data: {
      subtotal: live.subtotal,
      schemeDiscount: live.schemeDiscount,
      manualDiscount: live.manualDiscount,
      total: live.total,
      tradeOfferTotal: live.tradeOfferTotal,
      gstTotal: live.gstTotal,
      filerStatus: live.filerStatus,
      advanceTaxRate: live.advanceTaxRate,
      advanceTax: live.advanceTax,
      prevBalance,
      advanceApplied,
      advanceAppliedNote,
    },
  })
  for (const it of live.items) {
    await db.orderItem.update({
      where: { id: it.id },
      data: {
        freeQty: it.freeQty,
        discount: it.discount,
        schemeId: it.schemeId,
        schemeType: it.schemeType,
        schemeValue: it.schemeValue,
        schemeBuyQty: it.schemeBuyQty,
        schemeFreeQty: it.schemeFreeQty,
        schemeName: it.schemeName,
        schemeStack: (it.schemeStack ?? undefined) as never,
        gstAmt: it.gstAmt,
        lineTotal: it.lineTotal,
        manualShare: it.manualShare,
      },
    })
  }
  // in-memory sync — caller ka summary math naye totals par chale
  o.subtotal = live.subtotal
  o.schemeDiscount = live.schemeDiscount
  o.manualDiscount = live.manualDiscount
  o.total = live.total
  o.tradeOfferTotal = live.tradeOfferTotal
  o.gstTotal = live.gstTotal
  o.filerStatus = live.filerStatus
  o.advanceTaxRate = live.advanceTaxRate
  o.advanceTax = live.advanceTax
  return true
}
