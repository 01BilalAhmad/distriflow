import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { getTenantIdForSalesman } from '@/lib/dms-pjp'

/**
 * Task 100 — OB RECOVERY REPORT (posted/approved recoveries — cash tally)
 *
 * GET /api/recovery/report?bookerId=<id|none>&date=YYYY-MM-DD
 *
 *  - Sirf APPROVED recoveries (ledger mein CREDIT ho chuki) — PENDING/REJECTED shamil NAHI
 *  - Din ki window PAKISTAN (UTC+5) ke hisaab se — server timezone kuch bhi ho, business
 *    day consistent rehta hai (recoveredAt 00:00 PKT se 24 ghantay)
 *  - Booker + date dono required — kisi bhi old date ki posting report nikal sakti hai
 *  - Use: printed report par booker ki jama ki hui cash office jama se tally hoti hai
 *
 * Response: { booker, date, entries[], totals { total, cash, nonCash, count, shops } }
 */

const round2 = (n: number) => Math.round(n * 100) / 100

/** 'YYYY-MM-DD' (default: aaj ki PKT date) */
function pktDateString(d: Date): string {
  const pkt = new Date(d.getTime() + 5 * 3600 * 1000)
  return pkt.toISOString().slice(0, 10)
}

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb

    const { searchParams } = new URL(req.url)
    const bookerParam = searchParams.get('bookerId') ?? ''
    const dateParam = (searchParams.get('date') ?? '').trim()
    if (!bookerParam) return jsonError('Order booker select karein — report isi par banegi')
    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) return jsonError('Date format galat hai (YYYY-MM-DD)')

    const date = dateParam || pktDateString(new Date())
    const bucketId: string | null = bookerParam === 'none' ? null : bookerParam

    // Scope guards — DISTRIBUTOR apne tenant ke booker ke liye, SALESMAN sirf apni report
    if (me.role === 'SALESMAN' && bookerParam !== me.id) {
      return jsonError('Booker sirf apni recovery report dekh sakta hai', 403)
    }
    const tenantId =
      me.role === 'SALESMAN'
        ? await getTenantIdForSalesman(me.id)
        : me.profile!.id
    if (!tenantId) return jsonError('Aap kisi distributor se attached nahi hain', 403)

    const routeShops = await db.outlet.count({
      where: { distributorId: tenantId, salesmanId: bucketId },
    })
    if (routeShops === 0) return jsonError('Is booker ke route mein shops nahi hain (ya aap ke scope mein nahi)', 403)

    // Booker meta — entries na hon to bhi report par sahi naam/phone print ho
    const bookerUser = bucketId
      ? await db.user.findUnique({ where: { id: bucketId }, select: { name: true, phone: true } })
      : null

    // Pakistan business-day window (UTC+5) — server TZ se azad
    const dayStart = new Date(`${date}T00:00:00+05:00`)
    const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000)

    const rows = await db.recovery.findMany({
      where: {
        status: 'APPROVED',
        bookerId: bucketId,
        recoveredAt: { gte: dayStart, lt: dayEnd },
      },
      include: {
        outlet: { select: { name: true, code: true, code4: true, address: true, city: true } },
        booker: { select: { name: true, phone: true } },
      },
      orderBy: { recoveredAt: 'asc' },
    })

    const entries = rows.map((r) => ({
      id: r.id,
      recoveryNo: r.recoveryNo,
      time: new Date(r.recoveredAt).toISOString(),
      amount: round2(r.amount),
      method: r.method,
      reference: r.reference,
      note: r.note,
      outletName: r.outlet.name,
      outletCode: r.outlet.code,
      outletCode4: r.outlet.code4,
      outletAddress: r.outlet.address,
      outletCity: r.outlet.city,
    }))

    const total = round2(entries.reduce((s, e) => s + e.amount, 0))
    const cash = round2(entries.filter((e) => e.method === 'CASH').reduce((s, e) => s + e.amount, 0))
    const nonCash = round2(total - cash)

    return Response.json({
      booker: {
        id: bucketId,
        name: bucketId ? (bookerUser?.name ?? 'Order Booker') : 'Unassigned Shops',
        phone: bookerUser?.phone ?? null,
      },
      date,
      entries,
      totals: {
        total,
        cash,
        nonCash,
        count: entries.length,
        shops: new Set(entries.map((e) => e.outletCode)).size,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('OB recovery report load failed', 500)
  }
}
