import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'

/**
 * RECOVERY REVIEW — pending recoveries ka approval workflow.
 *
 * POST /api/recovery/review { userId, id, action, amount?, reviewNote? }
 *   action = APPROVE : Recovery APPROVED + OutletLedger CREDIT (RECOVERY) + Collection receipt (RCP-)
 *                      — ledger transaction ke andar banti hai (sirf approve par hi shop ledger update hota hai)
 *   action = REJECT  : Recovery REJECTED — ledger bilkul nahi chedti
 *   action = EDIT    : amount update (sirf PENDING par) — originalAmount audit ke liye preserve
 *
 * Role guard: DISTRIBUTOR (booker khud approve nahi kar sakta)
 * Scope: DISTRIBUTOR apni distributor ki shops ki recoveries
 * Over-collection guard: approve/edit dono par balance re-check (transaction ke andar — race-safe)
 */

const round2 = (n: number) => Math.round(n * 100) / 100

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, id, action, amount, reviewNote } = body as {
      userId: string
      id: string
      action: 'APPROVE' | 'REJECT' | 'EDIT'
      amount?: number
      reviewNote?: string
    }
    if (!userId || !id || !action) return jsonError('userId, id aur action required hain')
    if (!['APPROVE', 'REJECT', 'EDIT'].includes(action)) return jsonError('Action valid nahi hai')

    const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!me) return jsonError('User not found', 404)
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role === 'SALESMAN') return jsonError('Order booker approval nahi kar sakta — sirf distributor', 403)

    const recovery = await db.recovery.findUnique({
      where: { id },
      include: { outlet: { select: { id: true, name: true, code: true, distributorId: true } } },
    })
    if (!recovery) return jsonError('Recovery entry nahi mili', 404)

    // Scope guard — shop reviewer ke scope mein honi chahiye
    if (recovery.outlet.distributorId !== me.profile!.id) {
      return jsonError('Yeh recovery aap ke scope mein nahi hai', 403)
    }

    const note = (reviewNote ?? '').trim() || null

    // ---------- REJECT ----------
    if (action === 'REJECT') {
      if (recovery.status !== 'PENDING') return jsonError('Sirf pending recoveries reject ho sakti hain')
      await db.recovery.update({
        where: { id },
        data: { status: 'REJECTED', approvedById: me.id, approvedByName: me.name, approvedAt: new Date(), reviewNote: note },
      })
      return Response.json({ ok: true, status: 'REJECTED', message: `Recovery ${recovery.recoveryNo} reject ho gayi — shop ledger update nahi hua` })
    }

    // ---------- EDIT (amount only, PENDING par) ----------
    if (action === 'EDIT') {
      if (recovery.status !== 'PENDING') return jsonError('Sirf pending recovery ka amount edit ho sakta hai — approved entry ledger mein ja chuki hai')
      const amt = round2(Number(amount))
      if (!(amt > 0)) return jsonError('Amount 0 se bara hona chahiye')

      const updated = await db.$transaction(async (tx) => {
        const deb = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'DEBIT' }, _sum: { amount: true } })
        const cre = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'CREDIT' }, _sum: { amount: true } })
        const balance = round2((deb._sum.amount ?? 0) - (cre._sum.amount ?? 0))
        if (amt > balance + 0.005) {
          throw new Error(`Shop ${recovery.outlet.name} ka udhaar sirf Rs ${balance.toFixed(2)} hai — amount Rs ${amt.toFixed(2)} save nahi hoga`)
        }
        return tx.recovery.update({
          where: { id },
          data: {
            amount: amt,
            originalAmount: recovery.originalAmount ?? recovery.amount, // pehli edit par booker ki asli entry save
            editedAmount: recovery.originalAmount != null ? recovery.editedAmount : true,
            reviewNote: note,
          },
        })
      }, { timeout: 15000 })

      return Response.json({ ok: true, status: 'PENDING', amount: updated.amount, originalAmount: updated.originalAmount, message: `${recovery.recoveryNo} ka amount Rs ${amt.toFixed(2)} ho gaya — ab Approve dabayein` })
    }

    // ---------- APPROVE ----------
    if (recovery.status !== 'PENDING') return jsonError('Sirf pending recoveries approve ho sakti hain')
    const approveAmt = amount != null ? round2(Number(amount)) : recovery.amount
    if (!(approveAmt > 0)) return jsonError('Amount 0 se bara hona chahiye')

    const result = await db.$transaction(async (tx) => {
      const deb = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'DEBIT' }, _sum: { amount: true } })
      const cre = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'CREDIT' }, _sum: { amount: true } })
      const balance = round2((deb._sum.amount ?? 0) - (cre._sum.amount ?? 0))
      if (approveAmt > balance + 0.005) {
        throw new Error(`Shop ${recovery.outlet.name} ka udhaar sirf Rs ${balance.toFixed(2)} hai — Rs ${approveAmt.toFixed(2)} approve nahi hoga`)
      }

      // 1) Recovery APPROVED (amount edit hua to original preserve hota hai)
      await tx.recovery.update({
        where: { id },
        data: {
          status: 'APPROVED',
          amount: approveAmt,
          originalAmount: amount != null && approveAmt !== recovery.amount
            ? (recovery.originalAmount ?? recovery.amount)
            : recovery.originalAmount,
          editedAmount: amount != null && approveAmt !== recovery.amount ? true : recovery.editedAmount,
          approvedById: me.id,
          approvedByName: me.name,
          approvedAt: new Date(),
          reviewNote: note,
        },
      })

      // 2) Shop ledger CREDIT (RECOVERY) — ab shop ka balance kam hota hai
      await tx.outletLedger.create({
        data: {
          outletId: recovery.outlet.id,
          type: 'CREDIT',
          amount: approveAmt,
          refType: 'RECOVERY',
          refNo: recovery.recoveryNo,
          note: `Udhaar wasooli (${recovery.method}${recovery.reference ? ` • Ref ${recovery.reference}` : ''}) — approved by ${me.name}`,
        },
      })

      // 3) Collection receipt (RCP-) — cash record complete
      const cSeq = await nextSeq('receipt', tx)
      const receiptNo = `RCP-${cSeq}`
      await tx.collection.create({
        data: {
          receiptNo,
          outletId: recovery.outlet.id,
          amount: approveAmt,
          method: recovery.method,
          collectedById: recovery.bookerId,
        },
      })

      return { receiptNo }
    }, { timeout: 20000 })

    return Response.json({
      ok: true,
      status: 'APPROVED',
      amount: approveAmt,
      receiptNo: result.receiptNo,
      message: `${recovery.recoveryNo} approve ho gayi — Rs ${approveAmt.toFixed(2)} shop ledger mein CREDIT, receipt ${result.receiptNo}`,
    })
  } catch (e) {
    console.error(e)
    return jsonError(e instanceof Error ? e.message : 'Review action failed', 400)
  }
}
