import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'

/**
 * RECOVERY — order-booker wise udhaar wasooli.
 *
 * GET  /api/recovery?userId=&bookerId=
 *   - bookers: scoped order bookers + route stats (shops, pending udhaar, recovery today/month/total)
 *   - bookerId param ho to us bucket ki shops list (outstanding balance ke sath, sirf pending)
 *   - pending: PENDING recoveries (admin approval ka intezar — ledger abhi update NAHI hui)
 *   - history: recent recovery vouchers (RCV-) with status
 *
 * POST /api/recovery { userId, bookerId, date?, entries: [{ outletId, amount, method?, reference?, note? }] }
 *   - Distributor: EK transaction mein har entry: Recovery (RCV-, APPROVED) + OutletLedger CREDIT (RECOVERY) + Collection receipt (RCP-)
 *   - SALESMAN: entry PENDING status mein jati hai — sirf voucher, ledger sirf admin APPROVE karne ke baad update hoga
 *   - Balance re-check transaction ke andar — over-collect par poora batch reject
 */

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * FIFO aging — ledger credits ko purane debits par FIFO apply karke sab se purana
 * unpaid debit ki date nikalta hai (recovery sheet ka 30/60/90+ aging badge).
 * null = koi pending udhaar nahi.
 */
function fifoOldestDue(entries: Array<{ type: string; amount: number; date: Date }>): string | null {
  const debits = entries
    .filter((e) => e.type === 'DEBIT')
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  if (debits.length === 0) return null
  let credits = entries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0)
  for (const d of debits) {
    if (credits >= d.amount - 0.005) { credits -= d.amount; continue }
    return new Date(d.date).toISOString()
  }
  return null
}

/**
 * Role ke hisaab se RECOVERY scope — outlet-centric (route-centric):
 * kaunse outlets + unke bookers nazar aa rahe hain. Hierarchy parent nahi,
 * balki US user ki shops jo dekh sakte hain (distributor ki sab shops aur
 * unke bookers yahan dikhte hain — stats sirf is scope ki shops ke hain).
 */
