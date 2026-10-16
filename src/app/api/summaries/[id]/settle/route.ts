import { db } from '@/lib/db'
import { jsonError, nextSeq } from '@/lib/dms-scope'
import { restockStock } from '@/lib/dms-inventory'

interface SettleReturnItem { productId: string; qty: number }
interface SettleReturn { reason?: string; items: SettleReturnItem[] }
interface SettleBody {
  userId?: string
  settlements: { orderId: string; cashAmount: number; notes?: string; return?: SettleReturn }[]
}

const RETURN_TYPES = ['UNSOLD', 'DAMAGED', 'EXPIRED']

/**
 * POST /api/summaries/[id]/settle — evening settlement of a delivery summary.
 * Per invoice: optional stock return (shop wapis karta hai) + cash vs udhaar. Effects:
 *  - SaleReturn (RET-, auto-APPROVED) + ReturnItems + restock into summary warehouse
 *  - SummarySettlement rows (CASH / PARTIAL / CREDIT per shop, returnAmount tracked)
 *  - OutletLedger: DEBIT invoice + CREDIT return (RETURN) + CREDIT cash received
 *  - Collection receipt for every cash payment
 *  - Orders -> DELIVERED, Summary -> SETTLED (cash/credit/returns totals + actor)
 * Whole posting runs in ONE transaction — crash par koi orphan data nahi bachta.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as SettleBody
    const { settlements } = body
    if (!settlements || !Array.isArray(settlements) || settlements.length === 0) {
      return jsonError('Settlement entries required hain')
    }

    const summary = await db.deliverySummary.findUnique({
      where: { id },
      include: { orders: { include: { outlet: true, items: true } } },
    })
    if (!summary) return jsonError('Summary not found', 404)
    if (summary.status === 'SETTLED') return jsonError('Ye summary pehle se settled hai')

    let actorName: string | null = null
    if (body.userId) {
      const actor = await db.user.findUnique({ where: { id: body.userId } })
      actorName = actor?.name ?? null
    }

    // Validate orders belong to this summary
    const orderMap = new Map(summary.orders.map((o) => [o.id, o]))
    for (const s of settlements) {
      if (!orderMap.has(s.orderId)) return jsonError(`Order summary ka hissa nahi hai: ${s.orderId}`)
    }

    const result = await db.$transaction(async (tx) => {
      let totalCash = 0
      let totalCredit = 0
      let totalReturns = 0
      let totalAdvTax = 0

      for (const s of settlements) {
        const order = orderMap.get(s.orderId)!
        const bill = order.total

        // ---- 0) Stock return (shop ne bill se item wapas kiya) ----
        let returnValue = 0
        let returnNo: string | null = null
        let returnReason = 'UNSOLD'
        const ret = s.return
        if (ret && Array.isArray(ret.items) && ret.items.some((it) => Number(it.qty) > 0)) {
          returnReason = RETURN_TYPES.includes(ret.reason ?? '') ? ret.reason! : 'UNSOLD'
          const itemMap = new Map(order.items.map((it) => [it.productId, it]))
          const lines: { productId: string; qty: number; rate: number; value: number }[] = []
          for (const ri of ret.items) {
            const qty = Math.max(0, Math.floor(Number(ri.qty) || 0))
            if (qty <= 0) continue
            const oi = itemMap.get(ri.productId)
            if (!oi) throw new Error(`Return item invoice ka hissa nahi hai`)
            if (qty > oi.qty) throw new Error(`Return qty bill qty se zyada nahi ho sakti (${oi.qty})`)
            // Task 63: value bill ke ACTUAL per-pc rate par (lineTotal/qty — scheme + manual
            // discount ke baad ka net). Trade price use karne par full return bill se ZYADA
            // credit karta tha => ledger/net MINUS. Ab full return EXACT bill jitna.
            // Task 63-b: lineTotal 0 (purane pre-Task 45 orders) par trade rate fallback.
            const effRate = oi.qty > 0 && oi.lineTotal > 0 ? oi.lineTotal / oi.qty : oi.rate
            const value = Math.round(qty * effRate * 100) / 100
            lines.push({ productId: ri.productId, qty, rate: effRate, value })
            returnValue += value
          }
          if (lines.length > 0) {
            returnValue = Math.round(returnValue * 100) / 100
            const seq = await nextSeq('return', tx)
            returnNo = `RET-${seq}`
            await tx.saleReturn.create({
              data: {
                returnNo,
                outletId: order.outletId,
                orderId: order.id,
                type: returnReason,
                status: 'APPROVED', // van ke saath goods physically wapas aa gaye — auto-approved
                totalValue: returnValue,
                reason: `Settlement return (${summary.summaryNo})`,
                items: { create: lines },
              },
            })
            // Restock into the summary's (van) warehouse
            for (const l of lines) {
              await restockStock(summary.warehouseId, l.productId, l.qty, `Settlement return ${returnNo} — ${order.orderNo}`, body.userId, tx)
            }
          }
        }

        // Advance Tax — booking par snapshot hua (bill total par). Task 29: RETURN par
        // PRO-RATA reversal — jitne % goods wapas aaye utna hi tax reverse hota hai
        // (warna returned goods par double taxation: ye bill + jis future bill par
        // ye goods dobara bikengi). Invoice DEBIT full tax rakhta hai; reversal RETURN
        // credit ke andar adjust hota hai => shop ka balance bilkul sahi banta hai.
        const advTaxFull = Math.round((order.advanceTax ?? 0) * 100) / 100
        // Cap: reversal kabhi bhi collected tax se zyada nahi (line values ka sum bill total
        // se discount ki wajah se zyada ho sakta hai — full return par poora tax wapas)
        const taxReversal = advTaxFull > 0 && bill > 0 && returnValue > 0
          ? Math.min(Math.round((advTaxFull * returnValue / bill) * 100) / 100, advTaxFull)
          : 0
        const advTax = Math.round((advTaxFull - taxReversal) * 100) / 100

        // Task 45: GST + Trade Offer — SAME pro-rata reversal pattern (advance tax jaisa).
        // GST return par wapas, Trade Offer return par wapas LETA hai (shop TO benefit
        // returned goods ka kho deta hai) — is liye return credit TO reversal se KAM hota hai.
        const gstFull = Math.round((order.gstTotal ?? 0) * 100) / 100
        const toFull = Math.round((order.tradeOfferTotal ?? 0) * 100) / 100
        const gstReversal = gstFull > 0 && bill > 0 && returnValue > 0
          ? Math.min(Math.round((gstFull * returnValue / bill) * 100) / 100, gstFull)
          : 0
        const toReversal = toFull > 0 && bill > 0 && returnValue > 0
          ? Math.min(Math.round((toFull * returnValue / bill) * 100) / 100, toFull)
          : 0
        const gstEff = Math.round((gstFull - gstReversal) * 100) / 100
        const toEff = Math.round((toFull - toReversal) * 100) / 100

        // Grand payable = goods − return + GST − trade offer + adv tax (booking chain jaisa)
        const netPayable = Math.round((bill - returnValue + gstEff - toEff + advTax) * 100) / 100
        const cash = Math.max(0, Math.min(Number(s.cashAmount) || 0, netPayable))
        const credit = Math.round((netPayable - cash) * 100) / 100
        const st = cash <= 0 ? 'CREDIT' : cash >= netPayable ? 'CASH' : 'PARTIAL'

        // 1) Settlement row
        await tx.summarySettlement.create({
          data: {
            summaryId: summary.id,
            outletId: order.outletId,
            orderId: order.id,
            billAmount: bill,
            returnAmount: returnValue,
            advanceTax: advTax,
            gstTotal: gstEff,
            tradeOfferTotal: toEff,
            cashAmount: cash,
            creditAmount: credit,
            status: st,
            notes: [s.notes ?? null, returnNo ? `Return ${returnNo}` : null].filter(Boolean).join(' • ') || null,
          },
        })

        // 2) Ledger: DEBIT invoice (full GST − full TO + full advance tax — invoice jaisi bani),
        //    CREDIT return value + tax/GST reversal − TO reversal, CREDIT cash received
        const debitAmount = Math.round((bill + gstFull - toFull + advTaxFull) * 100) / 100
        const debitNotes = [
          `Stock delivered (Summary ${summary.summaryNo})`,
          gstFull > 0 ? `GST Rs ${gstFull.toFixed(2)}` : null,
          toFull > 0 ? `Trade Offer Rs ${toFull.toFixed(2)}` : null,
          advTaxFull > 0 ? `Adv Tax Rs ${advTaxFull.toFixed(2)} added (${order.filerStatus === 'FILER' ? 'Filer' : 'Non-Filer'} ${order.advanceTaxRate ?? 0}%)` : null,
        ].filter(Boolean).join(' • ')
        await tx.outletLedger.create({
          data: {
            outletId: order.outletId,
            type: 'DEBIT',
            amount: debitAmount,
            refType: 'INVOICE',
            refNo: order.orderNo,
            note: debitNotes,
          },
        })
        if (returnValue > 0 && returnNo) {
          const returnCredit = Math.round((returnValue + gstReversal + taxReversal - toReversal) * 100) / 100
          const returnNotes = [
            `Stock return at settlement (${returnReason})`,
            taxReversal > 0 ? `Adv tax reversal Rs ${taxReversal.toFixed(2)}` : null,
            gstReversal > 0 ? `GST reversal Rs ${gstReversal.toFixed(2)}` : null,
            toReversal > 0 ? `Trade offer reversal Rs ${toReversal.toFixed(2)}` : null,
          ].filter(Boolean).join(' • ')
          await tx.outletLedger.create({
            data: {
              outletId: order.outletId,
              type: 'CREDIT',
              amount: Math.max(0, returnCredit),
              refType: 'RETURN',
              refNo: returnNo,
              note: returnNotes,
            },
          })
        }
        if (cash > 0) {
          await tx.outletLedger.create({
            data: {
              outletId: order.outletId,
              type: 'CREDIT',
              amount: cash,
              refType: 'CASH',
              refNo: summary.summaryNo,
              note: 'Cash received at settlement',
            },
          })
        }

        // 3) Collection receipt for the cash part
        if (cash > 0) {
          const seq = await nextSeq('receipt', tx)
          await tx.collection.create({
            data: {
              receiptNo: `RCP-${seq}`,
              outletId: order.outletId,
              amount: cash,
              method: 'CASH',
              collectedById: summary.salesmanId,
            },
          })
        }

        // 4) Invoice delivered
        await tx.order.update({ where: { id: order.id }, data: { status: 'DELIVERED' } })

        totalCash += cash
        totalCredit += credit
        totalReturns += returnValue
        totalAdvTax += advTax
      }

      return { totalCash, totalCredit, totalReturns, totalAdvTax }
    }, { timeout: 20000 })

    const updated = await db.deliverySummary.update({
      where: { id: summary.id },
      data: {
        status: 'SETTLED',
        settledCash: Math.round(result.totalCash * 100) / 100,
        settledCredit: Math.round(result.totalCredit * 100) / 100,
        settledReturns: Math.round(result.totalReturns * 100) / 100,
        settledAt: new Date(),
        settledByName: actorName,
      },
    })

    return Response.json({
      summary: {
        id: updated.id,
        summaryNo: updated.summaryNo,
        status: updated.status,
        settledCash: updated.settledCash,
        settledCredit: updated.settledCredit,
        settledReturns: updated.settledReturns,
      },
    })
  } catch (e) {
    console.error(e)
    const msg = e instanceof Error ? e.message : 'Settlement failed'
    return jsonError(msg.includes('hissa') || msg.includes('zyada') ? msg : 'Settlement failed', msg.includes('hissa') || msg.includes('zyada') ? 400 : 500)
  }
}
