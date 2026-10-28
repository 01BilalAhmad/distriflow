import type { Prisma } from '@prisma/client'
import {
  r2c,
  proRataReversals,
  returnCreditOf,
  splitReturnCredit,
  recalcSettlementRow,
} from './dms-return-core'
import { restockStock } from './dms-inventory'
import { postLedgerEntry, ledgerBase } from './dms-credit'

// ============================================================
// Task 101 — BILL-LINKED RETURN effects (ek hi transaction ke andar)
//
// POST /api/returns (distributor auto-approve), PATCH /api/returns/[id]
// (salesman PENDING approve) aur late-return route — teeno yehi effects
// lagate hain, is liye ek jagah:
//   1. Stock restock (van/summary warehouse, FEFO latest-expiry batch)
//   2. Pro-rata tax/GST/TO reversal (bill ke frozen snapshot se)
//   3. NO-MINUS split — ledger CREDIT sirf outstanding tak, bachi raqam
//      shop ke ADVANCE mein (Outlet.advanceBalance, hamesha positive)
//   4. SummarySettlement row recalc — creditAmount KABHI negative nahi
//   5. DeliverySummary totals (settledReturns/settledCredit exact delta se)
// ============================================================

export interface ApplyBillReturnOrder {
  id: string
  orderNo: string
  total: number
  advanceTax?: number | null
  gstTotal?: number | null
  tradeOfferTotal?: number | null
}

export interface ApplyBillReturnSt {
  id: string
  summaryId: string
  billAmount: number
  returnAmount: number
  advanceTax: number
  gstTotal: number
  tradeOfferTotal: number
  cashAmount: number
  notes: string | null
}

export interface ApplyBillReturnLine {
  productId: string
  qty: number
  rate: number
  value: number
}

export interface ApplyBillReturnArgs {
  returnId: string
  returnNo: string
  outletId: string
  order: ApplyBillReturnOrder
  st: ApplyBillReturnSt
  warehouseId: string
  lines: ApplyBillReturnLine[]
  userId?: string | null
  /** note prefix — "Late stock return after settlement (UNSOLD)" waghera */
  contextNote?: string
}

export interface BillReturnEffectResult {
  returnValue: number
  taxRev: number
  gstRev: number
  toRev: number
  totalCredit: number
  ledgerCredit: number
  advancePosted: number
  outstandingBefore: number
  newCreditAmount: number
  newStatus: string
}

/**
 * Approved bill-linked return ke saare ledger/stock/settlement effects.
 * LAZMI: caller ke db.$transaction ke andar chale — crash par koi orphan nahi.
 */
export async function applyBillReturnEffects(
  tx: Prisma.TransactionClient,
  args: ApplyBillReturnArgs,
): Promise<BillReturnEffectResult> {
  const { order, st } = args
  const returnValue = r2c(args.lines.reduce((t, l) => t + l.value, 0))

  // 1) Stock wapas summary (van) warehouse mein — FEFO latest-expiry batch
  for (const l of args.lines) {
    await restockStock(
      args.warehouseId,
      l.productId,
      l.qty,
      `Stock return ${args.returnNo} — ${order.orderNo}`,
      args.userId ?? null,
      tx,
    )
  }

  // 2) Pro-rata reversals — settlement row ki bachti raqam par capped (BILL FLOOR)
  const rev = proRataReversals(order, returnValue, {
    advanceTax: st.advanceTax,
    gstTotal: st.gstTotal,
    tradeOfferTotal: st.tradeOfferTotal,
  })
  const totalCredit = returnCreditOf(returnValue, rev)

  // 3) NO-MINUS split (SHOP FLOOR) — ledger credit outstanding tak,
  //    bachi raqam advance (positive). Balance kabhi minus nahi hota.
  const outstandingBefore = await ledgerBase(tx, args.outletId)
  const split = splitReturnCredit(totalCredit, outstandingBefore)

  if (split.ledgerCredit > 0.005) {
    await postLedgerEntry(tx, {
      outletId: args.outletId,
      type: 'CREDIT',
      amount: split.ledgerCredit,
      refType: 'RETURN',
      refNo: args.returnNo,
      note: [
        args.contextNote ?? 'Stock return',
        rev.taxRev > 0 ? `Adv tax reversal Rs ${rev.taxRev.toFixed(2)}` : null,
        rev.gstRev > 0 ? `GST reversal Rs ${rev.gstRev.toFixed(2)}` : null,
        rev.toRev > 0 ? `Trade offer reversal Rs ${rev.toRev.toFixed(2)}` : null,
        split.advancePosted > 0
          ? `Advance Rs ${split.advancePosted.toFixed(2)} — shop ke haq mein (agli bill se auto-adjust)`
          : null,
        `• ${order.orderNo}`,
      ].filter(Boolean).join(' • '),
    })
  }

  if (split.advancePosted > 0.005) {
    await tx.outlet.update({
      where: { id: args.outletId },
      data: { advanceBalance: { increment: split.advancePosted } },
    })
    await tx.saleReturn.update({
      where: { id: args.returnId },
      data: { advancePosted: split.advancePosted },
    })
  }

  // 4) Settlement row recalc — creditAmount clamp (no-minus) + notes
  const recalc = recalcSettlementRow(st, {
    returnValue,
    taxRev: rev.taxRev,
    gstRev: rev.gstRev,
    toRev: rev.toRev,
  })
  await tx.summarySettlement.update({
    where: { id: st.id },
    data: {
      returnAmount: recalc.returnAmount,
      advanceTax: recalc.advanceTax,
      gstTotal: recalc.gstTotal,
      tradeOfferTotal: recalc.tradeOfferTotal,
      creditAmount: recalc.creditAmount,
      status: recalc.status,
      notes: [st.notes, args.returnNo].filter(Boolean).join(' • '),
    },
  })

  // 5) Summary totals — EXACT delta (clamp ka asar included)
  await tx.deliverySummary.update({
    where: { id: st.summaryId },
    data: {
      settledReturns: { increment: returnValue },
      settledCredit: { increment: recalc.creditDelta },
    },
  })

  return {
    returnValue,
    taxRev: rev.taxRev,
    gstRev: rev.gstRev,
    toRev: rev.toRev,
    totalCredit,
    ledgerCredit: split.ledgerCredit,
    advancePosted: split.advancePosted,
    outstandingBefore,
    newCreditAmount: recalc.creditAmount,
    newStatus: recalc.status,
  }
}
