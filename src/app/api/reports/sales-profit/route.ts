import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { parseRange, unitCostMap, bookerList, companyList, r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 66 — SALES & PROFIT REPORT
// Product / Order-Booker / Company wise breakdown with date range.
//   Gross Sales   = Σ (rate × qty)                [return se pehle]
//   Discounts     = Σ (scheme discount + manual share)
//   Net Sales     = Σ lineTotal                   (gross − discounts)
//   Returns       = APPROVED SaleReturn items (period) — value eff-rate par
//   COGS          = (qty + freeQty − retQty) × weighted-avg unit cost
//                   (free units ki cost bhi — wo maal kharida tha, sale 0)
//   Profit (Self) = Net after returns − COGS      [scheme cost khud bear]
//   Claim Potential = discounts + trade offer     [company claim ho to]
//   Profit (Claim)= Profit (Self) + Claim Potential
// Cost basis: purchase invoices ka weighted avg (netAmount/units) —
// trade price NAHI (asal kharcha company invoice ka hai).
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

    // ---- products (name/sku/company/fallback cost) ----
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
        id: true, salesmanId: true, outletId: true,
        items: {
          select: { productId: true, qty: true, freeQty: true, rate: true, discount: true, manualShare: true, lineTotal: true, tradeOfferAmt: true },
        },
      },
    })

    // ---- approved returns in period ----
    const returns = await db.saleReturn.findMany({
      where: { outlet: { distributorId: profileId }, status: 'APPROVED', createdAt: { gte: from, lte: to } },
      select: { items: { select: { productId: true, qty: true, value: true } } },
    })

    type Agg = {
      productId: string
      qty: number; freeQty: number; gross: number; disc: number; net: number; toAmt: number
      retQty: number; retValue: number
    }
    const prodAgg = new Map<string, Agg>()
    const bookerAgg = new Map<string, { orders: Set<string>; shops: Set<string>; gross: number; disc: number; net: number; toAmt: number; cogs: number }>()
    const compAgg = new Map<string, { gross: number; disc: number; net: number; toAmt: number; cogs: number; retValue: number }>()
    const bookerNames = new Map<string, string>()
    if (orders.length) {
      const sIds = [...new Set(orders.map((o) => o.salesmanId).filter(Boolean))] as string[]
      if (sIds.length) {
        const us = await db.user.findMany({ where: { id: { in: sIds } }, select: { id: true, name: true } })
        for (const u of us) bookerNames.set(u.id, u.name)
      }
    }

    for (const o of orders) {
      const bk = bookerAgg.get(o.salesmanId ?? 'unassigned') ?? { orders: new Set<string>(), shops: new Set<string>(), gross: 0, disc: 0, net: 0, toAmt: 0, cogs: 0 }
      bk.orders.add(o.id)
      bk.shops.add(o.outletId)
      for (const it of o.items) {
        const p = pMap.get(it.productId)
        if (companyId && p?.companyId !== companyId) continue // company filter = sirf us company ki lines
        const a = prodAgg.get(it.productId) ?? { productId: it.productId, qty: 0, freeQty: 0, gross: 0, disc: 0, net: 0, toAmt: 0, retQty: 0, retValue: 0 }
        const gross = r2(it.rate * it.qty)
        const disc = r2(it.discount + it.manualShare)
        const uc = unitCost(it.productId)
        a.qty += it.qty
        a.freeQty += it.freeQty
        a.gross = r2(a.gross + gross)
        a.disc = r2(a.disc + disc)
        a.net = r2(a.net + it.lineTotal)
        a.toAmt = r2(a.toAmt + it.tradeOfferAmt)
        prodAgg.set(it.productId, a)

        bk.gross = r2(bk.gross + gross)
        bk.disc = r2(bk.disc + disc)
        bk.net = r2(bk.net + it.lineTotal)
        bk.toAmt = r2(bk.toAmt + it.tradeOfferAmt)
        bk.cogs = r2(bk.cogs + (it.qty + it.freeQty) * uc)
        bookerAgg.set(o.salesmanId ?? 'unassigned', bk)

        const cid = p?.companyId ?? 'none'
        const ca = compAgg.get(cid) ?? { gross: 0, disc: 0, net: 0, toAmt: 0, cogs: 0, retValue: 0 }
        ca.gross = r2(ca.gross + gross)
        ca.disc = r2(ca.disc + disc)
        ca.net = r2(ca.net + it.lineTotal)
        ca.toAmt = r2(ca.toAmt + it.tradeOfferAmt)
        ca.cogs = r2(ca.cogs + (it.qty + it.freeQty) * uc)
        compAgg.set(cid, ca)
      }
    }

    for (const ret of returns) {
      for (const it of ret.items) {
        const p = pMap.get(it.productId)
        if (companyId && p?.companyId !== companyId) continue
        const a = prodAgg.get(it.productId)
        if (a) {
          a.retQty += it.qty
          a.retValue = r2(a.retValue + it.value)
        }
        const cid = p?.companyId ?? 'none'
        const ca = compAgg.get(cid)
        if (ca) ca.retValue = r2(ca.retValue + it.value)
      }
    }
    // booker-level returns allocate nahi hote (return shop-level event hai, booker attribution
    // ledger mein nahi hota) — booker rows par sirf sales side; returns detail product/company par.

    const productWise = [...prodAgg.values()]
      .map((a) => {
        const p = pMap.get(a.productId)
        const netAfter = r2(a.net - a.retValue)
        const costUnits = Math.max(0, a.qty + a.freeQty - a.retQty)
        const cogs = r2(costUnits * unitCost(a.productId))
        const profitSelf = r2(netAfter - cogs)
        const claim = r2(a.disc + a.toAmt)
        return {
          productId: a.productId,
          productName: p?.name ?? '—',
          sku: p?.sku ?? '',
          company: p?.companyId ? (cMap.get(p.companyId) ?? '—') : 'No Company',
          qtySold: a.qty,
          freeQty: a.freeQty,
          retQty: a.retQty,
          grossSales: a.gross,
          discountTotal: a.disc,
          tradeOfferTotal: a.toAmt,
          netSales: a.net,
          returnsValue: a.retValue,
          netAfterReturns: netAfter,
          unitCost: unitCost(a.productId),
          cogs,
          profitSelf,
          claimPotential: claim,
          profitWithClaim: r2(profitSelf + claim),
          marginPct: netAfter > 0 ? r2((profitSelf / netAfter) * 100) : 0,
        }
      })
      .sort((x, y) => y.netSales - x.netSales)

    const bookerWise = [...bookerAgg.entries()]
      .map(([bid, b]) => {
        const profitSelf = r2(b.net - b.cogs)
        const claim = r2(b.disc + b.toAmt)
        return {
          bookerId: bid,
          bookerName: bid === 'unassigned' ? 'Unassigned' : (bookerNames.get(bid) ?? '—'),
          orders: b.orders.size,
          shops: b.shops.size,
          grossSales: b.gross,
          discountTotal: b.disc,
          tradeOfferTotal: b.toAmt,
          netSales: b.net,
          cogs: b.cogs,
          profitSelf,
          claimPotential: claim,
          profitWithClaim: r2(profitSelf + claim),
          marginPct: b.net > 0 ? r2((profitSelf / b.net) * 100) : 0,
        }
      })
      .sort((x, y) => y.netSales - x.netSales)

    const companyWise = [...compAgg.entries()]
      .map(([cid, c]) => {
        const profitSelf = r2(c.net - c.cogs)
        const claim = r2(c.disc + c.toAmt)
        return {
          companyId: cid,
          company: cid === 'none' ? 'No Company' : (cMap.get(cid) ?? '—'),
          grossSales: c.gross,
          discountTotal: c.disc,
          tradeOfferTotal: c.toAmt,
          netSales: c.net,
          returnsValue: c.retValue,
          netAfterReturns: r2(c.net - c.retValue),
          cogs: c.cogs,
          profitSelf,
          claimPotential: claim,
          profitWithClaim: r2(profitSelf + claim),
          marginPct: c.net > 0 ? r2((profitSelf / c.net) * 100) : 0,
        }
      })
      .sort((x, y) => y.netSales - x.netSales)

    const tot = productWise.reduce(
      (t, x) => ({
        grossSales: r2(t.grossSales + x.grossSales),
        discountTotal: r2(t.discountTotal + x.discountTotal),
        tradeOfferTotal: r2(t.tradeOfferTotal + x.tradeOfferTotal),
        netSales: r2(t.netSales + x.netSales),
        returnsValue: r2(t.returnsValue + x.returnsValue),
        netAfterReturns: r2(t.netAfterReturns + x.netAfterReturns),
        cogs: r2(t.cogs + x.cogs),
        profitSelf: r2(t.profitSelf + x.profitSelf),
        claimPotential: r2(t.claimPotential + x.claimPotential),
        profitWithClaim: r2(t.profitWithClaim + x.profitWithClaim),
      }),
      { grossSales: 0, discountTotal: 0, tradeOfferTotal: 0, netSales: 0, returnsValue: 0, netAfterReturns: 0, cogs: 0, profitSelf: 0, claimPotential: 0, profitWithClaim: 0 },
    )

    const meta = await Promise.all([bookerList(profileId), companyList(profileId)])

    return Response.json({
      range: { from: from.toISOString(), to: to.toISOString() },
      filters: { bookerId: bookerId ?? null, companyId: companyId ?? null },
      summary: { ...tot, orders: orders.length, products: productWise.length },
      productWise,
      bookerWise,
      companyWise,
      meta: { bookers: meta[0], companies: meta[1] },
    })
  } catch (e) {
    console.error('reports/sales-profit', e)
    return jsonError('Sales profit report fail — server error', 500)
  }
}