async function recoveryScope(userId: string) {
  const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!me) return null
  const mb = megaBlocked(me.role)
  if (mb) return null
  if (me.role === 'SALESMAN') {
    // Task 25-b: booker ka route = ASSIGNED shops + apni PJP plans ki shops (day-wise).
    // PJP shops aksar unassigned hoti hain (salesmanId null) — pehle sirf assigned scope
    // tha isliye plan-only route par Route Start 403 deta tha.
    return {
      me,
      outletWhere: {
        OR: [{ salesmanId: me.id }, { visits: { some: { plan: { salesmanId: me.id } } } }],
      } as Record<string, unknown>,
    }
  }
  return { me, outletWhere: { distributorId: me.profile!.id } as Record<string, unknown> }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const scope = await recoveryScope(userId)
    if (!scope) return jsonError('User not found', 404)

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    // Route shops (assigned + unassigned) — balance aggregation ke sath
    const routeOutlets = await db.outlet.findMany({
      where: scope.outletWhere,
      select: {
        id: true, name: true, code: true, city: true, channel: true, salesmanId: true, visitDays: true,
        ledgerEntries: { select: { type: true, amount: true, date: true } },
      },
    })

    // Bookers = route outlets ke DISTINCT salesman (route-centric — hierarchy se nahi)
    const bookerUserIds = Array.from(new Set(routeOutlets.map((o) => o.salesmanId).filter((v): v is string => !!v)))
    const bookerUsers = bookerUserIds.length
      ? await db.user.findMany({ where: { id: { in: bookerUserIds } }, select: { id: true, name: true, phone: true, allRoutesOpen: true }, orderBy: { name: 'asc' } })
      : []

    const recoveries = await db.recovery.findMany({
      where: { outlet: scope.outletWhere, status: { not: 'REJECTED' } },
      select: { outletId: true, bookerId: true, amount: true, recoveredAt: true, status: true },
    })

    // Aaj ki APPROVED wasooli per shop — sheet mein "Aaj wasooli" badge ke liye
    const collectedTodayByOutlet = new Map<string, number>()
    for (const r of recoveries) {
      if (r.status !== 'APPROVED' || r.recoveredAt < todayStart) continue
      collectedTodayByOutlet.set(r.outletId, round2((collectedTodayByOutlet.get(r.outletId) ?? 0) + r.amount))
    }

    const bookerStats: Array<{ id: string | null; name: string; phone: string | null; allRoutesOpen: boolean }> = [
      ...bookerUsers.map((b) => ({ id: b.id as string | null, name: b.name, phone: b.phone, allRoutesOpen: b.allRoutesOpen })),
      // Unassigned shops bucket — sirf tab jab aisi shops mojood hon
      ...(routeOutlets.some((o) => o.salesmanId === null) ? [{ id: null as string | null, name: 'Unassigned Shops', phone: null as string | null, allRoutesOpen: false }] : []),
    ]

    const bookersOut = bookerStats.map((b) => {
      const shops = routeOutlets.filter((o) => (o.salesmanId ?? null) === b.id)
      const balances = shops.map((o) => round2(
        o.ledgerEntries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0)
        - o.ledgerEntries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0),
      ))
      const mine = recoveries.filter((r) => (r.bookerId ?? null) === b.id && r.status === 'APPROVED')
      const dates = mine.map((r) => r.recoveredAt)
      return {
        id: b.id,
        name: b.name,
        phone: b.phone,
        allRoutesOpen: b.allRoutesOpen,
        routeShops: shops.length,
        shopsWithUdhaar: balances.filter((v) => v > 0.005).length,
        totalOutstanding: round2(balances.filter((v) => v > 0).reduce((s, v) => s + v, 0)),
        recoveredToday: round2(mine.filter((r) => r.recoveredAt >= todayStart).reduce((s, r) => s + r.amount, 0)),
        recoveredMonth: round2(mine.filter((r) => r.recoveredAt >= mStart).reduce((s, r) => s + r.amount, 0)),
        recoveredTotal: round2(mine.reduce((s, r) => s + r.amount, 0)),
        lastRecoveryAt: dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString() : null,
      }
    })

    // History — is scope ki shops ki recoveries (latest first, 100) — status ke sath
    const historyRows = await db.recovery.findMany({
      where: { outlet: scope.outletWhere },
      include: {
        outlet: { select: { name: true, code: true } },
        booker: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const toRowDTO = (r: typeof historyRows[number]) => ({
      id: r.id,
      recoveryNo: r.recoveryNo,
      receiptNo: null as string | null,
      date: new Date(r.recoveredAt).toISOString(),
      bookerId: r.bookerId,
      bookerName: r.booker?.name ?? 'Unassigned',
      outletName: r.outlet.name,
      outletCode: r.outlet.code,
      amount: r.amount,
      method: r.method,
      reference: r.reference,
      note: r.note,
      postedByName: r.postedByName,
      status: r.status,
      originalAmount: r.originalAmount,
      editedAmount: r.editedAmount,
      reviewNote: r.reviewNote,
      approvedByName: r.approvedByName,
      approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
    })

    const pendingRows = historyRows.filter((r) => r.status === 'PENDING').map(toRowDTO)

    // Specific booker bucket ki route shops (Book Recovery tab ke liye)
    const bookerId = searchParams.get('bookerId')
    let shops: Array<{ outletId: string; name: string; code: string; city: string; channel: string; balance: number; visitDays: string }> = []
    if (bookerId) {
      const bucketId = bookerId === 'none' ? null : bookerId
      // scope guard: bucket is scope ke bookers mein hona chahiye (ya 'none' jab unassigned shops hon)
      // Task 25-b: salesman hamesha APNA bucket load kar sakta hai (route start) — chahe uski
      // shops assigned hon ya sirf PJP plan mein (bookerStats mein unassigned bucket banta hai)
      const selfBucket = scope.me.role === 'SALESMAN' && bookerId === scope.me.id
      const allowed = selfBucket
        || (bookerId === 'none'
          ? routeOutlets.some((o) => o.salesmanId === null)
          : bookerStats.some((b) => b.id === bookerId))
      if (!allowed) return jsonError('Yeh order booker aap ke scope mein nahi hai', 403)
      shops = (selfBucket
        ? routeOutlets // apna poora route — assigned + planned dono
        : routeOutlets.filter((o) => (o.salesmanId ?? null) === bucketId))
        .map((o) => ({
          outletId: o.id, name: o.name, code: o.code, city: o.city, channel: o.channel,
          visitDays: o.visitDays,
          balance: round2(
            o.ledgerEntries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0)
            - o.ledgerEntries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0),
          ),
          collectedToday: round2(collectedTodayByOutlet.get(o.id) ?? 0),
          oldestDueDate: fifoOldestDue(o.ledgerEntries),
        }))
        .sort((a, b) => b.balance - a.balance)
    }

    return Response.json({
      bookers: bookersOut,
      shops,
      pending: pendingRows,
      history: historyRows.map(toRowDTO),
      totals: {
        outstanding: round2(bookersOut.reduce((s, b) => s + b.totalOutstanding, 0)),
        recoveredToday: round2(bookersOut.reduce((s, b) => s + b.recoveredToday, 0)),
        recoveredMonth: round2(bookersOut.reduce((s, b) => s + b.recoveredMonth, 0)),
        pendingCount: pendingRows.length,
        pendingAmount: round2(pendingRows.reduce((s, r) => s + r.amount, 0)),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Recovery data load failed', 500)
  }
}

const METHODS = ['CASH', 'CHEQUE', 'BANK'] as const

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, bookerId, date, entries } = body as {
      userId: string
      bookerId?: string | null
      date?: string
      entries: Array<{ outletId: string; amount: number; method?: string; reference?: string; note?: string; clientRef?: string }>
    }
    if (!userId) return jsonError('userId required')
    if (!Array.isArray(entries) || entries.length === 0) return jsonError('Kam az kam ek shop ki entry zaroori hai')

    // Actor + booker scope validation
    const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!me) return jsonError('User not found', 404)
    const mbp = megaBlocked(me.role)
    if (mbp) return mbp

    const bucketId: string | null = bookerId && bookerId !== 'none' ? bookerId : null
    if (bucketId) {
      const booker = await db.user.findUnique({ where: { id: bucketId } })
      if (!booker || booker.role !== 'SALESMAN') return jsonError('Order booker valid nahi hai')
      // Scope: outlet-level guards (distributorId + bucket consistency) transaction mein hain —
      // yahan sirf salesman self-check (booker khud sirf apni route ki recovery kar sakta hai)
      if (me.role === 'SALESMAN' && bucketId !== me.id) return jsonError('Booker sirf apni route ki recovery kar sakta hai', 403)
    }

    // Entries sanitize
    const clean = entries.map((e) => {
      const amount = round2(Number(e.amount))
      const method = METHODS.includes((e.method ?? 'CASH') as (typeof METHODS)[number]) ? (e.method ?? 'CASH') : 'CASH'
      return {
        outletId: e.outletId,
        amount,
        method,
        reference: (e.reference ?? '').trim() || null,
        note: (e.note ?? '').trim() || null,
        clientRef: (e.clientRef ?? '').trim() || null, // Task 85: offline sync idempotency
      }
    })
    if (clean.some((e) => !e.outletId || !(e.amount > 0))) return jsonError('Amount 0 se bara hona chahiye har entry mein')
    if (clean.some((e) => e.method !== 'CASH' && !e.reference)) return jsonError('Cheque/Bank ke liye reference number zaroori hai')

    // Task 85: IDEMPOTENT SYNC — clientRef pehle se posted ho to wo entry skip (duplicate wasooli nahi)
    const allRefs = clean.map((c) => c.clientRef).filter((v): v is string => !!v)
    const existingRefs = allRefs.length
      ? new Set((await db.recovery.findMany({ where: { clientRef: { in: allRefs } }, select: { clientRef: true } })).map((r) => r.clientRef))
      : new Set<string>()
    const fresh = clean.filter((c) => !c.clientRef || !existingRefs.has(c.clientRef))
    if (fresh.length === 0) {
      return Response.json({ posted: [], duplicates: clean.length, message: 'Ye recoveries pehle sync ho chuki hain' })
    }

    const recoveredAt = date ? new Date(date) : new Date()
    const postedBy = me.name

    const result = await db.$transaction(async (tx) => {
      const posted: Array<{ recoveryNo: string; receiptNo: string | null; outletName: string; amount: number; method: string; status: string }> = []
      const isBooker = me.role === 'SALESMAN' // booker ki entry PENDING jati hai — admin approve karega

      for (const e of fresh) {
        const outlet = await tx.outlet.findUnique({
          where: { id: e.outletId },
          select: { id: true, name: true, code: true, salesmanId: true, distributorId: true },
        })
        if (!outlet) throw new Error('Shop nahi mili — sheet dobara load karein')
        if (me.role !== 'SALESMAN') {
          const profileUser = await db.distributorProfile.findUnique({ where: { id: me.profile!.id } })
          if (outlet.distributorId !== profileUser!.id) throw new Error(`Shop ${outlet.name} aap ke scope mein nahi hai`)
        }
        // Bucket consistency: shop usi booker ke route ki ho.
        // Task 25-b: salesman apne bucket (bookerId = khud) mein assigned + PJP-plan shops
        // dono par recovery punch kar sakta hai — planned shops unassigned hoti hain.
        const selfRoute = me.role === 'SALESMAN' && bucketId === me.id
        if (!selfRoute && (outlet.salesmanId ?? null) !== bucketId) {
          throw new Error(`Shop ${outlet.name} is order booker ke route mein nahi hai — sheet dobara load karein`)
        }
        if (selfRoute) {
          const assigned = outlet.salesmanId === me.id
          const planned = !assigned
            ? await tx.visit.findFirst({ where: { outletId: outlet.id, plan: { salesmanId: me.id } }, select: { id: true } })
            : null
          if (!assigned && !planned) throw new Error(`Shop ${outlet.name} aap ki route mein nahi hai`)
        }

        // Ledger balance re-check (transaction ke andar — race-safe)
        const deb = await tx.outletLedger.aggregate({ where: { outletId: outlet.id, type: 'DEBIT' }, _sum: { amount: true } })
        const cre = await tx.outletLedger.aggregate({ where: { outletId: outlet.id, type: 'CREDIT' }, _sum: { amount: true } })
        const balance = round2((deb._sum.amount ?? 0) - (cre._sum.amount ?? 0))
        if (e.amount > balance + 0.005) {
          throw new Error(`Shop ${outlet.name} ka udhaar sirf Rs ${balance.toFixed(2)} hai — Rs ${e.amount.toFixed(2)} post nahi ho sakti`)
        }

        // 1) Recovery voucher (RCV-) — booker entry PENDING, admin/direct entry APPROVED
        const rSeq = await nextSeq('recovery', tx)
        const recoveryNo = `RCV-${rSeq}`
        await tx.recovery.create({
          data: {
            recoveryNo,
            outletId: outlet.id,
            bookerId: bucketId,
            distributorId: outlet.distributorId,
            amount: e.amount,
            method: e.method,
            reference: e.reference,
            note: e.note,
            recoveredAt,
            postedByName: postedBy,
            status: isBooker ? 'PENDING' : 'APPROVED',
            clientRef: e.clientRef,
          },
        })

        if (isBooker) {
          // Booker ki wasooli — sirf voucher; ledger + receipt sirf APPROVE ke baad banenge
          posted.push({ recoveryNo, receiptNo: null, outletName: outlet.name, amount: e.amount, method: e.method, status: 'PENDING' })
          continue
        }

        // 2) Shop ledger CREDIT (RECOVERY) — shop ka balance foran kam
        await tx.outletLedger.create({
          data: {
            outletId: outlet.id,
            type: 'CREDIT',
            amount: e.amount,
            refType: 'RECOVERY',
            refNo: recoveryNo,
            note: `Udhaar wasooli (${e.method}${e.reference ? ` • Ref ${e.reference}` : ''})`,
          },
        })

        // 3) Collection receipt (RCP-) — receipts record complete rehta hai
        const cSeq = await nextSeq('receipt', tx)
        const receiptNo = `RCP-${cSeq}`
        await tx.collection.create({
          data: {
            receiptNo,
            outletId: outlet.id,
            amount: e.amount,
            method: e.method,
            collectedById: bucketId,
          },
        })

        posted.push({ recoveryNo, receiptNo, outletName: outlet.name, amount: e.amount, method: e.method, status: 'APPROVED' })
      }

      return posted
    }, { timeout: 20000 })

    return Response.json({
      posted: result,
      total: round2(result.reduce((s, r) => s + r.amount, 0)),
      count: result.length,
      allPending: result.every((r) => r.status === 'PENDING'),
    })
  } catch (e) {
    console.error(e)
    return jsonError(e instanceof Error ? e.message : 'Recovery post failed', 400)
  }
}

