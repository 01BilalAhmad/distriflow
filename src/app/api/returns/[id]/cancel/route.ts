import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { postLedgerEntry } from '@/lib/dms-credit'
import { recalcSettlementRow, restockEligible } from '@/lib/dms-return-core'

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * POST /api/returns/[id]/cancel — Task 64: galti se laga hua stock return WAPAS lena (undo).
 *
 * Effects (ONE transaction):
 *  - SaleReturn.status -> CANCELLED (record history ke liye rehta hai)
 *  - Stock reverse: restock ka ulta — van warehouse ki latest-expiry batch se qty minus
 *    + StockAdjustment OUT row (inventory page par movement dikhta hai)
 *  - OutletLedger: DEBIT 'RETURN_CANCEL' — original RETURN credit ka exact inverse,
 *    shop balance wapas bill wali state par
 *  - SummarySettlement: returnAmount - v, advanceTax/gstTotal/tradeOfferTotal + pro-rata
 *    undo, creditAmount/status recalc
 *  - DeliverySummary: settledReturns - v, settledCredit + delta
 *
 * Rule: sirf LATEST approved return undo ho sakta hai (beech ke returns pehle undo karo) —
 * warna pro-rata tax/GST undo amounts non-deterministic ho jate.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    if (user.role === 'SALESMAN') return jsonError('Salesman return cancel nahi kar sakta — distributor se karein')
    if (user.role === 'MEGA_ADMIN') return jsonError('Tenant data scope nahi')

    const ret = await db.saleReturn.findUnique({
      where: { id },
      include: { items: true, outlet: true, order: { include: { items: true } } },
    })
    if (!ret) return jsonError('Return not found', 404)
    if (ret.status !== 'APPROVED') return jsonError('Ye return already cancelled/rejected hai')
    const orderId: string | null = ret.orderId
    const v = round2(ret.totalValue)

    // Tenant scope — return usi distributor ka hona chahiye jo login hai
    if (!user.profile || ret.outlet.distributorId !== user.profile.id) {
      return jsonError('Ye return aap ke scope mein nahi hai', 403)
    }

    // ---------------- Task 29: STANDALONE return UNDO (simple path) ----------------
    // User: "kabhi galti sy category galat select ho jay aur entry kr di to masla ban
    // jayega" — standalone APPROVED return par effects sirf restock (UNSOLD) tha, is
    // liye undo simple hai: status CANCELLED + stock wapas nikalna (UNSOLD hi).
    if (!orderId || !ret.order) {
      const wh = restockEligible(ret.type)
        ? await db.warehouse.findFirst({
            where: { distributorId: ret.outlet.distributorId },
            orderBy: [{ isPrimary: 'desc' }],
          })
        : null
      await db.$transaction(async (tx) => {
        await tx.saleReturn.update({
          where: { id: ret.id },
          data: { status: 'CANCELLED', reason: `${ret.reason ?? ''} — cancelled (ghalti se return thi, wapas liya)`.trim() },
        })
        if (wh) {
          for (const it of ret.items) {
            const batch = await tx.stockBatch.findFirst({
              where: { warehouseId: wh.id, productId: it.productId },
              orderBy: [{ expDate: 'desc' }, { receivedAt: 'desc' }],
            })
            if (batch) {
              await tx.stockBatch.update({ where: { id: batch.id }, data: { qty: Math.max(0, batch.qty - it.qty) } })
            }
            await tx.stockAdjustment.create({
              data: { warehouseId: wh.id, productId: it.productId, type: 'OUT', qty: it.qty, reason: `Return cancel ${ret.returnNo} — UNSOLD wapas nikala`, userId: user.id },
            })
          }
        }
      })
      return Response.json({
        result: {
          returnNo: ret.returnNo,
          cancelledValue: v,
          orderNo: null,
          outletName: ret.outlet.name,
          standalone: true,
        },
      })
    }

    const order = ret.order

    // Sirf latest approved return undo ho sakta hai
    const approved = await db.saleReturn.findMany({
      where: { orderId, status: 'APPROVED' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    if (approved[0]?.id !== ret.id) {
      return jsonError('Sirf is bill ka sab se naya return undo ho sakta hai — pehle baad wale returns undo karein')
    }

    const summary = await db.deliverySummary.findFirst({ where: { orders: { some: { id: orderId } } } })
    if (!summary) return jsonError('Is return ki summary nahi mili', 404)
    // Task 101: settlement row lazmi — recalc (clamped credit) isi par hota hai
    const st = await db.summarySettlement.findFirst({ where: { summaryId: summary.id, orderId } })
    if (!st) return jsonError('Is return ki settlement row nahi mili', 404)

    const result = await db.$transaction(async (tx) => {
      // 1) Return record cancel — history mein rehta hai
      await tx.saleReturn.update({
        where: { id: ret.id },
        data: { status: 'CANCELLED', reason: `${ret.reason ?? ''} — cancelled (ghalti se return tha, wapas liya)`.trim() },
      })

      // 2) Stock reverse — restock ka ulta (latest-expiry batch se minus + OUT adjustment)
      //    Task 29: sirf UNSOLD par — DAMAGED/EXPIRED kabhi restock hue hi nahi (category-gated)
      if (restockEligible(ret.type)) {
        for (const it of ret.items) {
          const batch = await tx.stockBatch.findFirst({
            where: { warehouseId: summary.warehouseId, productId: it.productId },
            orderBy: [{ expDate: 'desc' }, { receivedAt: 'desc' }],
          })
          if (batch) {
            await tx.stockBatch.update({ where: { id: batch.id }, data: { qty: Math.max(0, batch.qty - it.qty) } })
          }
          await tx.stockAdjustment.create({
            data: { warehouseId: summary.warehouseId, productId: it.productId, type: 'OUT', qty: it.qty, reason: `Return cancel ${ret.returnNo} — ${order.orderNo}`, userId: user.id },
          })
        }
      }

      // 3) Pro-rata undo amounts — usi formula se jo return ne lagaya tha (full % of bill)
      const taxRev = order.advanceTax > 0 && order.total > 0 ? Math.min(round2(order.advanceTax * v / order.total), order.advanceTax) : 0
      const gstRev = (order.gstTotal ?? 0) > 0 && order.total > 0 ? Math.min(round2((order.gstTotal ?? 0) * v / order.total), order.gstTotal ?? 0) : 0
      const toRev = (order.tradeOfferTotal ?? 0) > 0 && order.total > 0 ? Math.min(round2((order.tradeOfferTotal ?? 0) * v / order.total), order.tradeOfferTotal ?? 0) : 0

      // Task 101: ADVANCE reversal — is return ka jo advance abhi tak un-consumed bacha
      // hai wo wapas hata do (shop ka faida khatam). Jo hissa ALREADY kharch ho chuka hai
      // (agli bill se adjust ho gaya) wo ledger DEBIT se wapas aata hai — shop ne faida
      // le liya tha, return undo par wo udhaar ban jata hai.
      const advanceRemaining = Math.max(0, round2(ret.advancePosted - ret.advanceConsumed))
      if (advanceRemaining > 0.005) {
        const outletRow = await tx.outlet.findUnique({ where: { id: ret.outletId }, select: { advanceBalance: true } })
        await tx.outlet.update({
          where: { id: ret.outletId },
          data: { advanceBalance: Math.max(0, round2((outletRow?.advanceBalance ?? 0) - advanceRemaining)) },
        })
      }

      // 4) Settlement row recalc — return ke pehle wali state par wapas
      // Task 101: recalcSettlementRow — creditAmount clamp (kabhi negative nahi) + exact delta
      const recalc = recalcSettlementRow(
        st,
        { returnValue: -v, taxRev: -taxRev, gstRev: -gstRev, toRev: -toRev },
      )
      const delta = recalc.creditDelta
      await tx.summarySettlement.update({
        where: { id: st.id },
        data: {
          returnAmount: recalc.returnAmount,
          advanceTax: recalc.advanceTax,
          gstTotal: recalc.gstTotal,
          tradeOfferTotal: recalc.tradeOfferTotal,
          creditAmount: recalc.creditAmount,
          status: recalc.status,
          notes: [st.notes, `${ret.returnNo} cancelled`].filter(Boolean).join(' • '),
        },
      })

      // 5) Ledger — original RETURN credit ka exact inverse (DEBIT) — Task 98:
      // postLedgerEntry (balanceAfter + Outlet.balance transactional update)
      // Task 101: advance ka hissa bhi — un-consumed advance ledger par tha hi nahi
      // (skip hua tha), consumed hissa (agli bill se adjust) DEBIT se wapas aata hai
      const ledgerAmount = Math.max(0, round2(v + taxRev + gstRev - toRev - ret.advancePosted + ret.advanceConsumed))
      await postLedgerEntry(tx, {
        outletId: ret.outletId,
        type: 'DEBIT',
        amount: ledgerAmount,
        refType: 'RETURN_CANCEL',
        refNo: ret.returnNo,
        note: [
          `Return cancelled — ghalti se return tha, stock + shop balance wapas • ${order.orderNo}`,
          ret.advanceConsumed > 0 ? `Advance wapas Rs ${round2(ret.advanceConsumed).toFixed(2)} (udhaar bana)` : null,
        ].filter(Boolean).join(' • '),
      })

      // 6) Summary totals
      const updated = await tx.deliverySummary.update({
        where: { id: summary.id },
        data: {
          settledReturns: round2(Math.max(0, summary.settledReturns - v)),
          settledCredit: round2(summary.settledCredit + delta),
        },
      })

      return { ledgerAmount, settledReturns: updated.settledReturns, settledCredit: updated.settledCredit }
    }, { timeout: 20000 })

    // Task 35: RETURN_CANCEL — undo ka record (kitna stock/ledger wapas)
    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId: ret.outlet.distributorId },
      'RETURN_CANCEL',
      { req, entity: 'SaleReturn', entityId: ret.id, detail: `${ret.returnNo} CANCEL (undo) — Rs ${v} wapas, ledger Rs ${result.ledgerAmount} adjust` },
    )

    return Response.json({
      result: {
        returnNo: ret.returnNo,
        cancelledValue: v,
        orderNo: order.orderNo,
        outletName: ret.outlet.name,
        ledgerAmount: result.ledgerAmount,
        settledReturns: result.settledReturns,
        settledCredit: result.settledCredit,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Return cancel failed', 500)
  }
}
