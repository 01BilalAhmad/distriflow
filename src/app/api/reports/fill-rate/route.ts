import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, cityWhere, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 131 — FILL RATE REPORT (Order vs Delivery)
// Shop ne kitna MANGA vs kitna MILA — supply gap ka asli measure:
//   • Booked units  = OrderItem.qty (billed pcs; freeQty excluded)
//   • Delivered     = Σ Delivery.items.qty (order ki saari deliveries —
//                     PARTIAL redeliveries included)
//   • Fill %        = delivered ÷ booked (value + units dono par)
// Sections: product-wise gap (kaunsa SKU kam milta hai), order-wise list
// (perfect vs short), summary KPIs. Filters: date range, booker, city.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR') return jsonError('Reports sirf distributor account ke liye hain', 403)
    if (!user.profile) return jsonError('Distributor profile not found', 404)
    const profileId = user.profile.id
    const { from, to } = parseRange(url)
    const bookerId = url.searchParams.get('bookerId') || undefined
    const city = url.searchParams.get('city') || undefined

    const orders = await db.order.findMany({
      where: {
        distributorId: profileId, orderDate: { gte: from, lte: to }, status: { not: 'CANCELLED' },
        ...(bookerId ? { salesmanId: bookerId } : {}),
        outlet: cityWhere(city),
      },
      select: {
        id: true, orderNo: true, orderDate: true, total: true, status: true,
        salesman: { select: { name: true } },
        outlet: { select: { name: true, city: true } },
        items: { select: { productId: true, qty: true, freeQty: true, rate: true, product: { select: { name: true, sku: true, company: { select: { name: true } } } } } },
        deliveries: { select: { items: { select: { productId: true, qty: true } } } },
      },
      orderBy: { orderDate: 'desc' },
    })

    // ---- product-wise + order-wise aggregation ----
    type PRow = { productName: string; sku: string; company: string; orderedUnits: number; deliveredUnits: number; shortUnits: number; fillPct: number }
    const pAgg = new Map<string, PRow>()
    type ORow = { orderNo: string; date: string; shop: string; city: string; booker: string; bookedUnits: number; deliveredUnits: number; bookedValue: number; deliveredValue: number; fillPct: number; status: string }
    const orderRows: ORow[] = []

    let orderedUnitsAll = 0
    let deliveredUnitsAll = 0
    let bookedValueAll = 0
    let deliveredValueAll = 0
    let perfect = 0

    for (const o of orders) {
      // order ki saari deliveries ka product-wise qty
      const del = new Map<string, number>()
      for (const d of o.deliveries) for (const it of d.items) del.set(it.productId, (del.get(it.productId) ?? 0) + it.qty)

      let oBooked = 0
      let oDelivered = 0
      let oBookedVal = 0
      let oDelVal = 0
      for (const it of o.items) {
        const booked = it.qty
        const delivered = Math.min(del.get(it.productId) ?? 0, booked) // zyada deliver nahi maante (data ghalati)
        oBooked += booked
        oDelivered += delivered
        oBookedVal = r2(oBookedVal + booked * it.rate)
        oDelVal = r2(oDelVal + delivered * it.rate)

        const p = pAgg.get(it.productId) ?? { productName: it.product.name, sku: it.product.sku, company: it.product.company?.name ?? '—', orderedUnits: 0, deliveredUnits: 0, shortUnits: 0, fillPct: 0 }
        p.orderedUnits += booked
        p.deliveredUnits += delivered
        pAgg.set(it.productId, p)
      }
      const fillPct = oBooked > 0 ? r2((oDelivered / oBooked) * 100) : 100
      if (oBooked > 0 && oDelivered >= oBooked) perfect += 1
      orderedUnitsAll += oBooked
      deliveredUnitsAll += oDelivered
      bookedValueAll = r2(bookedValueAll + oBookedVal)
      deliveredValueAll = r2(deliveredValueAll + oDelVal)

      if (orderRows.length < 300) {
        orderRows.push({
          orderNo: o.orderNo, date: o.orderDate.toISOString(), shop: o.outlet.name, city: o.outlet.city,
          booker: o.salesman?.name ?? 'Counter/Web',
          bookedUnits: oBooked, deliveredUnits: oDelivered, bookedValue: oBookedVal, deliveredValue: oDelVal,
          fillPct, status: o.status,
        })
      }
    }

    const productRows = [...pAgg.values()]
      .map((p) => ({ ...p, shortUnits: Math.max(0, p.orderedUnits - p.deliveredUnits), fillPct: p.orderedUnits > 0 ? r2((p.deliveredUnits / p.orderedUnits) * 100) : 100 }))
      .sort((a, b) => a.fillPct - b.fillPct)

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, city: city ?? null },
      summary: {
        orders: orders.length,
        perfectOrders: perfect,
        orderedUnits: orderedUnitsAll,
        deliveredUnits: deliveredUnitsAll,
        fillPctUnits: orderedUnitsAll > 0 ? r2((deliveredUnitsAll / orderedUnitsAll) * 100) : 100,
        bookedValue: bookedValueAll,
        deliveredValue: deliveredValueAll,
        fillPctValue: bookedValueAll > 0 ? r2((deliveredValueAll / bookedValueAll) * 100) : 100,
        shortSkus: productRows.filter((p) => p.shortUnits > 0).length,
      },
      products: productRows,
      orders: orderRows,
    })
  } catch (e) {
    console.error('reports/fill-rate', e)
    return jsonError('Fill rate report fail — server error', 500)
  }
}
