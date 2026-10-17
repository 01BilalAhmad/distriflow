import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * Task 85 — NEW SHOPS (booker-tagged) — admin approval page ka API
 * GET /api/new-shops?userId=
 * - DISTRIBUTOR-only (apne tenant ki shops)
 * - pending: status=PENDING shops (approve ka intezar) — har shop ke orders ka summary bhi
 *   (approve hone se pehle in orders ki billing nazar nahi aati)
 * - approvedTagged: booker ne tag ki aur admin APPROVE kar chuka (edit ab bhi ho sakti hai)
 */

type ShopRow = {
  id: string; code: string; name: string; ownerName: string | null; phone: string | null
  address: string | null; city: string; channel: string; cnic: string | null; ntn: string | null
  lat: number | null; lng: number | null; status: string; creditDays: number; visitDays: string
  taggedByName: string | null; clientRef: string | null; createdAt: Date
  salesman: { name: string } | null
  orders: { total: number; orderNo: string; status: string }[]
  ledgerEntries: { type: string; amount: number }[]
}

const baseSelect = {
  id: true, code: true, name: true, ownerName: true, phone: true, address: true, city: true,
  channel: true, cnic: true, ntn: true, lat: true, lng: true, status: true, creditDays: true,
  visitDays: true, taggedByName: true, clientRef: true, createdAt: true,
  salesman: { select: { name: true } },
  orders: { select: { total: true, orderNo: true, status: true } },
  ledgerEntries: { select: { type: true, amount: true } },
} as const

function toDTO(o: ShopRow) {
  const debit = o.ledgerEntries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0)
  const credit = o.ledgerEntries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0)
  return {
    id: o.id, code: o.code, name: o.name, ownerName: o.ownerName, phone: o.phone,
    address: o.address, city: o.city, channel: o.channel, cnic: o.cnic, ntn: o.ntn,
    lat: o.lat, lng: o.lng, status: o.status, creditDays: o.creditDays, visitDays: o.visitDays,
    taggedByName: o.taggedByName, salesmanName: o.salesman?.name ?? null, clientRef: o.clientRef,
    createdAt: new Date(o.createdAt).toISOString(),
    ordersCount: o.orders.length,
    ordersTotal: Math.round(o.orders.reduce((a, x) => a + x.total, 0) * 100) / 100,
    orderNos: o.orders.slice(0, 5).map((x) => x.orderNo),
    balance: Math.round((debit - credit) * 100) / 100,
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR' || !user.profile) return jsonError('Sirf distributor new shops dekh sakta hai', 403)
    const tenantId = user.profile.id

    const [pending, approvedTagged] = await Promise.all([
      db.outlet.findMany({
        where: { distributorId: tenantId, status: 'PENDING' },
        orderBy: { createdAt: 'desc' },
        select: baseSelect,
      }),
      db.outlet.findMany({
        where: { distributorId: tenantId, status: 'APPROVED', clientRef: { not: null } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: baseSelect,
      }),
    ])

    return Response.json({
      pending: pending.map(toDTO),
      approvedTagged: approvedTagged.map(toDTO),
      totals: {
        pending: pending.length,
        pendingOrdersValue: Math.round(pending.reduce((a, o) => a + o.orders.reduce((x, ord) => x + ord.total, 0), 0) * 100) / 100,
        approvedTagged: approvedTagged.length,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('New shops load failed', 500)
  }
}
