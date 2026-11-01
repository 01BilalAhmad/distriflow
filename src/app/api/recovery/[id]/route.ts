import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { postLedgerEntry } from '@/lib/dms-credit'
import { audit } from '@/lib/audit'

// Task 133 — RECOVERY TRANSACTION FIX: galti se post/approve hui wasooli ko theek karne
// ke liye history page ke do actions (distributor-only — yehi admin hai):
//
// PATCH /api/recovery/[id]  { amount, reason? }  — AMOUNT EDIT
//   - PENDING  → plain update (review EDIT jaisa; ledger abhi post nahi hui)
//   - APPROVED → ledger CORRECTION: delta (new − old) ki postLedgerEntry
//       delta > 0 → CREDIT RECOVERY_EDIT (mazeed wasooli adjust)
//       delta < 0 → DEBIT  RECOVERY_EDIT (zyada le li thi — wapas udhaar barhao)
//     + RCP receipt amount update + originalAmount preserve + balance guard
//   - REJECTED/DELETED → 400 (edit nahi hoti)
//
// DELETE /api/recovery/[id]  { reason? }  — DELETE (pattern: returns cancel, Task 64)
//   - APPROVED → ONE transaction mein:
//       1) postLedgerEntry DEBIT 'RECOVERY_CANCEL' (original CREDIT ka exact inverse —
//          shop ka balance wapas pehli wali state par)
//       2) RCP receipt delete (day-book Cash-In theek rehta hai)
//       3) Recovery.status → 'DELETED' (record history ke liye rehta hai — hard delete nahi)
//   - PENDING/REJECTED → sirf status DELETED (ledger/receipt thi hi nahi)
//   - Har case mein RECOVERY_DELETE audit row (kis ne, kitni, kyun)
//
// Legacy note: receiptNo column se pehle approve hui entries ka RCP link null ho sakta
// hai — us soorat mein same shop+amount+method±10min window se receipt dhoonda jata hai.

const round2 = (n: number) => Math.round(n * 100) / 100

const LEGACY_RECEIPT_WINDOW_MS = 10 * 60 * 1000