/**
 * PATCH /api/recovery { userId, bookerId, allRoutesOpen }
 * DISTRIBUTOR-CONTROLLED "All Routes" access — sirf distributor apne booker ke liye
 * all-routes permission ON/OFF kar sakta hai (orderbooker khud nahi).
 * OFF = booker apni login mein sirf day-wise shops dekhega.
 */
export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { userId, bookerId, allRoutesOpen } = body as { userId: string; bookerId: string; allRoutesOpen: boolean }
    if (!userId || !bookerId) return jsonError('userId + bookerId required')
    if (typeof allRoutesOpen !== 'boolean') return jsonError('allRoutesOpen boolean hona chahiye')

    const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!me) return jsonError('User not found', 404)
    if (me.role !== 'DISTRIBUTOR') {
      return jsonError('Sirf distributor All Routes access on/off kar sakta hai', 403)
    }

    const booker = await db.user.findUnique({ where: { id: bookerId } })
    if (!booker || booker.role !== 'SALESMAN') return jsonError('Order booker valid nahi hai')

    // Scope guard: distributor sirf apne outlets wale booker ko toggle kar sakta hai
    if (me.role === 'DISTRIBUTOR') {
      const hasOutlet = await db.outlet.findFirst({ where: { salesmanId: bookerId, distributorId: me.profile!.id } })
      if (!hasOutlet) return jsonError('Yeh order booker aap ke scope mein nahi hai', 403)
    }

    const updated = await db.user.update({ where: { id: bookerId }, data: { allRoutesOpen }, select: { id: true, allRoutesOpen: true } })
    return Response.json({
      message: `${booker.name} ke liye All Routes access ${allRoutesOpen ? 'ON' : 'OFF'} ho gaya`,
      bookerId: updated.id,
      allRoutesOpen: updated.allRoutesOpen,
    })
  } catch (e) {
    console.error(e)
    return jsonError(e instanceof Error ? e.message : 'All Routes toggle failed', 400)
  }
}
