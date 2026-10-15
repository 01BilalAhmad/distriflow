import { db } from '@/lib/db'
import { jsonError, distributorTenant } from '@/lib/dms-scope'

/**
 * Task 36 — Supplier Aging & Payments overview (DISTRIBUTOR).
 * GET /api/supplier-aging?userId=
 *
 * - Payable per company = companyLedger balance (SUM credit - SUM debit; positive = dena hai)
 * - Aging buckets (0-30 / 31-60 / 61-90 / 90+ din) = UNPAID/PARTIAL purchase invoices ka
 *   remaining (total - paidAmount), invoice date ki umar se bucket hota hai
 * - Recent payments = companyLedgerEntry type=PAYMENT (latest 12)
 * - KPIs: totalPayable, over60 (61+ din buckets), payments30d
 */

function startOfDay(d = new Date()): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const [companies, invoices, payments] = await Promise.all([
      db.company.findMany({
        where: { distributorId: tenantId },
        select: { id: true, name: true, shortCode: true, isActive: true },
        orderBy: { name: 'asc' },
      }),
      db.purchaseInvoice.findMany({
        where: { distributorId: tenantId, status: { in: ['UNPAID', 'PARTIAL'] } },
        select: { id: true, companyId: true, date: true, total: true, paidAmount: true },
      }),
      db.companyLedgerEntry.findMany({
        where: { distributorId: tenantId, type: 'PAYMENT' },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        take: 12,
        include: { company: { select: { id: true, name: true } } },
      }),
    ])

    // Ledger payable per company (credit - debit)
    const ledgers = await db.companyLedgerEntry.groupBy({
      by: ['companyId'],
      where: { distributorId: tenantId },
      _sum: { credit: true, debit: true },
    })
    const payableByCompany = new Map<string, number>()
    for (const l of ledgers) {
      payableByCompany.set(l.companyId, Math.round(((l._sum.credit ?? 0) - (l._sum.debit ?? 0)) * 100) / 100)
    }

    const round2 = (n: number) => Math.round(n * 100) / 100
    const now = startOfDay()

    // Aging buckets per company from open invoices
    interface Buckets { b0: number; b31: number; b61: number; b91: number; openInvoices: number }
    const bucketsByCompany = new Map<string, Buckets>()
    for (const inv of invoices) {
      const remaining = round2(inv.total - inv.paidAmount)
      if (remaining <= 0.01) continue
      const ageDays = Math.floor((now.getTime() - startOfDay(inv.date).getTime()) / 86400000)
      const b = bucketsByCompany.get(inv.companyId) ?? { b0: 0, b31: 0, b61: 0, b91: 0, openInvoices: 0 }
      b.openInvoices++
      if (ageDays <= 30) b.b0 = round2(b.b0 + remaining)
      else if (ageDays <= 60) b.b31 = round2(b.b31 + remaining)
      else if (ageDays <= 90) b.b61 = round2(b.b61 + remaining)
      else b.b91 = round2(b.b91 + remaining)
      bucketsByCompany.set(inv.companyId, b)
    }

    const companyRows = companies
      .map((c) => {
        const payable = payableByCompany.get(c.id) ?? 0
        const b = bucketsByCompany.get(c.id) ?? { b0: 0, b31: 0, b61: 0, b91: 0, openInvoices: 0 }
        return {
          companyId: c.id,
          name: c.name,
          shortCode: c.shortCode,
          isActive: c.isActive,
          payable,
          ...b,
        }
      })
      .sort((a, b) => b.payable - a.payable || a.name.localeCompare(b.name))

    const totalPayable = round2(companyRows.reduce((s, c) => s + c.payable, 0))
    const over60 = round2(companyRows.reduce((s, c) => s + c.b61 + c.b91, 0))

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const payments30d = round2(
      payments.filter((p) => p.date >= monthStart).reduce((s, p) => s + p.debit, 0),
    )

    return Response.json({
      kpis: { totalPayable, over60, payments30d },
      companies: companyRows,
      payments: payments.map((p) => ({
        id: p.id,
        date: new Date(p.date).toISOString(),
        amount: p.debit,
        companyId: p.company.id,
        companyName: p.company.name,
        description: p.description,
        refNo: p.refNo,
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Supplier aging load failed', 500)
  }
}