async function loadScopedRecovery(id: string) {
  return db.recovery.findUnique({
    where: { id },
    include: { outlet: { select: { id: true, name: true, code: true, distributorId: true } } },
  })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor recovery transaction edit kar sakta hai', 403)

    const body = await req.json().catch(() => ({}))
    const amount = round2(Number(body?.amount))
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 300) : ''
    if (!(amount > 0)) return jsonError('Amount 0 se bara hona chahiye')

    const recovery = await loadScopedRecovery(id)
    if (!recovery) return jsonError('Recovery transaction nahi mili', 404)
    if (!me.profile || recovery.outlet.distributorId !== me.profile.id) return jsonError('Ye transaction aap ke scope mein nahi hai', 403)
    if (recovery.status === 'DELETED') return jsonError('Ye transaction delete ho chuki hai — edit nahi ho sakti', 400)
    if (recovery.status === 'REJECTED') return jsonError('Reject hui entry edit nahi hoti — usay delete karein', 400)

    const oldAmt = round2(recovery.amount)
    if (amount === oldAmt) return jsonError('Nayi amount purani jaisi hai — koi tabdeeli nahi')

    const actor = { id: me.id, name: me.name, role: me.role, tenantId: recovery.outlet.distributorId }

    // ---------- PENDING: ledger abhi post nahi hui — plain update (review EDIT jaisa) ----------
    if (recovery.status === 'PENDING') {
      await db.recovery.update({
        where: { id },
        data: {
          amount,
          originalAmount: recovery.originalAmount ?? oldAmt,
          editedAmount: true,
          reviewNote: reason || recovery.reviewNote,
        },
      })
      await audit(actor, 'RECOVERY_EDIT', {
        req,
        entity: 'Recovery',
        entityId: recovery.recoveryNo,
        detail: `${recovery.recoveryNo} • ${recovery.outlet.name} • Rs ${oldAmt.toFixed(2)} → Rs ${amount.toFixed(2)} (PENDING edit — history page)${reason ? ` • Wajah: ${reason}` : ''}`,
      })
      return Response.json({ ok: true, amount, message: `${recovery.recoveryNo} amount Rs ${oldAmt.toFixed(2)} → Rs ${amount.toFixed(2)} update ho gaya` })
    }

    // ---------- APPROVED: ledger correction (delta) + receipt update ----------
    const result = await db.$transaction(async (tx) => {
      const delta = round2(amount - oldAmt)
      if (delta > 0) {
        // Credit barhana = shop ka aur udhaar kam karna — outstanding se ziada nahi
        const deb = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'DEBIT' }, _sum: { amount: true } })
        const cre = await tx.outletLedger.aggregate({ where: { outletId: recovery.outlet.id, type: 'CREDIT' }, _sum: { amount: true } })
        const balance = round2((deb._sum.amount ?? 0) - (cre._sum.amount ?? 0))
        if (delta > balance + 0.005) {
          throw new Error(`Shop ${recovery.outlet.name} ka udhaar sirf Rs ${balance.toFixed(2)} hai — Rs ${amount.toFixed(2)} tak barhana mumkin nahi`)
        }
      }
      // Ledger correction entry (delta) — RECOVERY_EDIT refType history mein alag nazar aata hai
      await postLedgerEntry(tx, {
        outletId: recovery.outlet.id,
        type: delta > 0 ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(delta),
        refType: 'RECOVERY_EDIT',
        refNo: recovery.recoveryNo,
        note: `Amount correction — Rs ${oldAmt.toFixed(2)} → Rs ${amount.toFixed(2)}${reason ? ` (${reason})` : ''}`,
      })
      // RCP receipt amount bhi actual par lao (day-book Cash-In isi se banta hai)
      let receiptFixed = false
      if (recovery.receiptNo) {
        const r = await tx.collection.updateMany({ where: { receiptNo: recovery.receiptNo }, data: { amount } })
        receiptFixed = r.count > 0
      }
      await tx.recovery.update({
        where: { id },
        data: {
          amount,
          originalAmount: recovery.originalAmount ?? oldAmt,
          editedAmount: true,
          reviewNote: reason || recovery.reviewNote,
        },
      })
      return { delta, receiptFixed }
    }, { timeout: 20000 })

    await audit(actor, 'RECOVERY_EDIT', {
      req,
      entity: 'Recovery',
      entityId: recovery.recoveryNo,
      detail: `${recovery.recoveryNo} • ${recovery.outlet.name} • APPROVED edit Rs ${oldAmt.toFixed(2)} → Rs ${amount.toFixed(2)} (delta ${result.delta > 0 ? 'CREDIT' : 'DEBIT'} Rs ${Math.abs(result.delta).toFixed(2)} ledger)${result.receiptFixed ? ' • Receipt updated' : ''}${reason ? ` • Wajah: ${reason}` : ''}`,
    })

    return Response.json({
      ok: true,
      amount,
      message: `${recovery.recoveryNo} Rs ${oldAmt.toFixed(2)} → Rs ${amount.toFixed(2)} — ledger correction (${result.delta > 0 ? 'CREDIT' : 'DEBIT'} Rs ${Math.abs(result.delta).toFixed(2)}) post ho gayi`,
    })
  } catch (e) {
    if (e instanceof Error && e.message.includes('udhaar sirf')) return jsonError(e.message, 400)
    console.error(e)
    return jsonError('Recovery edit failed', 500)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor recovery transaction delete kar sakta hai', 403)

    // reason JSON body ya ?reason= dono se aa sakta hai (DELETE body kabhi-kabhi strip hota hai)
    const body = await req.json().catch(() => ({}))
    const reason = (typeof body?.reason === 'string' && body.reason.trim())
      || new URL(req.url).searchParams.get('reason')?.trim()
      || ''

    const recovery = await loadScopedRecovery(id)
    if (!recovery) return jsonError('Recovery transaction nahi mili', 404)
    if (!me.profile || recovery.outlet.distributorId !== me.profile.id) return jsonError('Ye transaction aap ke scope mein nahi hai', 403)
    if (recovery.status === 'DELETED') return jsonError('Ye transaction pehle se delete ho chuki hai', 400)

    const actor = { id: me.id, name: me.name, role: me.role, tenantId: recovery.outlet.distributorId }
    const wasApproved = recovery.status === 'APPROVED'
    const amt = round2(recovery.amount)

    const result = await db.$transaction(async (tx) => {
      let ledgerReversed = false
      let receiptDeleted = 0

      if (wasApproved) {
        // 1) Original CREDIT ka exact inverse — shop balance wapas pehli state par
        await postLedgerEntry(tx, {
          outletId: recovery.outlet.id,
          type: 'DEBIT',
          amount: amt,
          refType: 'RECOVERY_CANCEL',
          refNo: recovery.recoveryNo,
          note: `Recovery delete (ghalti se entry thi) — Rs ${amt.toFixed(2)} wapas udhaar mein${reason ? ` • Wajah: ${reason}` : ''}`,
        })
        ledgerReversed = true

        // 2) RCP receipt void — day-book Cash-In dobara theek ho jata hai
        if (recovery.receiptNo) {
          receiptDeleted = (await tx.collection.deleteMany({ where: { receiptNo: recovery.receiptNo } })).count
        } else {
          // Legacy (receiptNo column se pehle) — same shop+amount+method, approval/post ke ±10 min window
          const anchor = recovery.approvedAt ?? recovery.recoveredAt
          const legacy = await tx.collection.findFirst({
            where: {
              outletId: recovery.outlet.id,
              amount: amt,
              method: recovery.method,
              ...(recovery.bookerId ? { collectedById: recovery.bookerId } : {}),
              date: { gte: new Date(anchor.getTime() - LEGACY_RECEIPT_WINDOW_MS), lte: new Date(anchor.getTime() + LEGACY_RECEIPT_WINDOW_MS) },
            },
            orderBy: { date: 'asc' },
            select: { id: true },
          })
          if (legacy) receiptDeleted = (await tx.collection.deleteMany({ where: { id: legacy.id } })).count
        }
      }

      // 3) Record history ke liye rehta hai (hard delete nahi) — audit trail + Transactions tab badge
      await tx.recovery.update({
        where: { id },
        data: {
          status: 'DELETED',
          reviewNote: `DELETED${reason ? `: ${reason}` : ''} — ${me.name} ne (${new Date().toISOString().slice(0, 10)})`,
        },
      })

      return { ledgerReversed, receiptDeleted }
    }, { timeout: 20000 })

    await audit(actor, 'RECOVERY_DELETE', {
      req,
      entity: 'Recovery',
      entityId: recovery.recoveryNo,
      detail: `${recovery.recoveryNo} • ${recovery.outlet.name} • Rs ${amt.toFixed(2)} • ${recovery.method} • status ${recovery.status} → DELETED${result.ledgerReversed ? ' • Ledger DEBIT (RECOVERY_CANCEL) reverse' : ''}${result.receiptDeleted ? ' • Receipt void' : ''}${reason ? ` • Wajah: ${reason}` : ''}`,
    })

    return Response.json({
      ok: true,
      message: `${recovery.recoveryNo} delete ho gayi${result.ledgerReversed ? ` — Rs ${amt.toFixed(2)} shop ledger mein wapas (RECOVERY_CANCEL)` : ''}${result.receiptDeleted ? ', receipt void' : ''}`,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Recovery delete failed', 500)
  }
}
