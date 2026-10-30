import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, outletScopeError } from '@/lib/api-auth'
import { computeReturnLines } from '@/lib/dms-return-core'
import { applyBillReturnEffects } from '@/lib/dms-return-effects'
import { audit } from '@/lib/audit'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const outletWhere =
      user.role === 'SALESMAN' ? { salesmanId: user.id } : { distributorId: user.profile?.id }

    const returns = await db.saleReturn.findMany({
      where: { outlet: outletWhere },
      include: {
        outlet: { select: { name: true } },
        order: { select: { orderNo: true } },
        items: { include: { product: { select: { name: true, unitsPerCarton: true, pcsPerBox: true } } } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return Response.json({
      returns: returns.map((r) => ({
        id: r.id,
        returnNo: r.returnNo,
        outletName: r.outlet.name,
        // Task 101: bill-linked return par bill ka number bhi dikhta hai
        orderNo: r.order?.orderNo ?? null,
        advancePosted: r.advancePosted,
        type: r.type,
        status: r.status,
        totalValue: r.totalValue,
        reason: r.reason,
        createdAt: new Date(r.createdAt).toISOString(),
        items: r.items.map((it) => ({ productName: it.product.name, qty: it.qty, rate: it.rate, value: it.value, unitsPerCarton: it.product.unitsPerCarton, pcsPerBox: it.product.pcsPerBox })),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Returns load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { outletId, type, reason, items, orderId } = body as {
      outletId: string; type: string; reason?: string; items: { productId: string; qty: number }[]
      orderId?: string
    }
    if (!outletId || !type || !items || items.length === 0) {
      return jsonError('Outlet, type aur items required hain')
    }

    const outlet = await db.outlet.findUnique({ where: { id: outletId } })
    if (!outlet) return jsonError('Outlet not found', 404)
    // Task 95: outlet scope — return sirf apni route / apne tenant ki shop par
    const ose = await outletScopeError(user, { distributorId: outlet.distributorId, salesmanId: outlet.salesmanId })
    if (ose) return ose

    // ---------------- Task 101: BILL-LINKED RETURN ----------------
    // Bill select kar ke usi bill ke items wapas — full amount with all taxes
    // (settlement page jaisa math). Distributor khud banaye => auto-APPROVED
    // (effects foran); salesman banaye => PENDING (approve par effects).
    if (orderId) {
      const order = await db.order.findUnique({
        where: { id: orderId },
        include: { items: { include: { product: { select: { name: true } } } } },
      })
      if (!order) return jsonError('Order not found', 404)
      if (order.outletId !== outletId) return jsonError('Ye bill is shop ka nahi hai')
      const st = await db.summarySettlement.findFirst({ where: { orderId: order.id } })
      if (!st) return jsonError('Is bill ki settlement abhi nahi hui — return sirf settled bills par hota hai')
      const summary = await db.deliverySummary.findUnique({ where: { id: st.summaryId }, select: { warehouseId: true } })
      if (!summary) return jsonError('Bill ki summary nahi mili', 404)

      // Server-side cap truth — over-return impossible (NO-MINUS guard #1)
      const priorReturns = await db.saleReturn.findMany({
        where: { orderId: order.id, status: 'APPROVED' },
        select: { items: { select: { productId: true, qty: true } } },
      })
      const returnedMap: Record<string, number> = {}
      for (const r of priorReturns) {
        for (const ri of r.items) returnedMap[ri.productId] = (returnedMap[ri.productId] ?? 0) + ri.qty
      }
      let lines: { productId: string; qty: number; rate: number; value: number }[]
      let returnValue: number
      try {
        const calc = computeReturnLines(
          order.items.map((it) => ({ productId: it.productId, qty: it.qty, rate: it.rate, lineTotal: it.lineTotal, productName: it.product.name })),
          items,
          returnedMap,
        )
        lines = calc.lines
        returnValue = calc.returnValue
      } catch (err) {
        return jsonError(err instanceof Error ? err.message : 'Return items galat hain')
      }

      const isDistributor = user.role === 'DISTRIBUTOR'
      const status = isDistributor ? 'APPROVED' : 'PENDING'
      const seq = await nextSeq('return')
      const returnNo = `RET-${seq}`

      if (!isDistributor) {
        // Salesman — PENDING, koi effect nahi (approve par lagenge)
        const ret = await db.saleReturn.create({
          data: {
            returnNo, outletId, orderId: order.id, type, status: 'PENDING',
            totalValue: returnValue, reason: reason ?? null,
            items: { create: lines },
          },
        })
        return Response.json({ return: { id: ret.id, returnNo: ret.returnNo, status: 'PENDING' } })
      }

      // Distributor — auto-APPROVED + full effects (ONE transaction)
      const result = await db.$transaction(async (tx) => {
        const ret = await tx.saleReturn.create({
          data: {
            returnNo, outletId, orderId: order.id, type, status: 'APPROVED',
            totalValue: returnValue, reason: reason ?? null,
            items: { create: lines },
          },
        })
        const fx = await applyBillReturnEffects(tx, {
          returnId: ret.id,
          returnNo,
          outletId,
          order: { id: order.id, orderNo: order.orderNo, total: order.total, advanceTax: order.advanceTax, gstTotal: order.gstTotal, tradeOfferTotal: order.tradeOfferTotal },
          st,
          warehouseId: summary.warehouseId,
          lines,
          userId: user.id,
          contextNote: `Stock return (${type}) — Return & Claims se`,
          type, // Task 29: category-gated restock — sirf UNSOLD inventory mein wapas
        })
        return { ret, fx }
      }, { timeout: 20000 })

      const advanceMsg = result.fx.advancePosted > 0
        ? ` Rs ${result.fx.advancePosted.toFixed(2)} shop ke ADVANCE mein (agli bill se auto-adjust)`
        : ''
      // Task 29: category-aware message — user ko foran pata ho stock kahan gaya
      const stockMsg = result.fx.restocked
        ? 'stock inventory (van warehouse) mein wapas'
        : 'damage/expired stock inventory mein NAHI gaya — floor claim report mein counted'
      // Task 35: RETURN_CREATE (bill-linked, auto-APPROVED) ka record
      await audit(
        { id: user.id, name: user.name, role: user.role, tenantId: outlet.distributorId },
        'RETURN_CREATE',
        { req, entity: 'SaleReturn', entityId: result.ret.id, detail: `${returnNo} — ${outlet.name}: bill ${order.orderNo} par Rs ${returnValue} (${type}${reason ? ` — ${reason}` : ''}), APPROVED` },
      )
      return Response.json({
        return: {
          id: result.ret.id,
          returnNo,
          status: 'APPROVED',
          totalValue: returnValue,
          orderNo: order.orderNo,
          ledgerCredit: result.fx.ledgerCredit,
          advancePosted: result.fx.advancePosted,
          restocked: result.fx.restocked,
          message: `Return ${returnNo} approved — ${stockMsg}, shop ka khata update. Total credit Rs ${result.fx.totalCredit.toFixed(2)}.${advanceMsg}`,
        },
      })
    }

    // ---------------- STANDALONE RETURN (purana tarika — unchanged) ----------------
    const productIds = items.map((i: { productId: string }) => i.productId)
    // Task 23: tenant scope — return jis distributor ki shop ka, products usi ke
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: outlet.distributorId } })
    let totalValue = 0
    // qty = PIECES (base unit) — rate per piece = tradePrice / unitsPerCarton
    const itemData = items.map((i: { productId: string; qty: number }) => {
      const p = products.find((x) => x.id === i.productId)!
      const rate = p.tradePrice / Math.max(1, p.unitsPerCarton)
      const value = Math.round(i.qty * rate * 100) / 100
      totalValue += value
      return { productId: i.productId, qty: i.qty, rate, value }
    })

    const seq = await nextSeq('return')
    const ret = await db.saleReturn.create({
      data: {
        returnNo: `RET-${seq}`,
        outletId, type, reason: reason ?? null,
        status: 'PENDING', totalValue,
        items: { create: itemData },
      },
    })
    // Task 35: RETURN_CREATE (standalone, PENDING) ka record
    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId: outlet.distributorId },
      'RETURN_CREATE',
      { req, entity: 'SaleReturn', entityId: ret.id, detail: `${ret.returnNo} — ${outlet.name}: ${items.length} items, Rs ${totalValue} (${type}${reason ? ` — ${reason}` : ''}), PENDING` },
    )
    return Response.json({ return: { id: ret.id, returnNo: ret.returnNo, status: 'PENDING' } })
  } catch (e) {
    console.error(e)
    return jsonError('Return create failed', 500)
  }
}
