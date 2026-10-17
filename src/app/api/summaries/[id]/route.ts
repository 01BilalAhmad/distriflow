import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/** GET /api/summaries/[id] — full detail: invoices, product load summary, settlements */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: {
        salesman: { select: { id: true, name: true } },
        warehouse: { select: { name: true } },
        distributor: { select: { businessName: true } },
        orders: {
          include: {
            outlet: { select: { id: true, name: true, code: true, channel: true, address: true, ownerName: true } },
            items: { include: { product: { select: { id: true, name: true, sku: true, unitsPerCarton: true, boxesPerCarton: true, pcsPerBox: true, consumerPrice: true, brand: { select: { name: true } } } }, scheme: { select: { name: true } } } },
            settlements: { select: { id: true } },
          },
          orderBy: { orderNo: 'asc' },
        },
        settlements: { include: { outlet: { select: { name: true } } } },
      },
    })
    if (!summary) return jsonError('Summary not found', 404)

    // Product-wise load summary across all invoices (what the delivery man pulls from warehouse)
    const prodMap = new Map<string, { productId: string; sku: string; name: string; brand: string; unitsPerCarton: number; boxesPerCarton: number; pcsPerBox: number; qty: number; freeQty: number; rate: number; amount: number }>()
    for (const o of summary.orders) {
      for (const it of o.items) {
        const key = it.productId
        const cur = prodMap.get(key) ?? {
          productId: key, sku: it.product.sku, name: it.product.name,
          brand: it.product.brand?.name ?? '', unitsPerCarton: it.product.unitsPerCarton,
          boxesPerCarton: it.product.boxesPerCarton, pcsPerBox: it.product.pcsPerBox,
          qty: 0, freeQty: 0, rate: it.rate, amount: 0,
        }
        cur.qty += it.qty
        cur.freeQty += it.freeQty
        cur.amount += it.lineTotal
        prodMap.set(key, cur)
      }
    }
    const products = [...prodMap.values()].sort((a, b) => b.amount - a.amount)

    // Returns linked to these invoices (settlement-time stock returns)
    const orderIds = summary.orders.map((o) => o.id)
    const returns = orderIds.length > 0 ? await db.saleReturn.findMany({
      where: { orderId: { in: orderIds } },
      include: { items: { include: { product: { select: { name: true, unitsPerCarton: true, pcsPerBox: true } } } } },
      orderBy: { createdAt: 'asc' },
    }) : []
    const returnsByOrder = new Map<string, typeof returns>()
    for (const r of returns) {
      if (!r.orderId) continue
      const list = returnsByOrder.get(r.orderId) ?? []
      list.push(r)
      returnsByOrder.set(r.orderId, list)
    }

    return Response.json({
      summary: {
        id: summary.id,
        summaryNo: summary.summaryNo,
        salesmanId: summary.salesman.id,
        salesmanName: summary.salesman.name,
        distributorName: summary.distributor.businessName,
        warehouseName: summary.warehouse.name,
        orderDate: new Date(summary.orderDate).toISOString(),
        deliveryDate: new Date(summary.deliveryDate).toISOString(),
        status: summary.status,
        subtotal: summary.subtotal,
        settledCash: summary.settledCash,
        settledCredit: summary.settledCredit,
        settledReturns: summary.settledReturns,
        settledAt: summary.settledAt ? new Date(summary.settledAt).toISOString() : null,
        settledByName: summary.settledByName,
        notes: summary.notes,
        products: products.map((p) => ({ ...p, amount: Math.round(p.amount) })),
        orders: summary.orders.map((o) => ({
          id: o.id,
          orderNo: o.orderNo,
          outletId: o.outlet.id,
          outletName: o.outlet.name,
          outletCode: o.outlet.code,
          channel: o.outlet.channel,
          address: o.outlet.address,
          ownerName: o.outlet.ownerName,
          total: o.total,
          tradeOfferTotal: o.tradeOfferTotal,
          gstTotal: o.gstTotal,
          filerStatus: o.filerStatus,
          advanceTaxRate: o.advanceTaxRate,
          advanceTax: o.advanceTax,
          status: o.status,
          orderDate: new Date(o.orderDate).toISOString(),
          settled: o.settlements.length > 0,
          items: o.items.map((it) => ({
            id: it.id,
            productId: it.productId,
            productName: it.product.name,
            sku: it.product.sku,
            unitsPerCarton: it.product.unitsPerCarton,
            boxesPerCarton: it.product.boxesPerCarton,
            pcsPerBox: it.product.pcsPerBox,
            consumerPrice: it.product.consumerPrice,
            qty: it.qty,
            freeQty: it.freeQty,
            rate: it.rate,
            discount: it.discount,
            lineTotal: it.lineTotal,
            schemeName: it.scheme?.name ?? null,
          })),
          returns: (returnsByOrder.get(o.id) ?? []).map((r) => ({
            id: r.id, // Task 64: cancel/undo ke liye
            returnNo: r.returnNo,
            type: r.type,
            status: r.status,
            totalValue: r.totalValue,
            reason: r.reason,
            createdAt: new Date(r.createdAt).toISOString(),
            items: r.items.map((ri) => ({ productId: ri.productId, productName: ri.product.name, qty: ri.qty, rate: ri.rate, value: ri.value, unitsPerCarton: ri.product.unitsPerCarton, pcsPerBox: ri.product.pcsPerBox })),
          })),
        })),
        settlements: summary.settlements.map((st) => ({
          id: st.id,
          orderId: st.orderId,
          outletName: st.outlet.name,
          billAmount: st.billAmount,
          returnAmount: st.returnAmount,
          advanceTax: st.advanceTax,
          gstTotal: st.gstTotal, // Task 80: settlement sheet Net Payable = bill − ret + GST − TO + tax
          tradeOfferTotal: st.tradeOfferTotal,
          cashAmount: st.cashAmount,
          creditAmount: st.creditAmount,
          status: st.status,
          notes: st.notes,
        })),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Summary detail failed', 500)
  }
}

/** PATCH /api/summaries/[id] — edit delivery date (only while UNSETTLED) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { deliveryDate?: string; notes?: string }

    const summary = await db.deliverySummary.findUnique({ where: { id } })
    if (!summary) return jsonError('Summary not found', 404)
    if (summary.status !== 'UNSETTLED') return jsonError('Settled summary edit nahi ho sakti')

    const data: { deliveryDate?: Date; notes?: string } = {}
    if (body.deliveryDate) {
      const d = new Date(body.deliveryDate)
      if (isNaN(d.getTime())) return jsonError('Delivery date invalid hai')
      data.deliveryDate = d
    }
    if (body.notes !== undefined) data.notes = body.notes

    const updated = await db.deliverySummary.update({ where: { id }, data })
    return Response.json({ summary: { id: updated.id, deliveryDate: new Date(updated.deliveryDate).toISOString() } })
  } catch (e) {
    console.error(e)
    return jsonError('Summary update failed', 500)
  }
}
