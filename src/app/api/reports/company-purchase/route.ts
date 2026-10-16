import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { distributorGuard, parseRange, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — COMPANY PURCHASE & PAYABLES REPORT
// Kis company se kitna maal kharida (period) + kitna unpaid baaki.
// Per company: invoices, units (pcs), net purchase (subtotal − discount),
// GST (input tax), advance tax, trade offer, invoice total, paid,
// outstanding + company ledger balance cross-check.
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const g = await distributorGuard(url.searchParams.get('userId'))
    if (g instanceof Response) return g
    const { profileId } = g
    const { from, to } = parseRange(url)

    const invoices = await db.purchaseInvoice.findMany({
      where: { distributorId: profileId, date: { gte: from, lte: to } },
      select: {
        id: true, invoiceNo: true, companyId: true, company: { select: { name: true } },
        subtotal: true, discount: true, taxTotal: true, advanceTaxTotal: true,
        tradeOfferTotal: true, total: true, paidAmount: true, status: true,
        items: { select: { units: true } },
      },
      orderBy: { date: 'asc' },
    })

    // company ledger balances (all-time — payables abhi tak ke)
    // schema: Balance = Σcredit − Σdebit (positive = company ko dena hai)
    const ledger = await db.companyLedgerEntry.findMany({
      where: { company: { distributorId: profileId } },
      select: { companyId: true, debit: true, credit: true },
    })
    const ledgerBal = new Map<string, number>()
    for (const e of ledger) {
      ledgerBal.set(e.companyId, r2((ledgerBal.get(e.companyId) ?? 0) + e.credit - e.debit))
    }

    type CA = { company: string; invoices: number; units: number; subtotal: number; discount: number; netPurchase: number; gst: number; wht: number; tradeOffer: number; total: number; paid: number }
    const agg = new Map<string, CA>()
    for (const inv of invoices) {
      const a = agg.get(inv.companyId) ?? { company: inv.company.name, invoices: 0, units: 0, subtotal: 0, discount: 0, netPurchase: 0, gst: 0, wht: 0, tradeOffer: 0, total: 0, paid: 0 }
      a.invoices += 1
      a.units += inv.items.reduce((t, it) => t + it.units, 0)
      a.subtotal = r2(a.subtotal + inv.subtotal)
      a.discount = r2(a.discount + inv.discount)
      a.netPurchase = r2(a.netPurchase + (inv.subtotal - inv.discount))
      a.gst = r2(a.gst + inv.taxTotal)
      a.wht = r2(a.wht + inv.advanceTaxTotal)
      a.tradeOffer = r2(a.tradeOffer + inv.tradeOfferTotal)
      a.total = r2(a.total + inv.total)
      a.paid = r2(a.paid + inv.paidAmount)
      agg.set(inv.companyId, a)
    }

    const rows = [...agg.entries()]
      .map(([cid, a]) => ({
        companyId: cid,
        ...a,
        outstanding: r2(a.total - a.paid),
        ledgerBalance: ledgerBal.get(cid) ?? 0,
      }))
      .sort((x, y) => y.netPurchase - x.netPurchase)

    // unpaid invoices list (audit ke liye)
    const unpaidRows = invoices
      .filter((i) => i.total - i.paidAmount > 0.01)
      .map((i) => ({ invoiceNo: i.invoiceNo, company: i.company.name, total: r2(i.total), paid: r2(i.paidAmount), outstanding: r2(i.total - i.paidAmount), status: i.status }))
      .sort((x, y) => y.outstanding - x.outstanding)

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      summary: {
        companies: rows.length,
        invoices: invoices.length,
        netPurchase: r2(rows.reduce((t, x) => t + x.netPurchase, 0)),
        gstInput: r2(rows.reduce((t, x) => t + x.gst, 0)),
        totalPayable: r2(rows.reduce((t, x) => t + x.outstanding, 0)),
        paid: r2(rows.reduce((t, x) => t + x.paid, 0)),
      },
      rows,
      unpaidRows,
    })
  } catch (e) {
    console.error('reports/company-purchase', e)
    return jsonError('Company purchase report fail — server error', 500)
  }
}
