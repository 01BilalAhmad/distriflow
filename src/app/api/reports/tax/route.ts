import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, parseRange, bookerList, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — TAX REPORT (Sales Tax + Advance Tax 236H)
// OUTPUT side (sales bills):
//   Taxable value per line = gstAmt ÷ (gstRate/100) — snapshot se derived,
//   EXACT (gstAmt booking waqt gstRate% × net excl. tax par saved hai).
//   gstRate 0/legacy lines par fallback = lineTotal − tradeOfferAmt.
//   WHT 236H = order.advanceTax (booking snapshot — filer 0.5% / non-filer 2.5%)
// Shop-wise breakdown + FILER/NON_FILER summary + per-order annex rows
// (FBR-style print ke liye).
// INPUT side (company purchase invoices) bhi — Net GST = Output − Input.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
    const { from, to } = parseRange(url)
    const bookerId = url.searchParams.get('bookerId') || undefined

    const orders = await db.order.findMany({
      where: {
        distributorId: profileId,
        orderDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        ...(bookerId ? { salesmanId: bookerId } : {}),
      },
      select: {
        id: true, orderNo: true, orderDate: true, total: true, tradeOfferTotal: true,
        gstTotal: true, advanceTax: true, advanceTaxRate: true, filerStatus: true, salesmanId: true,
        outlet: { select: { id: true, name: true, code: true, city: true, filerStatus: true, ntn: true, cnic: true } },
        items: { select: { lineTotal: true, tradeOfferAmt: true, gstAmt: true, gstRate: true } },
      },
      orderBy: { orderDate: 'asc' },
    })

    const bookerNames = new Map<string, string>()
    const sIds = [...new Set(orders.map((o) => o.salesmanId).filter(Boolean))] as string[]
    if (sIds.length) {
      const us = await db.user.findMany({ where: { id: { in: sIds } }, select: { id: true, name: true } })
      for (const u of us) bookerNames.set(u.id, u.name)
    }

    const taxableOf = (items: { lineTotal: number; tradeOfferAmt: number; gstAmt: number; gstRate: number | null }[]): number =>
      r2(items.reduce((t, it) => {
        const rate = Number(it.gstRate) || 0
        if (rate > 0 && it.gstAmt > 0) return t + it.gstAmt / (rate / 100) // exact snapshot base
        if (rate === 0) return t // GST-enabled nahi — base 0 (invoice par dash)
        return t + (it.lineTotal - it.tradeOfferAmt) // legacy gstAmt=0 with rate — fallback
      }, 0))

    type ShopAgg = { taxable: number; gst: number; wht: number; grand: number; orders: number }
    const shopAgg = new Map<string, ShopAgg & { name: string; code: string; city: string; filerStatus: string; ntn: string | null; cnic: string | null }>()
    const filerAgg = new Map<string, { taxable: number; gst: number; wht: number; orders: number; shops: Set<string> }>()
    const annex: { orderNo: string; date: string; shop: string; city: string; filerStatus: string; ntn: string | null; cnic: string | null; taxable: number; gst: number; wht: number; whtRate: number | null; grand: number }[] = []

    for (const o of orders) {
      const taxable = taxableOf(o.items)
      const gst = r2(o.gstTotal)
      const wht = r2(o.advanceTax)
      const grand = r2(o.total - o.tradeOfferTotal + o.gstTotal + o.advanceTax)
      const key = o.outlet.id
      const s = shopAgg.get(key) ?? {
        name: o.outlet.name, code: o.outlet.code, city: o.outlet.city,
        filerStatus: o.outlet.filerStatus, ntn: o.outlet.ntn, cnic: o.outlet.cnic,
        taxable: 0, gst: 0, wht: 0, grand: 0, orders: 0,
      }
      s.taxable = r2(s.taxable + taxable)
      s.gst = r2(s.gst + gst)
      s.wht = r2(s.wht + wht)
      s.grand = r2(s.grand + grand)
      s.orders += 1
      shopAgg.set(key, s)

      const f = filerAgg.get(o.outlet.filerStatus) ?? { taxable: 0, gst: 0, wht: 0, orders: 0, shops: new Set<string>() }
      f.taxable = r2(f.taxable + taxable)
      f.gst = r2(f.gst + gst)
      f.wht = r2(f.wht + wht)
      f.orders += 1
      f.shops.add(key)
      filerAgg.set(o.outlet.filerStatus, f)

      annex.push({
        orderNo: o.orderNo,
        date: o.orderDate.toISOString(),
        shop: o.outlet.name,
        city: o.outlet.city,
        filerStatus: o.outlet.filerStatus,
        ntn: o.outlet.ntn,
        cnic: o.outlet.cnic,
        taxable, gst, wht,
        whtRate: o.advanceTaxRate,
        grand,
      })
    }

    const shopWise = [...shopAgg.entries()]
      .map(([id, s]) => ({ outletId: id, ...s }))
      .sort((x, y) => y.taxable - x.taxable)

    const filerSummary = ['FILER', 'NON_FILER'].filter((k) => filerAgg.has(k)).map((k) => {
      const f = filerAgg.get(k)!
      return { filerStatus: k, taxable: f.taxable, gst: f.gst, wht: f.wht, orders: f.orders, shops: f.shops.size }
    })

    // ---- INPUT side: purchase invoices (period) ----
    const pInv = await db.purchaseInvoice.findMany({
      where: { distributorId: profileId, date: { gte: from, lte: to } },
      select: {
        invoiceNo: true, date: true, subtotal: true, discount: true, taxTotal: true, advanceTaxTotal: true, total: true,
        company: { select: { name: true } },
      },
      orderBy: { date: 'asc' },
    })
    const input = {
      invoices: pInv.length,
      netPurchase: r2(pInv.reduce((t, i) => t + (i.subtotal - i.discount), 0)),
      gst: r2(pInv.reduce((t, i) => t + i.taxTotal, 0)),
      wht: r2(pInv.reduce((t, i) => t + i.advanceTaxTotal, 0)),
      rows: pInv.map((i) => ({
        invoiceNo: i.invoiceNo,
        date: i.date.toISOString(),
        company: i.company.name,
        netPurchase: r2(i.subtotal - i.discount),
        gst: r2(i.taxTotal),
        wht: r2(i.advanceTaxTotal),
        total: r2(i.total),
      })),
    }

    const outTot = {
      taxable: r2(shopWise.reduce((t, s) => t + s.taxable, 0)),
      gst: r2(shopWise.reduce((t, s) => t + s.gst, 0)),
      wht: r2(shopWise.reduce((t, s) => t + s.wht, 0)),
      grand: r2(shopWise.reduce((t, s) => t + s.grand, 0)),
      orders: orders.length,
      shops: shopWise.length,
    }
    const netGst = r2(outTot.gst - input.gst)
    const netWht = r2(outTot.wht - input.wht)

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null },
      output: { summary: outTot, filerSummary, shopWise, annex },
      input,
      netStatement: { outputGst: outTot.gst, inputGst: input.gst, netGstPayable: netGst, outputWht: outTot.wht, inputWht: input.wht, netWht: netWht },
      meta: { bookers: await bookerList(profileId) },
    })
  } catch (e) {
    console.error('reports/tax', e)
    return jsonError('Tax report fail — server error', 500)
  }
}
