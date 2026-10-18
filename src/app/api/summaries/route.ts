import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { fulfillOrder } from '@/lib/dms-fulfill'
import { orderGrandPayable } from '@/lib/dms-order-calc'
import { persistLiveRecalc } from '@/lib/dms-live-recalc'

/** GET /api/summaries?userId=&status= — list delivery summaries (scoped by role) */
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
    const fullWhere = status && status !== 'ALL' ? { ...where, status } : where

    const summaries = await db.deliverySummary.findMany({
      where: fullWhere,
      include: {
        salesman: { select: { name: true } },
        distributor: { select: { businessName: true } },
        warehouse: { select: { name: true } },
        orders: { select: { total: true, tradeOfferTotal: true, gstTotal: true, advanceTax: true } },
        settlements: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    return Response.json({
      summaries: summaries.map((s) => {
        // Task 80: card/table par FINAL payable — unsettled: booking chain (grand payable);
        // settled: posted net (cash + credit — late-return ke baad bhi exact)
        const payable = s.settlements.length > 0
          ? Math.round(s.settlements.reduce((a, st) => a + st.cashAmount + st.creditAmount, 0) * 100) / 100
          : Math.round(s.orders.reduce((a, o) => a + orderGrandPayable(o), 0) * 100) / 100
        return {
        id: s.id,
        summaryNo: s.summaryNo,
        salesmanName: s.salesman.name,
        distributorName: s.distributor.businessName,
        warehouseName: s.warehouse.name,
        orderDate: new Date(s.orderDate).toISOString(),
        deliveryDate: new Date(s.deliveryDate).toISOString(),
        status: s.status,
        billsCount: s.orders.length,
        subtotal: s.subtotal,
        payable,
        settledCash: s.settledCash,
        settledCredit: s.settledCredit,
        settledReturns: s.settledReturns,
        settledAt: s.settledAt ? new Date(s.settledAt).toISOString() : null,
        settledByName: s.settledByName,
        }
      }),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Summaries load failed', 500)
  }
}

interface ProcessBody {
  userId?: string
  orderIds: string[]
  deliveryDate?: string
  notes?: string
  processAnyway?: boolean
}

/**
 * POST /api/summaries — process selected unprocessed bills into ONE DeliverySummary.
 * Rules: all orders must be CONFIRMED, belong to ONE orderbooker (salesman).
 * Delivery date defaults to next day (editable). FEFO stock is deducted at process
 * time (van loading) and each invoice gets its Delivery challan.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json() as ProcessBody
    const { orderIds, deliveryDate, notes, processAnyway } = body
    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return jsonError('Kam az kam 1 bill select karein')
    }

    const orders = await db.order.findMany({
      where: { id: { in: orderIds } },
      include: {
        items: true,
        salesman: { select: { id: true, name: true } },
        outlet: { select: { name: true } },
      },
    })
    if (orders.length !== orderIds.length) return jsonError('Kuch orders nahi mile', 404)

    const bad = orders.find((o) => o.status !== 'CONFIRMED')
    if (bad) return jsonError(`Order ${bad.orderNo} process nahi ho sakta (status: ${bad.status})`)

    const salesmanIds = new Set(orders.map((o) => o.salesmanId))
    if (salesmanIds.size > 1 || orders.some((o) => !o.salesmanId)) {
      return jsonError('Ek summary mein sirf EK order booker ki bills ho sakti hain')
    }
    const salesmanId = orders[0].salesmanId!

    // Primary warehouse of the distributor that owns these orders
    const distributorId = orders[0].distributorId
    const wh = await db.warehouse.findFirst({ where: { distributorId, isPrimary: true } })
    if (!wh) return jsonError('Warehouse not found', 404)

    // Delivery date = next day by default (editable via request)
    let deliveryDt: Date
    if (deliveryDate) {
      deliveryDt = new Date(deliveryDate)
      if (isNaN(deliveryDt.getTime())) return jsonError('Delivery date invalid hai')
    } else {
      deliveryDt = new Date()
      deliveryDt.setDate(deliveryDt.getDate() + 1)
    }

    // Fulfill in deterministic order (purani bill pehle — FEFO allocation predictable)
    const seqOrders = [...orders].sort((a, b) => a.orderNo.localeCompare(b.orderNo))

    // ---- Task 27: OUT-OF-STOCK PRE-FLIGHT CHECK ----
    // Process se pehle check: har bill ka har product warehouse mein hai ya nahi.
    // Short hone par structured shortages list return (UI popup isi se detail dikhata hai —
    // kis bill sy kis product ka kitna minus hota). Pehle ye chup-chap FEFO partial
    // deduct karta tha (silent negative stock) — ab BLOCK + detail popup.
    const productIds = [...new Set(seqOrders.flatMap((o) => o.items.map((it) => it.productId)))]
    const onHandRows = await db.stockBatch.groupBy({
      by: ['productId'],
      where: { warehouseId: wh.id, ...(productIds.length ? { productId: { in: productIds } } : {}) },
      _sum: { qty: true },
    })
    const selectedIds = new Set(seqOrders.map((o) => o.id))
    const otherCommittedRows = await db.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: { distributorId, status: 'CONFIRMED', id: { notIn: [...selectedIds] } },
        ...(productIds.length ? { productId: { in: productIds } } : {}),
      },
      _sum: { qty: true },
    })
    const onHand = new Map(onHandRows.map((r) => [r.productId, r._sum.qty ?? 0]))
    const otherCommitted = new Map(otherCommittedRows.map((r) => [r.productId, r._sum.qty ?? 0]))
    // Is batch ke liye uthta hua stock = warehouse stock − doosri open bills ki reserved qty
    const initialRemaining = new Map<string, number>()
    for (const [pid, qty] of onHand) initialRemaining.set(pid, qty)
    for (const [pid, qty] of otherCommitted) initialRemaining.set(pid, (initialRemaining.get(pid) ?? 0) - qty)
    const prods = productIds.length ? await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, sku: true, unitsPerCarton: true, pcsPerBox: true },
    }) : []
    const prodInfo = new Map(prods.map((p) => [p.id, p]))

    interface ShortageRow {
      orderId: string
      orderNo: string
      outletName: string
      productId: string
      productName: string
      sku: string
      unitsPerCarton: number
      pcsPerBox: number
      bookedPcs: number
      availPcs: number
      shortPcs: number
    }
    const shortages: ShortageRow[] = []
    {
      // Check-walk apni copy par — allocation walk ko fresh initialRemaining chahiye
      const checkRemaining = new Map(initialRemaining)
      for (const o of seqOrders) {
        for (const it of o.items) {
          const rem = checkRemaining.get(it.productId) ?? 0
          if (it.qty > rem) {
            const p = prodInfo.get(it.productId)
            shortages.push({
              orderId: o.id,
              orderNo: o.orderNo,
              outletName: o.outlet?.name ?? '—',
              productId: it.productId,
              productName: p?.name ?? 'Product',
              sku: p?.sku ?? '',
              unitsPerCarton: p?.unitsPerCarton ?? 1,
              pcsPerBox: p?.pcsPerBox ?? 0,
              bookedPcs: it.qty,
              availPcs: Math.max(0, rem),
              shortPcs: it.qty - Math.max(0, rem),
            })
          }
          checkRemaining.set(it.productId, Math.max(0, rem - it.qty))
        }
      }
    }
    if (shortages.length > 0 && !processAnyway) {
      return Response.json(
        {
          error: `Out of stock — ${shortages.length} line${shortages.length > 1 ? 's' : ''} mein stock kami hai (detail popup dekhein)`,
          shortages,
        },
        { status: 400 },
      )
    }

    // ---- Task 28: PROCESS ANYWAY — jitna stock hai utna lag jaye ----
    // Allocation walk (deterministic orderNo asc — purani bill pehle): har line ko
    // min(booked, bacha hua) milta hai. Bill jis ki SAARI lines 0 aayin wo SKIP hoti hai
    // (CONFIRMED rehti hai = Stock Allocation mein khari rahegi); baqi bills PARTIAL
    // load ke sath process (delivery mein actual loaded qty). Ye bills sirf is batch
    // ke liye process hoti hain — unprocessed doosri bills (otherCommitted) untouched.
    if (shortages.length > 0 && processAnyway) {
      const allocRemaining = new Map(initialRemaining)
      const overrideByOrder = new Map<string, Map<string, number>>() // orderId -> (orderItemId -> pcs)
      const processedOrderIds: string[] = []
      const skippedBills: { orderNo: string; outletName: string }[] = []
      interface ShortRow {
        orderNo: string
        outletName: string
        productName: string
        sku: string
        unitsPerCarton: number
        pcsPerBox: number
        bookedPcs: number
        loadedPcs: number
      }
      const shortRows: ShortRow[] = []
      for (const o of seqOrders) {
        const lineOverride = new Map<string, number>()
        const orderShortRows: ShortRow[] = []
        for (const it of o.items) {
          const rem = Math.max(0, allocRemaining.get(it.productId) ?? 0)
          const give = Math.min(it.qty, rem)
          allocRemaining.set(it.productId, rem - give)
          lineOverride.set(it.id, give)
          if (give < it.qty) {
            const p = prodInfo.get(it.productId)
            orderShortRows.push({
              orderNo: o.orderNo,
              outletName: o.outlet?.name ?? '—',
              productName: p?.name ?? 'Product',
              sku: p?.sku ?? '',
              unitsPerCarton: p?.unitsPerCarton ?? 1,
              pcsPerBox: p?.pcsPerBox ?? 0,
              bookedPcs: it.qty,
              loadedPcs: give,
            })
          }
        }
        if ([...lineOverride.values()].every((v) => v === 0)) {
          skippedBills.push({ orderNo: o.orderNo, outletName: o.outlet?.name ?? '—' })
        } else {
          overrideByOrder.set(o.id, lineOverride)
          processedOrderIds.push(o.id)
          shortRows.push(...orderShortRows) // sirf PROCESS hui bills ki short lines — skipped bills alag list mein hain
        }
      }

      // ---- Task 86: PROCESS-TIME LIVE REFRESH (Rule 3 ka dil) ----
      // Process hone se pehle har bill CURRENT schemes par re-calc + persist hoti hai —
      // isliye processed bill hamesha "us waqt ke latest scheme" par freeze hoti hai.
      // Unprocess → dobara process par purana snapshot NAHI, naya scheme lagta hai.
      for (const oid of processedOrderIds) {
        const o = orders.find((x) => x.id === oid)
        if (o) await persistLiveRecalc(o)
      }

      for (const o of seqOrders) {
        const ov = overrideByOrder.get(o.id)
        if (!ov) continue // skipped — ye bill CONFIRMED rehti hai (unprocessed)
        await fulfillOrder(o.id, ov)
      }
      await db.order.updateMany({
        where: { id: { in: processedOrderIds } },
        data: { status: 'PROCESSING' },
      })

      const processedOrders = orders.filter((o) => overrideByOrder.has(o.id))
      const subtotal = processedOrders.reduce((s, o) => s + o.total, 0)
      const seq = await nextSeq('summary')
      const summary = await db.deliverySummary.create({
        data: {
          summaryNo: `STM-${seq}`,
          salesmanId,
          warehouseId: wh.id,
          distributorId,
          orderDate: orders[0].orderDate,
          deliveryDate: deliveryDt,
          status: 'UNSETTLED',
          subtotal,
          notes: notes ?? null,
          orders: { connect: processedOrderIds.map((id) => ({ id })) },
        },
        include: { orders: true },
      })

      return Response.json({
        summary: {
          id: summary.id,
          summaryNo: summary.summaryNo,
          billsCount: summary.orders.length,
          subtotal: summary.subtotal,
          deliveryDate: new Date(summary.deliveryDate).toISOString(),
        },
        processAnyway: true,
        processedCount: processedOrderIds.length,
        skippedBills,
        shortRows,
      })
    }

    // ---- Task 86: PROCESS-TIME LIVE REFRESH ----
    // Fulfill se pehle har bill CURRENT schemes se re-calc + persist (snapshot refresh)
    // — process ke baad bill IN values par frozen (backend scheme badle to asar nahi).
    for (const o of orders) {
      await persistLiveRecalc(o)
    }

    // Fulfill every invoice (FEFO deduction + Delivery challan), then mark PROCESSING
    const warehouseId = wh.id
    for (const o of seqOrders) {
      await fulfillOrder(o.id)
    }
    await db.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { status: 'PROCESSING' },
    })

    const subtotal = orders.reduce((s, o) => s + o.total, 0)
    const seq = await nextSeq('summary')

    const summary = await db.deliverySummary.create({
      data: {
        summaryNo: `STM-${seq}`,
        salesmanId,
        warehouseId,
        distributorId,
        orderDate: orders[0].orderDate,
        deliveryDate: deliveryDt,
        status: 'UNSETTLED',
        subtotal,
        notes: notes ?? null,
        orders: { connect: orders.map((o) => ({ id: o.id })) },
      },
      include: { orders: true },
    })

    return Response.json({
      summary: {
        id: summary.id,
        summaryNo: summary.summaryNo,
        billsCount: summary.orders.length,
        subtotal: summary.subtotal,
        deliveryDate: new Date(summary.deliveryDate).toISOString(),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Summary process failed', 500)
  }
}
