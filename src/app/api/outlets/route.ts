import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where =
      user.role === 'SALESMAN'
        ? { salesmanId: userId }
        : { distributorId: user.profile?.id }

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
      city: o.city,
      channel: o.channel,
      lat: o.lat,
      lng: o.lng,
      creditDays: o.creditDays,
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
    const body = await req.json()
    const { name, ownerName, phone, address, city, channel, lat, lng, creditDays, distributorId, salesmanId, ntn, cnic, filerStatus, visitDays } = body
    if (!name || !distributorId) return jsonError('Outlet name aur distributor required hain')

    const count = await db.outlet.count()
    const code = `OUT-${1005 + (count + 1) * 5}`

    const outlet = await db.outlet.create({
      data: {
        code, name, ownerName: ownerName ?? null, phone: phone ?? null,
        address: address ?? null, city: city ?? 'Lahore',
        channel: channel ?? 'GENERAL',
        lat: lat != null ? Number(lat) : null,
        lng: lng != null ? Number(lng) : null,
        creditDays: Number(creditDays) || 7,
        distributorId, salesmanId: salesmanId || null,
        // Filer/Non-Filer: NTN likha ho to default FILER (user override kar sakta hai)
        ntn: (ntn ?? '').trim() || null,
        cnic: (cnic ?? '').trim() || null,
        filerStatus: filerStatus === 'FILER' || filerStatus === 'NON_FILER'
          ? filerStatus
          : ((ntn ?? '').trim() ? 'FILER' : 'NON_FILER'),
        // Visit schedule: sirf valid day codes (MON..SUN), comma separated
        visitDays: sanitizeVisitDays(visitDays),
      },
    })
    return Response.json({ outlet })
  } catch (e) {
    console.error(e)
    return jsonError('Outlet create failed', 500)
  }
}
