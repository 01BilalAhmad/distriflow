import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { computeOrderLines, recalcManualDiscount, applyManualMerge, orderGrandPayable, type CalcIncomingItem } from '@/lib/dms-order-calc'
import { advanceTaxFor, getTaxRates } from '@/lib/dms-settings'
import { getAvailableToPromise, groupQtyByProduct, oversellMessage } from '@/lib/dms-inventory'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const status = searchParams.get('status')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: userId }
        : { distributorId: user.profile?.id }

    const orders = await db.order.findMany({
      where: status && status !== 'ALL' ? { ...where, status } : where,
      include: {
        outlet: { select: { name: true, code: true } },
        salesman: { select: { name: true } },
        distributor: { select: { businessName: true } },
        items: { include: { product: { select: { unitsPerCarton: true } } } },
      },
      orderBy: { orderDate: 'desc' },
      take: 100,
    })

    return Response.json({
      orders: orders.map((o) => ({
        id: o.id,
        orderNo: o.orderNo,
        outletName: o.outlet.name,
        outletCode: o.outlet.code,
        channel: o.channel,
        salesmanName: o.salesman?.name ?? null,
        distributorName: o.distributor.businessName,
        status: o.status,
        subtotal: o.subtotal,
        schemeDiscount: o.schemeDiscount,
        manualDiscount: o.manualDiscount,
        manualDiscType: o.manualDiscType,
        manualDiscValue: o.manualDiscValue,
        total: o.total,
        // Task 45: GST + Trade Order totals (grand payable = total − TO + GST + advTax)
        tradeOfferTotal: o.tradeOfferTotal,
        gstTotal: o.gstTotal,
        filerStatus: o.filerStatus,
        advanceTaxRate: o.advanceTaxRate,
        advanceTax: o.advanceTax,
        orderDate: new Date(o.orderDate).toISOString(),
        itemCount: o.items.length,
        // Salesflo-style "Quantity in Cases" = Σ(qty pcs / units-per-carton) — mixed packs included
        totalCases: Math.round(o.items.reduce((s, it) => s + (it.qty / Math.max(1, it.product.unitsPerCarton)), 0) * 10000) / 10000,
        totalFreePcs: o.items.reduce((s, it) => s + it.freeQty, 0),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Orders load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { outletId, salesmanId, items, notes } = body as {
      outletId: string; salesmanId?: string; items: CalcIncomingItem[]; notes?: string
      discount?: { type: 'PERCENT' | 'FLAT'; value: number } | null
    }
    if (!outletId || !items || items.length === 0) return jsonError('Outlet aur kam az kam 1 item required hai')

    const outlet = await db.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) return jsonError('Outlet not found', 404)

    // Task 23: tenant = jis distributor ki shop hai — products/schemes/tax SIRF usi tenant ke
    const tenantId = outlet.distributorId

    const productIds = items.map((i) => i.productId)
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: tenantId } })
    // Task 55: category-wide scheme — category ka NAME join kar ke CalcScheme mein daala
    const schemesRaw = await db.scheme.findMany({
      where: { isActive: true, distributorId: tenantId, OR: [{ endDate: null }, { endDate: { gte: new Date() } }] },
      include: { category: { select: { name: true } } },
    })
    const schemes = schemesRaw.map((s) => ({ ...s, categoryName: s.category?.name ?? null }))

    // Shared calc (stock-allocation edit bhi yehi math use karta hai)
    // Task 45: items[].tradeOffer = per-SKU Trade Offer Rs (discount ke ilawa, kuch SKUs par)
    // Task 55: outlet filer status — filerScope wali schemes sirf matching shops par
    const { lines: itemsData, subtotal, schemeDiscount, tradeOfferTotal } = computeOrderLines(products, schemes, items, outlet.channel, outlet.filerStatus)

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

    const seq = await nextSeq('order')

    // ---- Advance Tax — shop ke filer status + DISTRIBUTOR ke apne settings rate par snapshot (bill par add) ----
    const orderTotal = Math.round((subtotal - schemeDiscount - manualDiscount) * 100) / 100
    const rates = await getTaxRates(tenantId)
    const tax = advanceTaxFor(orderTotal, outlet.filerStatus, rates)

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
        filerStatus: outlet.filerStatus,
        advanceTaxRate: tax.rate,
        advanceTax: tax.amount,
        notes: notes ?? null,
        items: { create: itemsData },
      },
      include: { items: true },
    })

    const payable = orderGrandPayable({ total: orderTotal, tradeOfferTotal, gstTotal, advanceTax: order.advanceTax })

    return Response.json({
      order: {
        id: order.id, orderNo: order.orderNo, total: order.total,
        schemeDiscount, manualDiscount,
        tradeOfferTotal, gstTotal,
        advanceTax: order.advanceTax, advanceTaxRate: order.advanceTaxRate,
        filerStatus: order.filerStatus,
        payable,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Order create failed', 500)
  }
}
