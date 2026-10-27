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
 * BULK APPROVE: { userId, ids: string[], action: 'APPROVE', reviewNote? }
 *   — har id apni transaction mein approve hoti hai (ek fail ho to baqi safe)
 *   — response: approved/failed counts + per-id results (UI summary toast ke liye)
 *
 * Role guard: DISTRIBUTOR (booker khud approve nahi kar sakta)
 * Scope: DISTRIBUTOR apni distributor ki shops ki recoveries
 * Over-collection guard: approve/edit dono par balance re-check (transaction ke andar — race-safe)
 */

const round2 = (n: number) => Math.round(n * 100) / 100

interface ApproveContext {
  id: string
  userId: string
  userName: string
  profileId: string
  note: string | null
  amountOverride?: number
}

/**
 * Ek recovery ka APPROVE — shared by single + bulk path.
 * Har step apni transaction mein: balance re-check race-safe.
 * Throws on: entry missing / scope bahar / already processed / over-collect.
 */
async function approveRecovery(ctx: ApproveContext): Promise<{ recoveryNo: string; receiptNo: string; amount: number; outletName: string }> {
  const recovery = await db.recovery.findUnique({
    where: { id: ctx.id },
    include: { outlet: { select: { id: true, name: true, code: true, distributorId: true } } },
  })
  if (!recovery) throw new Error('Recovery entry nahi mili')
  // Scope guard — shop reviewer ke scope mein honi chahiye
  if (recovery.outlet.distributorId !== ctx.profileId) throw new Error('Yeh recovery aap ke scope mein nahi hai')
  if (recovery.status !== 'PENDING') throw new Error('Sirf pending recoveries approve ho sakti hain')

  const approveAmt = ctx.amountOverride != null ? round2(Number(ctx.amountOverride)) : recovery.amount
  if (!(approveAmt > 0)) throw new Error('Amount 0 se bara hona chahiye')

  const result = await db.$transaction(async (tx) => {
    const deb = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'DEBIT' }, _sum: { amount: true } })
    const cre = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'CREDIT' }, _sum: { amount: true } })
    const balance = round2((deb._sum.amount ?? 0) - (cre._sum.amount ?? 0))
    if (approveAmt > balance + 0.005) {
      throw new Error(`Shop ${recovery.outlet.name} ka udhaar sirf Rs ${balance.toFixed(2)} hai — Rs ${approveAmt.toFixed(2)} approve nahi hoga`)
    }

    // 1) Recovery APPROVED (amount edit hua to original preserve hota hai)
    await tx.recovery.update({
      where: { id: recovery.id },
      data: {
        status: 'APPROVED',
        amount: approveAmt,
        originalAmount: ctx.amountOverride != null && approveAmt !== recovery.amount
          ? (recovery.originalAmount ?? recovery.amount)
          : recovery.originalAmount,
        editedAmount: ctx.amountOverride != null && approveAmt !== recovery.amount ? true : recovery.editedAmount,
        approvedById: ctx.userId,
        approvedByName: ctx.userName,
        approvedAt: new Date(),
        reviewNote: ctx.note,
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
        note: `Udhaar wasooli (${recovery.method}${recovery.reference ? ` • Ref ${recovery.reference}` : ''}) — approved by ${ctx.userName}`,
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

  return { recoveryNo: recovery.recoveryNo, receiptNo: result.receiptNo, amount: approveAmt, outletName: recovery.outlet.name }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, id, action, amount, reviewNote, ids } = body as {
      userId: string
      id?: string
      action: 'APPROVE' | 'REJECT' | 'EDIT'
      amount?: number
      reviewNote?: string
      ids?: string[]
    }
    if (!userId || !action) return jsonError('userId aur action required hain')
    if (!['APPROVE', 'REJECT', 'EDIT'].includes(action)) return jsonError('Action valid nahi hai')

    const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!me) return jsonError('User not found', 404)
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role === 'SALESMAN') return jsonError('Order booker approval nahi kar sakta — sirf distributor', 403)
    const note = (reviewNote ?? '').trim() || null

    // ---------- BULK APPROVE (ids[]) — har entry apni transaction mein, ek fail = baqi safe ----------
    if (Array.isArray(ids)) {
      if (action !== 'APPROVE') return jsonError('Bulk action sirf APPROVE ke liye hai — reject/edit ek ek kar ke')
      const cleanIds = ids.filter((v): v is string => typeof v === 'string' && !!v).slice(0, 100) // safety cap
      if (cleanIds.length === 0) return jsonError('Bulk approve ke liye kam az kam ek entry chahiye')

      const results: Array<{ id: string; ok: boolean; message: string }> = []
      for (const rid of cleanIds) {
        try {
          const done = await approveRecovery({ id: rid, userId: me.id, userName: me.name, profileId: me.profile!.id, note })
          results.push({ id: rid, ok: true, message: `${done.recoveryNo} approve — Rs ${done.amount.toFixed(2)} (${done.outletName})` })
        } catch (err) {
          results.push({ id: rid, ok: false, message: err instanceof Error ? err.message : 'Approve failed' })
        }
      }
      const approved = results.filter((r) => r.ok)
      const failed = results.filter((r) => !r.ok)
      return Response.json({
        ok: failed.length === 0,
        bulk: true,
        approvedCount: approved.length,
        failedCount: failed.length,
        results,
        message: `${approved.length} approve ho gayi${failed.length ? `, ${failed.length} fail (neeche wajah dekhein)` : ''}`,
      })
    }

    // ---------- SINGLE ACTION ----------
    if (!id) return jsonError('id required hai (ya bulk ke liye ids[])')
    const recovery = await db.recovery.findUnique({
      where: { id },
      include: { outlet: { select: { id: true, name: true, code: true, distributorId: true } } },
    })
    if (!recovery) return jsonError('Recovery entry nahi mili', 404)

    // Scope guard — shop reviewer ke scope mein honi chahiye
    if (recovery.outlet.distributorId !== me.profile!.id) {
      return jsonError('Yeh recovery aap ke scope mein nahi hai', 403)
    }

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

    // ---------- APPROVE (single) — shared logic reuse ----------
    try {
      const done = await approveRecovery({ id, userId: me.id, userName: me.name, profileId: me.profile!.id, note, amountOverride: amount })
      return Response.json({
        ok: true,
        status: 'APPROVED',
        amount: done.amount,
        receiptNo: done.receiptNo,
        message: `${done.recoveryNo} approve ho gayi — Rs ${done.amount.toFixed(2)} shop ledger mein CREDIT, receipt ${done.receiptNo}`,
      })
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Approve failed', 400)
    }
  } catch (e) {
    console.error(e)
    return jsonError(e instanceof Error ? e.message : 'Review action failed', 400)
  }
}
