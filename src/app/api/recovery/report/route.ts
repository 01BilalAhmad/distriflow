import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { getTenantIdForSalesman } from '@/lib/dms-pjp'

/**
 * Task 100 — OB RECOVERY REPORT (posted/approved recoveries — cash tally)
 *
 * GET /api/recovery/report?bookerId=<id|none>&date=YYYY-MM-DD&mode=posting|collection
 *
 *  - Sirf APPROVED recoveries (ledger mein CREDIT ho chuki) — PENDING/REJECTED shamil NAHI
 *  - mode=posting (DEFAULT): report ki bunyad APPROVE/post hone ki date hai (approvedAt;
 *    direct admin post par approvedAt null hota hai to recoveredAt fallback) — yani jo
 *    entries aaj ledger mein post hui (chahe booker ne kal collect kin) wo AAJ DIKHENGI.
 *   Ye "no data" wala masla hal karta hai: pehle sirf recoveredAt (collection date) par
 *    filter tha — kal collect karke aaj approve hone wali entries aaj ki report se ghayab
 *    theen.
 *  - mode=collection: report ki bunyad wasooli (collection/submission) date hai — purana
 *    behavior, physical visit-day tally ke liye.
 *  - Din ki window PAKISTAN (UTC+5) ke hisaab se — server timezone kuch bhi ho, business
 *    day consistent rehta hai
 *  - HINTS: khali report par raasta dikhane ke liye — (a) isi date ki PENDING wasooliyan,
 *    (b) aas paas 7 din mein jin dates par is booker ki posted entries hain (mode-aware,
 *    selected date se qareebi pehle)
 *  - Booker + date dono required — kisi bhi old date ki posting report nikal sakti hai
 *  - Use: printed report par booker ki jama ki hui cash office jama se tally hoti hai
 *
 * Response: { booker, date, mode, entries[], totals, hints { pendingCount, pendingTotal, nearbyDates[] } }
 */

const round2 = (n: number) => Math.round(n * 100) / 100
const DAY_MS = 24 * 3600 * 1000

/** 'YYYY-MM-DD' (default: aaj ki PKT date) */
function pktDateString(d: Date): string {
  const pkt = new Date(d.getTime() + 5 * 3600 * 1000)
  return pkt.toISOString().slice(0, 10)
}

/** PKT business-day key of an instant ('YYYY-MM-DD') */
const pktDateKey = (d: Date) => pktDateString(d)

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
    const mode = searchParams.get('mode') === 'collection' ? 'collection' : 'posting'
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
    const dayEnd = new Date(dayStart.getTime() + DAY_MS)
    // Hints ke liye ±7 din ka wider net (dono timestamps par) — ek hi query se sab buckets
    const winStart = new Date(dayStart.getTime() - 7 * DAY_MS)
    const winEnd = new Date(dayEnd.getTime() + 7 * DAY_MS)

    const inDay = (d: Date | null | undefined) => !!d && d.getTime() >= dayStart.getTime() && d.getTime() < dayEnd.getTime()

    const [rows, pendingAgg] = await Promise.all([
      db.recovery.findMany({
        where: {
          status: 'APPROVED',
          bookerId: bucketId,
          OR: [
            { recoveredAt: { gte: winStart, lt: winEnd } },
            { approvedAt: { gte: winStart, lt: winEnd } },
          ],
        },
        include: {
          outlet: { select: { name: true, code: true, code4: true, address: true, city: true } },
          booker: { select: { name: true, phone: true } },
        },
      }),
      db.recovery.aggregate({
        where: { status: 'PENDING', bookerId: bucketId, recoveredAt: { gte: dayStart, lt: dayEnd } },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ])

    // Report ki bunyad (mode ke hisaab se primary timestamp)
    const primaryAt = (r: (typeof rows)[number]): Date =>
      mode === 'posting'
        ? (r.approvedAt ? new Date(r.approvedAt) : new Date(r.recoveredAt))
        : new Date(r.recoveredAt)
    const matched = rows.filter((r) => inDay(primaryAt(r)))
    matched.sort((a, b) => primaryAt(a).getTime() - primaryAt(b).getTime())

    const entries = matched.map((r) => ({
      id: r.id,
      recoveryNo: r.recoveryNo,
      time: primaryAt(r).toISOString(),
      collectedAt: new Date(r.recoveredAt).toISOString(),
      postedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
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

    // Hints — nearby dates (mode-aware, selected date chor kar, qareebi pehle)
    const byDate = new Map<string, { count: number; total: number }>()
    for (const r of rows) {
      if (!inDay(primaryAt(r))) continue
      const key = pktDateKey(primaryAt(r))
      const cur = byDate.get(key) ?? { count: 0, total: 0 }
      cur.count += 1
      cur.total = round2(cur.total + r.amount)
      byDate.set(key, cur)
    }
    const selNoon = new Date(`${date}T12:00:00Z`).getTime()
    const nearbyDates = [...byDate.entries()]
      .filter(([k]) => k !== date)
      .map(([k, v]) => ({ date: k, ...v }))
      .sort((a, b) =>
        Math.abs(new Date(`${a.date}T12:00:00Z`).getTime() - selNoon) -
        Math.abs(new Date(`${b.date}T12:00:00Z`).getTime() - selNoon))
      .slice(0, 5)

    return Response.json({
      booker: {
        id: bucketId,
        name: bucketId ? (bookerUser?.name ?? 'Order Booker') : 'Unassigned Shops',
        phone: bookerUser?.phone ?? null,
      },
      date,
      mode,
      entries,
      totals: {
        total,
        cash,
        nonCash,
        count: entries.length,
        shops: new Set(entries.map((e) => e.outletCode)).size,
      },
      hints: {
        pendingCount: pendingAgg._count._all,
        pendingTotal: round2(pendingAgg._sum.amount ?? 0),
        nearbyDates,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('OB recovery report load failed', 500)
  }
}
