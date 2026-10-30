import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { fulfillOrder } from '@/lib/dms-fulfill'
import { computeOrderLines, recalcManualDiscount, applyManualMerge, orderGrandPayable, type CalcIncomingItem } from '@/lib/dms-order-calc'
import { advanceTaxFor, getTaxRates, getDistributorAddress } from '@/lib/dms-settings'
import { getAvailableToPromise } from '@/lib/dms-inventory'
import { liveRecalcOrder } from '@/lib/dms-live-recalc'
import { ensureOutletBalance, computeAdvanceProjection } from '@/lib/dms-credit'

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const order = await db.order.findUnique({
      where: { id },
      include: {
        outlet: true,
        salesman: { select: { id: true, name: true } },
        distributor: { select: { businessName: true, city: true, user: { select: { phone: true } } } },
        summary: { select: { summaryNo: true, deliveryDate: true } },
        items: { include: { product: { select: { name: true, sku: true, unitsPerCarton: true, boxesPerCarton: true, pcsPerBox: true, consumerPrice: true, gstEnabled: true, gstRate: true } }, scheme: { select: { name: true } } } },
        deliveries: { include: { items: true } },
      },
    })
    if (!order) return jsonError('Order not found', 404)
    // Task 95: tenant ownership — order usi distributor ka hona chahiye
    const tm = await tenantMismatch(user, order.distributorId)
    if (tm) return tm
    // Task 78b: bill print header par Address (AppSetting KV — settings page se, zero migration)
    const distributorAddress = await getDistributorAddress(order.distributorId)

    // ---- Task 86: LIVE SCHEME RECALC (unprocessed bill detail) ----
    // CONFIRMED bill kholte hi CURRENT schemes se re-evaluate — backend scheme update
    // foran nazar aata hai. Processed bills stored frozen values par hi rehti hain.
    const live = order.status === 'CONFIRMED' ? await liveRecalcOrder(order.id) : null
    const liveById = new Map((live?.items ?? []).map((it) => [it.id, it]))

    return Response.json({
      order: {
        id: order.id,
        orderNo: order.orderNo,
        outlet: { name: order.outlet.name, code: order.outlet.code, channel: order.outlet.channel, address: order.outlet.address, ownerName: order.outlet.ownerName, phone: order.outlet.phone, ntn: order.outlet.ntn, cnic: order.outlet.cnic },
        salesmanName: order.salesman?.name ?? null,
        distributorName: order.distributor.businessName,
        distributorCity: order.distributor.city,
        // Task 78: bill print header par Cell No — settings page se manage hota hai
        distributorPhone: order.distributor.user?.phone ?? null,
        // Task 78b: Name → Address → Cell No (bill header ka naya order)
        distributorAddress,
        summaryNo: order.summary?.summaryNo ?? null,
        summaryDeliveryDate: order.summary ? new Date(order.summary.deliveryDate).toISOString() : null,
        status: order.status,
        // Task 26: tax-mode snapshot — print Mode-A ladder isi se (CLAIM/INVOICE_DISCOUNT/MIXED)
        taxMode: order.taxMode,
        // Task 86: CONFIRMED par LIVE totals (current schemes) — processed frozen stored
        subtotal: live?.subtotal ?? order.subtotal,
        schemeDiscount: live?.schemeDiscount ?? order.schemeDiscount,
        manualDiscount: live?.manualDiscount ?? order.manualDiscount,
        manualDiscType: order.manualDiscType,
        manualDiscValue: order.manualDiscValue,
        total: live?.total ?? order.total,
        tradeOfferTotal: live?.tradeOfferTotal ?? order.tradeOfferTotal,
        gstTotal: live?.gstTotal ?? order.gstTotal,
        filerStatus: live?.filerStatus ?? order.filerStatus,
        advanceTaxRate: live?.advanceTaxRate ?? order.advanceTaxRate,
        advanceTax: live?.advanceTax ?? order.advanceTax,
        payable: live?.payable ?? orderGrandPayable(order),
        // Task 102: invoice account snapshot — print/dialog par Previous Balance +
        // Advance Adjust (chhoti detail ke sath) + Grand Net Total isi se aata hai
        prevBalance: order.prevBalance,
        advanceApplied: order.advanceApplied,
        advanceAppliedNote: order.advanceAppliedNote,
        notes: order.notes,
        orderDate: new Date(order.orderDate).toISOString(),
        // Task 112: fully-cut (qty=0) lines detail/print mein nahi — cut ka matlab cut
        items: order.items.filter((it) => it.qty > 0).map((it) => {
          // Task 86: CONFIRMED par live item values (naya scheme stack/discount/free qty)
          const lv = liveById.get(it.id)
          return {
          id: it.id,
          productId: it.productId,
          productName: it.product.name,
          sku: it.product.sku,
          unitsPerCarton: it.product.unitsPerCarton,
          boxesPerCarton: it.product.boxesPerCarton,
          pcsPerBox: it.product.pcsPerBox,
          consumerPrice: it.product.consumerPrice,
          // Task 37: per-product GST flag — Task 45 snapshot rate neeche gstRate me merge hua
          gstEnabled: it.product.gstEnabled,
          qty: it.qty,
          freeQty: lv?.freeQty ?? it.freeQty,
          rate: it.rate,
          discount: lv?.discount ?? it.discount,
          lineTotal: lv?.lineTotal ?? it.lineTotal,
          // Task 45: booking waqt ke GST + Trade Order snapshots (edit-proof)
          tradeOfferAmt: it.tradeOfferAmt,
          gstRate: it.gstRate ?? it.product.gstRate, // snapshot, legacy line par product ka current rate
          gstAmt: lv?.gstAmt ?? it.gstAmt,
          // Task 52: manual discount ka is line ka hissa (Pass On column mein merge)
          manualShare: lv?.manualShare ?? it.manualShare,
          schemeId: lv?.schemeId ?? it.schemeId,
          // Task 41→86: CONFIRMED par LIVE scheme values — processed par frozen snapshot
          schemeType: lv?.schemeType ?? it.schemeType,
          schemeValue: lv?.schemeValue ?? it.schemeValue,
          schemeBuyQty: lv?.schemeBuyQty ?? it.schemeBuyQty,
          schemeFreeQty: lv?.schemeFreeQty ?? it.schemeFreeQty,
          // snapshot naam prefer — scheme rename ho to bhi purana bill sahi
          schemeName: lv?.schemeName ?? it.schemeName ?? it.scheme?.name ?? null,
          // Task 57: poora frozen stack + per-scheme amounts (bill/print/detail breakdown)
          schemeStack: ((lv?.schemeStack ?? it.schemeStack) ?? null) as import('@/lib/dms-types').SchemeStackRow[] | null,
          }
        }),
        deliveries: order.deliveries.map((d) => ({
          id: d.id,
          deliveryNo: d.deliveryNo,
          status: d.status,
          date: new Date(d.date).toISOString(),
          items: d.items.map((di) => ({ productId: di.productId, qty: di.qty })),
        })),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Order detail failed', 500)
  }
}

/** Deliver order (full) with FEFO stock deduction, or cancel */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const body = await req.json()
    const { action } = body

    const order = await db.order.findUnique({ where: { id }, include: { items: true } })
    if (!order) return jsonError('Order not found', 404)
    // Task 95: tenant ownership — order usi distributor ka hona chahiye
    const tm = await tenantMismatch(user, order.distributorId)
    if (tm) return tm

    if (action === 'CANCEL') {
      const updated = await db.order.update({ where: { id }, data: { status: 'CANCELLED' } })
      // Task 35: ORDER_CANCEL — bill cancel ka record
      await audit(
        { id: user.id, name: user.name, role: user.role, tenantId: order.distributorId },
        'ORDER_CANCEL',
        { req, entity: 'Order', entityId: id, detail: `${order.orderNo} — ${order.channel} bill CANCEL hua` },
      )
      return Response.json({ order: { id: updated.id, status: updated.status } })
    }

    // ---- Stock Allocation edit (Salesflo-style "Change Stock Allocation") ----
    // PREVIEW_ITEMS: wahi calc jo UPDATE_ITEMS par hoga — sirf preview, kuch save nahi.
    // UPDATE_ITEMS: items replace (delete/update/create) + totals + manual discount re-cap.
    // Sirf CONFIRMED (unprocessed) bills editable hain — summary ban chuki ho to FEFO
    // deduction ho chuka hai, wahan edit allowed NAHI.
    if (action === 'PREVIEW_ITEMS' || action === 'UPDATE_ITEMS') {
      if (order.status !== 'CONFIRMED') {
        return jsonError(`Bill ${order.orderNo} edit nahi ho sakta (status: ${order.status}) — sirf unprocessed bills editable hain`)
      }
      const incomingRaw = (body.items ?? []) as CalcIncomingItem[]
      if (!Array.isArray(incomingRaw)) return jsonError('Items list invalid hai')

      // ---- Task 86: LIVE SCHEME RECALC (edit dialog bhi live hai) ----
      // Pehle (Task 41): existing lines par BOOKED scheme snapshot attach hota tha —
      // backend scheme update ka unprocessed bill par asar nahi hota tha. Ab user rule:
      // unprocessed bill par scheme REAL TIME change ho — isliye incoming items par se
      // koi scheme/schemeStack snapshot STRIP kar di jati hai → computeOrderLines ka
      // Task 58 full-stack path CURRENT schemes se stack banata hai.
      // Rate (Task 17), GST-rate (Task 45) aur Trade Offer snapshots neeche wale block
      // mein ab bhi attach hote hain — sirf SCHEME live hai, rate frozen hai.
      const incoming = incomingRaw.map(({ scheme: _s, schemeStack: _st, ...rest }) => rest)

      // Task 45: TO + GST-rate snapshots bhi wahi scheme principle — purani line apni
      // BOOKED trade offer aur GST rate rakhti hai (product/scheme baad me badle to asar nahi)
      const existingByProduct = new Map(order.items.map((i) => [i.productId, i]))
      const withSnapshots = incoming.map((i) => {
        const ex = existingByProduct.get(i.productId)
        if (!ex) return i
        return {
          ...i,
          tradeOffer: ex.tradeOfferAmt > 0 ? ex.tradeOfferAmt : (i.tradeOffer ?? 0),
          bookedGstRate: ex.gstRate ?? undefined,
        }
      })

      // Task 23: tenant scope — order jis distributor ka, products/schemes usi ke
      const tenantId = order.distributorId
      // Task 26: company taxMode bhi chahiye (per-line GST base rule)
      const products = await db.product.findMany({
        where: { isActive: true, distributorId: tenantId, OR: [{ id: { in: incoming.map((i) => i.productId) } }, { id: { in: order.items.map((i) => i.productId) } }] },
        include: { company: { select: { taxMode: true } } },
      })
      const calcProducts = products.map((p) => ({ ...p, taxMode: p.company?.taxMode ?? 'CLAIM' }))
      // Task 55: category-wide scheme — category NAME join, aur outlet ke filer status se
      // filerScope match. Order ka BOOKED filer status pehle (snapshot rule), legacy (null)
      // par outlet ka current status.
      const schemesRaw = await db.scheme.findMany({
        where: { isActive: true, distributorId: tenantId, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
        include: { category: { select: { name: true } } },
      })
      const schemes = schemesRaw.map((s) => ({ ...s, categoryName: s.category?.name ?? null }))
      const outletFiler = order.filerStatus
        ?? (await db.outlet.findUnique({ where: { id: order.outletId }, select: { filerStatus: true } }))?.filerStatus
        ?? null
      const { lines, subtotal, schemeDiscount, tradeOfferTotal } = computeOrderLines(calcProducts, schemes, withSnapshots, order.channel, outletFiler)
      if (lines.length === 0) return jsonError('At least 1 item with quantity is required')

      // ---- Task 112: stock-allocation edit par stock block NAHI ----
      // Over-booked edit allowed — kami process par Process Anyway pop-up handle karta hai
      // (pehle Task 26 ka hard reject tha — admin bhi over-stock qty save nahi kar sakta tha).

      const manual = recalcManualDiscount(order.manualDiscType, order.manualDiscValue, subtotal, schemeDiscount)
      const total = Math.round((subtotal - schemeDiscount - manual.manualDiscount) * 100) / 100

      // ---- Task 52: MANUAL DISCOUNT = PASS ON MERGE (POST jaisa hi math) ----
      // Manual lines mein pro-rata merge → Pass On total == Total Discount, Net == total,
      // GST merged net par. Trade Offer merged net se validate (UPDATE par block).
      const gstTotal = applyManualMerge(lines, manual.manualDiscount)
      const pName = new Map(products.map((p) => [p.id, p.name]))
      for (const l of lines) {
        if (action === 'UPDATE_ITEMS' && l.tradeOfferAmt > l.lineTotal) {
          return jsonError(`Trade offer galat hai — ${pName.get(l.productId) ?? 'Item'}: Rs ${l.tradeOfferAmt} line total Rs ${l.lineTotal} se zyada nahi ho sakta (discount ke baad)`)
        }
      }

      // Advance Tax: order ka SNAPSHOT rate preserve hota hai (booking waqt ka),
      // sirf amount naye total par recompute. Purana order (rate null) ho to
      // outlet ke CURRENT filer status + current settings se fresh compute.
      // Task 76 (Option A): base = Net − Trade Offer + GST (purchase invoice jaisa) —
      // POST route ke sath SAME math, PREVIEW aur booking preview exact match.
      let taxRate = order.advanceTaxRate
      let taxStatus = order.filerStatus
      const advBase = Math.max(0, Math.round((total - tradeOfferTotal + gstTotal) * 100) / 100)
      if (taxRate == null || taxStatus == null) {
        const outletFresh = await db.outlet.findUnique({ where: { id: order.outletId }, select: { filerStatus: true } })
        const ratesNow = await getTaxRates(tenantId)
        taxStatus = outletFresh?.filerStatus ?? 'NON_FILER'
        taxRate = advanceTaxFor(advBase, taxStatus, ratesNow).rate
      }
      const tax = advanceTaxFor(advBase, taxStatus, { filer: taxRate, nonFiler: taxRate })

      if (action === 'PREVIEW_ITEMS') {
        // Task 112: available stock ab SIRF editor information ke liye (edit par block nahi hota)
        const atp = await getAvailableToPromise(tenantId, lines.map((l) => l.productId), id)
        return Response.json({
          preview: {
            subtotal, schemeDiscount,
            manualDiscount: manual.manualDiscount,
            total,
            tradeOfferTotal,
            gstTotal,
            payable: orderGrandPayable({ total, tradeOfferTotal, gstTotal, advanceTax: tax.amount }),
            advanceTax: tax.amount,
            advanceTaxRate: tax.rate,
            filerStatus: taxStatus,
            lines: lines.map((l) => {
              const p = products.find((x) => x.id === l.productId)!
              return { ...l, unitsPerCarton: p.unitsPerCarton, pcsPerBox: p.pcsPerBox, availablePcs: Math.max(0, atp.get(l.productId)?.available ?? 0) }
            }),
          },
        })
      }

      // UPDATE_ITEMS — transaction: purani lines delete, nayi compute lines recreate
      // (rate current product rate se refresh, scheme dobara apply, free qty dobara)
      await db.$transaction(async (tx) => {
        await tx.orderItem.deleteMany({ where: { orderId: id } })
        await tx.orderItem.createMany({
          // Task 26: CalcLine.taxMode calc-chain field hai — OrderItem column NAHI, strip
          data: lines.map(({ taxMode: _tm, ...l }) => ({ orderId: id, ...l })),
        })
        await tx.order.update({
          where: { id },
          data: {
            subtotal,
            schemeDiscount,
            manualDiscount: manual.manualDiscount,
            manualDiscType: manual.manualDiscType,
            manualDiscValue: manual.manualDiscValue,
            total,
            tradeOfferTotal,
            gstTotal,
            // Task 26: tax-mode snapshot bhi naye lines ke modes se refresh
            taxMode: new Set(lines.map((l) => l.taxMode ?? 'CLAIM')).size === 1
              ? ([...new Set(lines.map((l) => l.taxMode ?? 'CLAIM'))][0])
              : 'MIXED',
            filerStatus: taxStatus,
            advanceTaxRate: tax.rate,
            advanceTax: tax.amount,
          },
        })
      })

      // Task 102: bill EDIT par account snapshot bhi refresh — naya payable par advance
      // projection dobara (purana claim khud exclude, dusri unsettled bills ka claim minus)
      const newPayable = orderGrandPayable({ total, tradeOfferTotal, gstTotal, advanceTax: tax.amount })
      const prevBalanceNow = Math.max(0, await ensureOutletBalance(order.outletId))
      const projection2 = await computeAdvanceProjection(order.outletId, newPayable, id)
      await db.order.update({
        where: { id },
        data: {
          prevBalance: prevBalanceNow,
          advanceApplied: projection2.applied,
          advanceAppliedNote: projection2.note,
        },
      })

      const fresh = await db.order.findUnique({
        where: { id },
        include: {
          items: { include: { product: { select: { unitsPerCarton: true } } } },
        },
      })
      const items2 = fresh?.items ?? []
      // Task 35: ORDER_EDIT — stock allocation / items replace ka record
      await audit(
        { id: user.id, name: user.name, role: user.role, tenantId: order.distributorId },
        'ORDER_EDIT',
        { req, entity: 'Order', entityId: id, detail: `${order.orderNo} items edit — ${items2.length} lines, new total Rs ${total}` },
      )
      return Response.json({
        order: {
          id, orderNo: order.orderNo,
          subtotal, schemeDiscount,
          manualDiscount: manual.manualDiscount,
          manualDiscType: manual.manualDiscType,
          manualDiscValue: manual.manualDiscValue,
          total,
          tradeOfferTotal,
          gstTotal,
          payable: orderGrandPayable({ total, tradeOfferTotal, gstTotal, advanceTax: tax.amount }),
          advanceTax: tax.amount,
          advanceTaxRate: tax.rate,
          filerStatus: taxStatus,
          prevBalance: prevBalanceNow,
          advanceApplied: projection2.applied,
          advanceAppliedNote: projection2.note,
          grandNetTotal: Math.max(0, Math.round((newPayable + prevBalanceNow - projection2.applied) * 100) / 100),
          itemCount: items2.length,
          totalCases: Math.round(items2.reduce((s, it) => s + (it.qty / Math.max(1, it.product.unitsPerCarton)), 0) * 10000) / 10000,
          totalFreePcs: items2.reduce((s, it) => s + it.freeQty, 0),
        },
      })
    }

    if (action === 'DELIVER') {
      if (order.status === 'DELIVERED') return jsonError('Order already delivered hai')
      if (order.status === 'CANCELLED') return jsonError('Cancelled order deliver nahi ho sakta')

      const { delivery } = await fulfillOrder(order.id)
      await db.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } })
      // Task 35: ORDER_DELIVER — seed delivery ka record
      await audit(
        { id: user.id, name: user.name, role: user.role, tenantId: order.distributorId },
        'ORDER_DELIVER',
        { req, entity: 'Order', entityId: order.id, detail: `${order.orderNo} DELIVERED — challan ${delivery.deliveryNo}` },
      )
      return Response.json({ delivery: { id: delivery.id, deliveryNo: delivery.deliveryNo }, orderStatus: 'DELIVERED' })
    }

    return jsonError('Unknown action')
  } catch (e) {
    console.error(e)
    return jsonError('Order action failed', 500)
  }
}
