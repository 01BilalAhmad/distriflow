import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/**
 * MEGA ADMIN — Distributor Accounts (Task 22)
 *
 * GET  /api/mega/distributors?userId=<megaAdminId>
 *   Sirf MEGA_ADMIN. DISTRIBUTOR ACCOUNTS ki list — subscription status ke sath.
 *   Business data (orders/shops/recovery) yahan KAHI nahi aata — sirf account meta.
 *
 * POST /api/mega/distributors  { userId, name, email, password?, phone?, businessName, city, region?, months?, creditLimit? }
 *   Naya distributor account: User (DISTRIBUTOR) + DistributorProfile + subscription
 *   (start = aaj, expiry = aaj + months, default 1 month).
 */

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

const DAY = 86400000

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const me = await db.user.findUnique({ where: { id: userId } })
    if (!me) return jsonError('User not found', 404)
    if (me.role !== 'MEGA_ADMIN') return jsonError('Sirf Mega Admin distributor accounts dekh sakta hai', 403)

    const dists = await db.user.findMany({
      where: { role: 'DISTRIBUTOR' },
      include: {
        profile: true,
        children: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const now = Date.now()
    const rows = dists.map((d) => {
      const exp = d.subscriptionExpiry ? d.subscriptionExpiry.getTime() : null
      const daysLeft = exp != null ? Math.ceil((exp - now) / DAY) : null
      const status = !d.isActive ? 'INACTIVE' : exp != null && exp < now ? 'EXPIRED' : 'ACTIVE'
      return {
        id: d.id,
        name: d.name,
        email: d.email,
        phone: d.phone,
        region: d.region,
        businessName: d.profile?.businessName ?? null,
        city: d.profile?.city ?? null,
        creditLimit: d.profile?.creditLimit ?? null,
        isActive: d.isActive,
        subscriptionStart: d.subscriptionStart ? d.subscriptionStart.toISOString() : null,
        subscriptionExpiry: d.subscriptionExpiry ? d.subscriptionExpiry.toISOString() : null,
        daysLeft,
        status,
        teamUsers: d.children.length,
        createdAt: d.createdAt.toISOString(),
      }
    })

    const totals = {
      total: rows.length,
      active: rows.filter((r) => r.status === 'ACTIVE').length,
      inactive: rows.filter((r) => r.status === 'INACTIVE').length,
      expired: rows.filter((r) => r.status === 'EXPIRED').length,
      expiringSoon: rows.filter((r) => r.status === 'ACTIVE' && r.daysLeft != null && r.daysLeft <= 7).length,
    }

    return Response.json({ distributors: rows, totals })
  } catch (e) {
    console.error(e)
    return jsonError('Distributor accounts load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, name, email, password, phone, businessName, city, region, months, creditLimit } = body
    if (!userId) return jsonError('userId required')
    if (!name?.trim() || !businessName?.trim() || !city?.trim()) {
      return jsonError('Owner naam, business name aur city zaroori hain')
    }
    if (!email?.trim()) return jsonError('Email (login) zaroori hai')

    const me = await db.user.findUnique({ where: { id: userId } })
    if (!me) return jsonError('User not found', 404)
    if (me.role !== 'MEGA_ADMIN') return jsonError('Sirf Mega Admin distributor account bana sakta hai', 403)

    const normEmail = email.toLowerCase().trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return jsonError('Email ka format sahi nahi hai')
    const dup = await db.user.findUnique({ where: { email: normEmail } })
    if (dup) return jsonError('Is email par pehle se koi account maujood hai')

    if (password !== undefined && password !== '' && String(password).length < 4) {
      return jsonError('Password kam az kam 4 harf ka ho')
    }

    const m = Number(months)
    const subMonths = Number.isFinite(m) && m >= 1 && m <= 36 ? Math.floor(m) : 1

    const cl = creditLimit != null ? Number(creditLimit) : 500000
    if (!Number.isFinite(cl) || cl < 0) return jsonError('Credit limit sahi number honi chahiye')

    const now = new Date()
    const created = await db.user.create({
      data: {
        name: name.trim(),
        email: normEmail,
        password: password?.trim() ? String(password).trim() : 'demo123',
        role: 'DISTRIBUTOR',
        phone: phone?.trim() || null,
        region: region?.trim() || null,
        isActive: true,
        subscriptionStart: now,
        subscriptionExpiry: addMonths(now, subMonths),
        profile: {
          create: {
            businessName: businessName.trim(),
            city: city.trim(),
            region: region?.trim() || '',
            creditLimit: Math.round(cl * 100) / 100,
            tier: 'PRIMARY',
          },
        },
      },
      include: { profile: true },
    })

    return Response.json({
      distributor: {
        id: created.id,
        name: created.name,
        email: created.email,
        businessName: created.profile?.businessName ?? null,
        city: created.profile?.city ?? null,
        isActive: created.isActive,
        subscriptionExpiry: created.subscriptionExpiry ? created.subscriptionExpiry.toISOString() : null,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Distributor account create failed', 500)
  }
}
