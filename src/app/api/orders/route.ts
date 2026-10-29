import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { computeOrderLines, recalcManualDiscount, applyManualMerge, orderGrandPayable, type CalcIncomingItem } from '@/lib/dms-order-calc'
import { advanceTaxFor, getTaxRates } from '@/lib/dms-settings'
import { ensureOutletBalance, computeAdvanceProjection, creditStatus } from '@/lib/dms-credit'
import { getAvailableToPromise, groupQtyByProduct, oversellMessage } from '@/lib/dms-inventory'
import { getPjpSettings, karachiDayCode, karachiDayBounds, outletInTodayRoute } from '@/lib/dms-pjp'
import { loadActiveSchemes, liveRecalcFromParts, type LiveRecalcOrderParts } from '@/lib/dms-live-recalc'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: user.id }
        : { distributorId: user.profile?.id }

    // Task 82: booker ko sirf AAJ ka data — purane bills server se hi filter (client filter ke ilawa)
    // Distributor/admin ko poori history milti hai
    const scope =
      user.role === 'SALESMAN'
        ? { ...where, orderDate: { gte: karachiDayBounds().start, lt: karachiDayBounds().end } }
        // Task 85: PENDING (booker-tagged) shop ke orders admin ko main lists mein NAHI dikhte —
        // approve hone par auto-appear (New Shops page se approve karo)
        : { ...where, outlet: { status: 'APPROVED' } }

    const orders = await db.order.findMany({
      where: status && status !== 'ALL' ? { ...scope, status } : scope,
      include: {
        outlet: { select: { name: true, code: true, status: true } },
        salesman: { select: { name: true } },
        distributor: { select: { businessName: true } },
        // Task 86: live scheme recalc ke liye product ka pack/GST/category data bhi chahiye
        // (Product.category string column hai — relation nahi)
        // Task 26: company taxMode bhi (per-line GST base rule — live recalc booked jaisa)
        items: { include: { product: { select: { unitsPerCarton: true, pcsPerBox: true, tradePrice: true, gstEnabled: true, gstRate: true, category: true, company: { select: { taxMode: true } } } } } },
      },
      orderBy: { orderDate: 'desc' },
      take: 100,
    })

    // ---- Task 86: LIVE SCHEME RECALC (unprocessed bills) ----
    // CONFIRMED bill apne FROZEN snapshot par nahi — CURRENT schemes par dikhegi.
    // Backend scheme update karo → list refresh par unprocessed bill ka discount/promotion
    // naya ho jayega. Processed bills untouched (frozen). Schemes per-distributor cache.
    // Distinct distributors jinki CONFIRMED bills hain → schemes ek dafa load
    const schemesCache = new Map<string, Awaited<ReturnType<typeof loadActiveSchemes>>>()
    const distIds = [...new Set(orders.filter((o) => o.status === 'CONFIRMED').map((o) => o.distributorId))]
    for (const d of distIds) schemesCache.set(d, await loadActiveSchemes(d))
    const liveMap = new Map<string, ReturnType<typeof liveRecalcFromParts>>()
    for (const o of orders) {
      if (o.status !== 'CONFIRMED') continue
      const schemes = schemesCache.get(o.distributorId)!
      const parts: LiveRecalcOrderParts = {
        channel: o.channel,
        filerStatus: o.filerStatus,
        manualDiscType: o.manualDiscType,
        manualDiscValue: o.manualDiscValue,
        items: o.items.map((it) => ({
          id: it.id, productId: it.productId, qty: it.qty, rate: it.rate,
          tradeOfferAmt: it.tradeOfferAmt, gstRate: it.gstRate,
          // Task 26: company taxMode CalcProduct shape mein resolve
          product: { ...it.product, taxMode: it.product.company?.taxMode ?? 'CLAIM' },
        })),
      }
      const live = liveRecalcFromParts(parts, schemes)
      if (live) liveMap.set(o.id, live)
    }

    return Response.json({
      orders: orders.map((o) => {
        // Task 86: CONFIRMED bill par LIVE totals (current schemes) — stale/product-deleted par stored
        const live = liveMap.get(o.id)
        const subtotal = live?.subtotal ?? o.subtotal
        const schemeDiscount = live?.schemeDiscount ?? o.schemeDiscount
        const manualDiscount = live?.manualDiscount ?? o.manualDiscount
        const total = live?.total ?? o.total
        const tradeOfferTotal = live?.tradeOfferTotal ?? o.tradeOfferTotal
        const gstTotal = live?.gstTotal ?? o.gstTotal
        return {
        id: o.id,
        orderNo: o.orderNo,
        outletName: o.outlet.name,
        outletCode: o.outlet.code,
        outletStatus: o.outlet.status, // Task 85: PENDING SHOP badge (booker apni tag ki shop ke bills)
        channel: o.channel,
        salesmanName: o.salesman?.name ?? null,
        distributorName: o.distributor.businessName,
        status: o.status,
        subtotal,
        schemeDiscount,
        manualDiscount,
        manualDiscType: o.manualDiscType,
        manualDiscValue: o.manualDiscValue,
        total,
        // Task 45: GST + Trade Order totals (grand payable = total − TO + GST + advTax)
        tradeOfferTotal,
        gstTotal,
        filerStatus: o.filerStatus,
        advanceTaxRate: o.advanceTaxRate,
        advanceTax: o.advanceTax,
        orderDate: new Date(o.orderDate).toISOString(),
        // Task 82: out-of-route badge (booker app Orders tab)
        unplanned: o.unplanned,
        orderLat: o.orderLat,
        orderLng: o.orderLng,
        itemCount: o.items.length,
        // Salesflo-style "Quantity in Cases" = Σ(qty pcs / units-per-carton) — mixed packs included
        totalCases: Math.round(o.items.reduce((s, it) => s + (it.qty / Math.max(1, it.product.unitsPerCarton)), 0) * 10000) / 10000,
        // Task 86: live free pcs (nayi scheme ke mutabiq) — stale par stored
        totalFreePcs: live ? live.totalFreePcs : o.items.reduce((s, it) => s + it.freeQty, 0),
        // Task 86: live recalc laga? (UI debug/badge ke liye)
        liveRecalc: !!live,
        }
      }),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Orders load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se. salesmanId DATA param rehta hai — distributor kisi
    // booker ke liye book kar sakta hai; acting scope neeche outlet ke tenant se check hota hai.
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { outletId, salesmanId, items, notes } = body as {
      outletId: string; salesmanId?: string; items: CalcIncomingItem[]; notes?: string
      discount?: { type: 'PERCENT' | 'FLAT'; value: number } | null
      // Task 82: booker app flags — GPS lazmi + unplanned gate (sirf fromBooker=true par lagta hai,
      // distributor web form is se mutasar nahi hota)
      fromBooker?: boolean
      lat?: number
      lng?: number
      unplanned?: boolean
      // Task 85: offline sync idempotency — mobile/booker app ka temp id
      clientRef?: string
    }
    if (!outletId || !items || items.length === 0) return jsonError('Outlet aur kam az kam 1 item required hai')

    // Task 85: IDEMPOTENT SYNC — same clientRef dobara aaye to wahi order wapas (duplicate bill nahi banta).
    // Offline app crash/retry ke baad double-upload safe.
    const clientRef = (body.clientRef ?? '').trim()
    if (clientRef) {
      const existing = await db.order.findUnique({ where: { clientRef } })
      if (existing) {
        return Response.json({ order: { id: existing.id, orderNo: existing.orderNo, total: existing.total, duplicate: true, unplanned: existing.unplanned } })
      }
    }

    const outlet = await db.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) return jsonError('Outlet not found', 404)

    // Task 95: tenant ownership — order sirf usi distributor tenant ke member book kar sakta hai
    // (SALESMAN assigned + PJP-planned shops dono, DISTRIBUTOR apni shops, cross-tenant 403)
    const tm = await tenantMismatch(user, outlet.distributorId)
    if (tm) return tm

    // Task 23: tenant = jis distributor ki shop hai — products/schemes/tax SIRF usi tenant ke
    const tenantId = outlet.distributorId

    // ---- Task 82: BOOKER ORDER GATES (GPS lazmi + unplanned/Jumma rules) ----
    // Task 85: PENDING shop (booker ne khud tag ki) par route/Jumma gates NAHI — wo route mein hoti
    // hi nahi; GPS phir bhi lazmi. Order approve hone tak admin lists mein chhupa rahega.
    const isPendingShop = outlet.status === 'PENDING'
    let isUnplanned = false
    let orderLat: number | null = null
    let orderLng: number | null = null
    if (body.fromBooker === true) {
      const latN = Number(body.lat)
      const lngN = Number(body.lng)
      if (!Number.isFinite(latN) || !Number.isFinite(lngN) || Math.abs(latN) > 90 || Math.abs(lngN) > 180) {
        return jsonError('GPS capture lazmi hai — location ke bagair order create nahi ho sakta. Location ON kar ke dobara koshish karein')
      }
      orderLat = latN
      orderLng = lngN

      if (isPendingShop) {
        // Booker ki apni tagged shop — bill ban sakta hai, admin approval ke baad show hoga
      } else {
        const pjp = await getPjpSettings(tenantId)
        const dayCode = karachiDayCode()
        const bookerId = salesmanId ?? outlet.salesmanId ?? ''
        const inRoute = bookerId ? outletInTodayRoute(outlet, bookerId, dayCode) : false
        if (!inRoute) {
          // Out-of-route shop — sirf tab jab admin ne Unplanned ON rakha ho
          if (!pjp.unplannedEnabled) {
            return jsonError('Unplanned orders admin ne OFF kar diye hain — ye shop aaj ki route mein nahi hai', 403)
          }
          isUnplanned = true
        } else if (dayCode === 'FRI' && pjp.fridayOff) {
          // Jumma OFF — planned route bilkul band, sirf unplanned allowed
          return jsonError('Aaj Jumma OFF hai — planned shops par order nahi ho sakta, sirf unplanned shops se order bana sakte hain', 403)
        }
      }
    }

    const productIds = items.map((i) => i.productId)
    // Task 26: company ka taxMode bhi chahiye (per-line GST base rule) — company include
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: tenantId }, include: { company: { select: { taxMode: true } } } })
    // CalcProduct shape: product ke company se taxMode resolve (default CLAIM — legacy safe)
    const calcProducts = products.map((p) => ({ ...p, taxMode: p.company?.taxMode ?? 'CLAIM' }))
    // Task 55: category-wide scheme — category ka NAME join kar ke CalcScheme mein daala
    const schemesRaw = await db.scheme.findMany({
      where: { isActive: true, distributorId: tenantId, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      include: { category: { select: { name: true } } },
    })
    const schemes = schemesRaw.map((s) => ({ ...s, categoryName: s.category?.name ?? null }))

    // Shared calc (stock-allocation edit bhi yehi math use karta hai)
    // Task 45: items[].tradeOffer = per-SKU Trade Offer Rs (discount ke ilawa, kuch SKUs par)
    // Task 55: outlet filer status — filerScope wali schemes sirf matching shops par
    const { lines: itemsData, subtotal, schemeDiscount, tradeOfferTotal } = computeOrderLines(calcProducts, schemes, items, outlet.channel, outlet.filerStatus)

    if (itemsData.length === 0) return jsonError('Koi valid item nahi mila')

    // ---- Task 45: Trade Offer validation — har line ka TO uski net value se zyada nahi ----
    // (warna line payable negative ho jati — typo pakarne ke liye clear error)
    const pName = new Map(products.map((p) => [p.id, p.name]))
    for (const l of itemsData) {
      if (l.tradeOfferAmt > l.lineTotal) {
        return jsonError(`Trade offer galat hai — ${pName.get(l.productId) ?? 'Item'}: Rs ${l.tradeOfferAmt} line total Rs ${l.lineTotal} se zyada nahi ho sakta`)
      }
    }

    // ---- Task 26: STOCK LIMIT — overselling band ----
    // Available = warehouse stock − pehle se CONFIRMED (unprocessed) bills ki booked qty.
    // Isi liye 1 ctn stock par 3 bills × 1 ctn nahi ban sakte — pehli bill ke baad available 0.
    const atp = await getAvailableToPromise(tenantId, itemsData.map((l) => l.productId))
    const demand = groupQtyByProduct(itemsData)
    const over = [...demand.entries()]
      .filter(([productId, qty]) => qty > (atp.get(productId)?.available ?? 0))
      .map(([productId, qty]) => ({ productId, qty }))
    if (over.length > 0) {
      const names = new Map(products.map((p) => [p.id, p.name]))
      const upcOf = (pid: string) => Math.max(1, products.find((p) => p.id === pid)?.unitsPerCarton ?? 1)
      return jsonError(`Stock limit crossed — ${oversellMessage(over, atp, names, upcOf)}`)
    }

    // ---- Manual discount (order-level, scheme ke ilawa) ----
    // PERCENT: subtotal ka % | FLAT: seedha Rs. Total kabhi negative nahi ho sakta.
    let manualDiscount = 0
    let manualDiscType: 'PERCENT' | 'FLAT' | null = null
    let manualDiscValue: number | null = null
    if (body.discount && (body.discount.type === 'PERCENT' || body.discount.type === 'FLAT')) {
      const v = Number(body.discount.value)
      if (!Number.isFinite(v) || v <= 0) return jsonError('Discount value 0 se bara hona chahiye')
      if (body.discount.type === 'PERCENT' && v > 100) return jsonError('Percent discount 100% se zyada nahi ho sakta')
      const r = recalcManualDiscount(body.discount.type, v, subtotal, schemeDiscount)
      manualDiscount = r.manualDiscount
      manualDiscType = r.manualDiscType as 'PERCENT' | 'FLAT' | null
      manualDiscValue = r.manualDiscValue
    }

    // ---- Task 52: MANUAL DISCOUNT = PASS ON MERGE ----
    // Manual ko lines mein pro-rata (by net) tor kar har line par lagao —
    // bill ke Pass On column ka total == Promotions Applied ka Total Discount,
    // Net column ka total == order.total, aur GST naye (merged) net par.
    // Trade Offer ab merged net se validate hota hai (line payable kabhi negative nahi).
    const gstTotal = applyManualMerge(itemsData, manualDiscount)
    for (const l of itemsData) {
      if (l.tradeOfferAmt > l.lineTotal) {
        return jsonError(`Trade offer galat hai — ${pName.get(l.productId) ?? 'Item'}: Rs ${l.tradeOfferAmt} line total Rs ${l.lineTotal} se zyada nahi ho sakta (discount ke baad)`)
      }
    }

    // ---- Task 26: ORDER TAX-MODE SNAPSHOT ----
    // Items ke distinct modes: single-mode order = wo mode, mixed = MIXED. Print/labels
    // isi se — company ka mode baad me badle to purane bill ki presentation waisi hi rahe.
    const modeSet = new Set(itemsData.map((l) => l.taxMode ?? 'CLAIM'))
    const orderTaxMode = modeSet.size === 1 ? [...modeSet][0] : 'MIXED'

    const seq = await nextSeq('order')

    // ---- Advance Tax — shop ke filer status + DISTRIBUTOR ke apne settings rate par snapshot (bill par add) ----
    // Task 76 (Option A — user confirm): base ab purchase invoice jaisa — Net (goods) − Trade Offer + GST.
    // Pehle sirf goods net par lagta tha, isliye purchase (Net+GST base) vs order (Net base) mein
    // per-ctn 20-40 Rs ka farq aata tha. Ab dono invoices ka tax mechanism SAME:
    // farq = GST × advRate purchase aur order par barabar. Purane orders ke snapshots
    // (total/advanceTax) waise hi rahenge — sirf naye bookings naye base par.
    const orderTotal = Math.round((subtotal - schemeDiscount - manualDiscount) * 100) / 100
    const rates = await getTaxRates(tenantId)
    const advBase = Math.max(0, Math.round((orderTotal - tradeOfferTotal + gstTotal) * 100) / 100)
    const tax = advanceTaxFor(advBase, outlet.filerStatus, rates)

    // ---- Task 102: INVOICE ACCOUNT SNAPSHOT (bill bante hi "auto detect") ----
    // payable pehle compute — prevBalance (shop ka purana udhaar) + return advance
    // projection (FIFO, dusri unsettled bills ka claim minus) ORDER PAR freeze hoti hai.
    // Print par foran "Previous Balance" + "Advance Adjust" + "Grand Net Total" dikhega.
    // LEDGER SAFE: sirf likhi jati hai — actual kaato settlement par hota hai (no-minus).
    const payable = orderGrandPayable({ total: orderTotal, tradeOfferTotal, gstTotal, advanceTax: tax.amount })
    const currentBalance = await ensureOutletBalance(outlet.id)
    const prevBalance = Math.max(0, currentBalance)
    const projection = await computeAdvanceProjection(outlet.id, payable)

    const order = await db.order.create({
      data: {
        orderNo: `ORD-${seq}`,
        outletId: outlet.id,
        salesmanId: salesmanId || outlet.salesmanId,
        distributorId: outlet.distributorId,
        channel: outlet.channel,
        status: 'CONFIRMED',
        subtotal,
        schemeDiscount,
        manualDiscount,
        manualDiscType,
        manualDiscValue,
        total: orderTotal,
        tradeOfferTotal,
        gstTotal,
        taxMode: orderTaxMode,
        filerStatus: outlet.filerStatus,
        advanceTaxRate: tax.rate,
        advanceTax: tax.amount,
        prevBalance,
        advanceApplied: projection.applied,
        advanceAppliedNote: projection.note,
        orderLat,
        orderLng,
        unplanned: isUnplanned,
        clientRef: clientRef || null,
        notes: notes ?? null,
        // Task 26: CalcLine.taxMode calc-chain ka field hai — OrderItem par column NAHI, strip
        items: { create: itemsData.map(({ taxMode: _tm, ...l }) => l) },
      },
      include: { items: true },
    })

    // ---- Task 98: CREDIT LIMIT WARNING (Finexa convention — block NAHI) ----
    // Shop ka running udhaar + ye bill (agar poora udhaar jaye = max exposure) limit ke
    // against: OK / NEAR (80%+) / OVER. Warning sirf UI badge ke liye — order bilkul
    // normal banta hai (creditLimit 0 = no limit).
    // Task 102: warning ADVANCE PROJECTION ke baad ke effective payable par — jo advance
    // is bill par lag raha hai wo shop ke haq mein kam hai (real exposure wahi hai).
    const effPayable = Math.max(0, Math.round((payable - projection.applied) * 100) / 100)
    const maxExposure = Math.max(0, Math.round((currentBalance + effPayable) * 100) / 100)
    const cs = creditStatus(maxExposure, outlet.creditLimit)
    const creditWarning = cs.status === 'NONE' ? null : {
      status: cs.status,
      pct: cs.pct,
      overBy: cs.overBy,
      currentBalance,
      creditLimit: outlet.creditLimit,
      maxExposure,
      message: cs.status === 'OVER'
        ? `Shop ka udhaar (is bill ke sath) limit se Rs ${cs.overBy.toFixed(2)} zyada hoga`
        : `Shop ka udhaar limit ke ${cs.pct.toFixed(0)}% par pohanch raha hai`,
    }

    return Response.json({
      order: {
        id: order.id, orderNo: order.orderNo, total: order.total,
        schemeDiscount, manualDiscount,
        tradeOfferTotal, gstTotal,
        advanceTax: order.advanceTax, advanceTaxRate: order.advanceTaxRate,
        filerStatus: order.filerStatus,
        unplanned: order.unplanned,
        payable,
        // Task 102: booking confirmation par bhi account snapshot — UI toast/detail isi se
        prevBalance,
        advanceApplied: projection.applied,
        advanceAppliedNote: projection.note,
        grandNetTotal: Math.max(0, Math.round((payable + prevBalance - projection.applied) * 100) / 100),
        creditWarning,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Order create failed', 500)
  }
}
