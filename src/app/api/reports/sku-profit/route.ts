import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, unitCostMap, bookerList, companyList, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 86 — SKU PROFIT REPORT (distributor ka profit hisaab)
// Har SKU ke liye seedha jawab:
//   • Kitny ka Aya     = COGS — jo maal becha (qty + free − returns)
//                        uski weighted-avg purchase cost (asli kharcha)
//   • Kitny ka Sale Kia= Net Sale — billing rate se (scheme/manual discount
//                        minus) aur approved returns minus
//   • Kitna Profit     = Sale − Cost
//   • Kitny Percentage = Margin % = Profit ÷ Sale × 100
// Cost basis (sales-profit report jaisa): purchase invoices ka weighted
// average netAmount/units — trade price NAHI. Koi purchase invoice na ho
// to product.purchasePrice (per ctn ÷ unitsPerCarton) fallback, warna trade.
// CONFIRMED (unprocessed) se DELIVERED tak sab non-cancelled orders count —
// booked sale bhi profit hisaab mein aati hai (Task 66 convention).
// ============================================================

export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
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
    const companyId = url.searchParams.get('companyId') || undefined

    // ---- products (name/sku/company + fallback cost) ----
    const products = await db.product.findMany({
      where: { distributorId: profileId },
      select: { id: true, name: true, sku: true, companyId: true, unitsPerCarton: true, purchasePrice: true, tradePrice: true },
    })
    const pMap = new Map(products.map((p) => [p.id, p]))
    const companyIds = [...new Set(products.map((p) => p.companyId).filter(Boolean))] as string[]
    const companies = await db.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } })
    const cMap = new Map(companies.map((c) => [c.id, c.name]))

    const costMap = await unitCostMap(profileId, to)
    const unitCost = (pid: string): number => {
      const c = costMap.get(pid)
      if (c != null) return c
      const p = pMap.get(pid)
      if (!p) return 0
      const upc = Math.max(1, p.unitsPerCarton || 1)
      if (p.purchasePrice && p.purchasePrice > 0) return r2(p.purchasePrice / upc)
      return r2(p.tradePrice / upc)
    }

    // ---- sold lines (period, non-cancelled) ----
    const orders = await db.order.findMany({
      where: {
        distributorId: profileId,
        orderDate: { gte: from, lte: to },
        status: { not: 'CANCELLED' },
        ...(bookerId ? { salesmanId: bookerId } : {}),
      },
      select: {
        id: true,
        items: { select: { productId: true, qty: true, freeQty: true, lineTotal: true } },
      },
    })

    // ---- approved returns in period ----
    const returns = await db.saleReturn.findMany({
      where: { outlet: { distributorId: profileId }, status: 'APPROVED', createdAt: { gte: from, lte: to } },
      select: { items: { select: { productId: true, qty: true, value: true } } },
    })

    type Agg = { qty: number; freeQty: number; retQty: number; net: number; retValue: number }
    const agg = new Map<string, Agg>()
    for (const o of orders) {
      for (const it of o.items) {
        if (companyId && pMap.get(it.productId)?.companyId !== companyId) continue
        const a = agg.get(it.productId) ?? { qty: 0, freeQty: 0, retQty: 0, net: 0, retValue: 0 }
        a.qty += it.qty
        a.freeQty += it.freeQty
        a.net = r2(a.net + it.lineTotal)
        agg.set(it.productId, a)
      }
    }
    for (const ret of returns) {
      for (const it of ret.items) {
        if (companyId && pMap.get(it.productId)?.companyId !== companyId) continue
        const a = agg.get(it.productId)
        if (!a) continue // jis SKU ki sale hi nahi (period mein) — return profit report row nahi banata
        a.retQty += it.qty
        a.retValue = r2(a.retValue + it.value)
      }
    }

    const rows = [...agg.entries()]
      .map(([pid, a]) => {
        const p = pMap.get(pid)
        const upc = Math.max(1, p?.unitsPerCarton || 1)
        const cRate = unitCost(pid)
        const saleRate = a.qty > 0 ? r2(a.net / a.qty) : 0 // avg billed rate per pc
        const saleTotal = r2(a.net - a.retValue) // jo asli bikri rahi (returns ke baad)
        const costUnits = Math.max(0, a.qty + a.freeQty - a.retQty) // free units ki cost bhi humari thi
        const costTotal = r2(costUnits * cRate)
        const profit = r2(saleTotal - costTotal)
        return {
          productId: pid,
          productName: p?.name ?? '—',
          sku: p?.sku ?? '',
          company: p?.companyId ? (cMap.get(p.companyId) ?? '—') : 'No Company',
          qtySold: a.qty,
          freeQty: a.freeQty,
          retQty: a.retQty,
          costRate: cRate, // per pc — kitny ka aya (1 pc)
          saleRate, // per pc — kitny ka becha (avg billed rate)
          costCtn: r2(cRate * upc), // per carton (system rates carton-based hain)
          saleCtn: r2(saleRate * upc),
          costTotal, // Kitny ka Aya (total)
          saleTotal, // Kitny ka Sale Kia (total)
          profit, // Kitna Profit
          marginPct: saleTotal > 0 ? r2((profit / saleTotal) * 100) : saleTotal < 0 ? -100 : 0,
        }
      })
      .sort((x, y) => y.profit - x.profit || y.saleTotal - x.saleTotal)

    const tot = rows.reduce(
      (t, x) => ({
        costTotal: r2(t.costTotal + x.costTotal),
        saleTotal: r2(t.saleTotal + x.saleTotal),
        profit: r2(t.profit + x.profit),
        qtySold: t.qtySold + x.qtySold,
        freeQty: t.freeQty + x.freeQty,
        retQty: t.retQty + x.retQty,
      }),
      { costTotal: 0, saleTotal: 0, profit: 0, qtySold: 0, freeQty: 0, retQty: 0 },
    )

    const meta = await Promise.all([bookerList(profileId), companyList(profileId)])

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, companyId: companyId ?? null },
      summary: {
        ...tot,
        marginPct: tot.saleTotal > 0 ? r2((tot.profit / tot.saleTotal) * 100) : 0,
        orders: orders.length,
        skus: rows.length,
      },
      rows,
      meta: { bookers: meta[0], companies: meta[1] },
    })
  } catch (e) {
    console.error('reports/sku-profit', e)
    return jsonError('SKU profit report fail — server error', 500)
  }
}
