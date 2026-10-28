import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'
import { currentMaxCode4, ensureCode4Backfill, padCode4, CODE4_MAX } from '@/lib/dms-code4'
import { Prisma } from '@prisma/client'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: user.id }
        : { distributorId: user.profile?.id }

    // Task 100: legacy shops ka 4-digit code backfill (once per instance)
    await ensureCode4Backfill()

    const outlets = await db.outlet.findMany({
      where,
      include: {
        distributor: { select: { businessName: true } },
        salesman: { select: { id: true, name: true } },
        orders: { select: { total: true } },
      },
      orderBy: { name: 'asc' },
    })

    const result = outlets.map((o) => ({
      id: o.id,
      code: o.code,
      name: o.name,
      ownerName: o.ownerName,
      phone: o.phone,
      address: o.address,
      code4: o.code4,
      city: o.city,
      channel: o.channel,
      lat: o.lat,
      lng: o.lng,
      creditDays: o.creditDays,
      // Task 98: credit khata fields
      creditLimit: o.creditLimit,
      balance: o.balance,
      ntn: o.ntn,
      cnic: o.cnic,
      filerStatus: o.filerStatus,
      visitDays: o.visitDays,
      distributorName: o.distributor.businessName,
      salesmanId: o.salesman?.id ?? null,
      salesmanName: o.salesman?.name ?? null,
      totalOrders: o.orders.length,
      totalValue: o.orders.reduce((s, x) => s + x.total, 0),
    }))

    return Response.json({ outlets: result })
  } catch (e) {
    console.error(e)
    return jsonError('Outlets load failed', 500)
  }
}

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** "mon,wed,,xyz" -> "MON,WED" (invalid/empty codes drop) */
function sanitizeVisitDays(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const days = raw.split(',').map((d) => d.trim().toUpperCase()).filter((d) => (DAY_CODES as readonly string[]).includes(d))
  return Array.from(new Set(days)).join(',')
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { name, ownerName, phone, address, city, channel, lat, lng, creditDays, creditLimit, distributorId, salesmanId, ntn, cnic, filerStatus, visitDays } = body
    if (!name || !distributorId) return jsonError('Outlet name aur distributor required hain')

    // Task 95: tenant ownership — outlet apne hi tenant mein banega (cross-tenant create 403)
    const tm = await tenantMismatch(user, distributorId)
    if (tm) return tm

    const count = await db.outlet.count()
    const code = `OUT-${1005 + (count + 1) * 5}`

    // Task 100: unique 4-digit shop code — sequential, collision par bump (retry)
    const createOutlet = (c4: string) => db.outlet.create({
      data: {
        code, name, ownerName: ownerName ?? null, phone: phone ?? null,
        address: address ?? null, city: city ?? 'Lahore',
        channel: channel ?? 'GENERAL',
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        creditDays: Number(creditDays) || 7,
        // Task 98: credit limit (Rs) — 0 = no limit; booking par warning (block nahi)
        creditLimit: Math.max(0, Number(creditLimit) || 0),
        distributorId, salesmanId: salesmanId || null,
        // Filer/Non-Filer: NTN likha ho to default FILER (user override kar sakta hai)
        ntn: (ntn ?? '').trim() || null,
        cnic: (cnic ?? '').trim() || null,
        filerStatus: filerStatus === 'FILER' || filerStatus === 'NON_FILER'
          ? filerStatus
          : ((ntn ?? '').trim() ? 'FILER' : 'NON_FILER'),
        // Visit schedule: sirf valid day codes (MON..SUN), comma separated
        visitDays: sanitizeVisitDays(visitDays),
        code4: c4,
      },
    })
    let code4 = padCode4(Math.min((await currentMaxCode4(db)) + 1, CODE4_MAX))
    let outlet: Awaited<ReturnType<typeof createOutlet>> | null = null
    for (let attempt = 0; attempt < 5 && !outlet; attempt++) {
      try {
        outlet = await createOutlet(code4)
      } catch (e) {
        const isCode4 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
          && String((e.meta as { target?: string[] } | null)?.target ?? '').includes('code4')
        if (!isCode4 || attempt === 4) throw e
        code4 = padCode4(Math.min((await currentMaxCode4(db)) + 1, CODE4_MAX))
      }
    }
    if (!outlet) return jsonError('Outlet create failed — code4 range exhaust', 500)
    return Response.json({ outlet })
  } catch (e) {
    console.error(e)
    return jsonError('Outlet create failed', 500)
  }
}
