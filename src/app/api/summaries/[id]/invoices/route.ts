import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/**
 * GET /api/summaries/[id]/invoices
 * Ek summary ki SAB invoices ka full print data ek hi call mein —
 * bulk "Print All Invoices" (har invoice apne A4 page par) ke liye.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: {
        salesman: { select: { id: true, name: true } },
        distributor: { select: { businessName: true, city: true } },
        orders: {
          include: {
            outlet: { select: { name: true, code: true, channel: true, address: true, ownerName: true, ntn: true, cnic: true } },
            items: { include: { product: { select: { name: true, sku: true, unitsPerCarton: true, boxesPerCarton: true, pcsPerBox: true, consumerPrice: true, gstEnabled: true, gstRate: true } }, scheme: { select: { name: true } } } },
          },
          orderBy: { orderNo: 'asc' },
        },
      },
    })
    if (!summary) return jsonError('Summary not found', 404)

    const invoices = summary.orders.map((o) => ({
      orderNo: o.orderNo,
      outlet: {
        name: o.outlet.name,
        code: o.outlet.code,
        channel: o.outlet.channel,
        address: o.outlet.address,
        ownerName: o.outlet.ownerName,
        ntn: o.outlet.ntn,
        cnic: o.outlet.cnic,
      },
      salesmanName: summary.salesman.name,
      distributorName: summary.distributor.businessName,
      distributorCity: summary.distributor.city,
      summaryNo: summary.summaryNo,
      status: o.status,
      subtotal: o.subtotal,
      schemeDiscount: o.schemeDiscount,
      manualDiscount: o.manualDiscount,
      manualDiscType: o.manualDiscType,
      manualDiscValue: o.manualDiscValue,
      total: o.total,
      advanceTax: o.advanceTax,
      advanceTaxRate: o.advanceTaxRate,
      filerStatus: o.filerStatus,
      orderDate: new Date(o.orderDate).toISOString(),
      items: o.items.map((it) => ({
        id: it.id,
        productName: it.product.name,
        sku: it.product.sku,
        unitsPerCarton: it.product.unitsPerCarton,
        boxesPerCarton: it.product.boxesPerCarton,
        pcsPerBox: it.product.pcsPerBox,
        consumerPrice: it.product.consumerPrice,
        // Task 37: per-product GST — bill isi rate se print hoga
        gstEnabled: it.product.gstEnabled,
        gstRate: it.product.gstRate,
        qty: it.qty,
        freeQty: it.freeQty,
        rate: it.rate,
        discount: it.discount,
        lineTotal: it.lineTotal,
        schemeName: it.scheme?.name ?? null,
      })),
    }))

    return Response.json({ summaryNo: summary.summaryNo, count: invoices.length, invoices })
  } catch (e) {
    console.error(e)
    return jsonError('Summary invoices load failed', 500)
  }
}
