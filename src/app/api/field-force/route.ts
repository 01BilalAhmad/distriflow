import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import type { SalesmanPerfDTO, BookerParentDTO } from '@/lib/dms-types'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb

    let salesmen
    if (me.role === 'SALESMAN') {
      const meWithCo = await db.user.findUnique({ where: { id: me.id }, include: { parent: { select: { name: true } }, company: { select: { id: true, name: true, shortCode: true } } } })
      salesmen = meWithCo ? [meWithCo] : []
    } else {
      const profileUser = await db.distributorProfile.findUnique({ where: { id: me.profile!.id } })
      salesmen = await db.user.findMany({
        where: { role: 'SALESMAN', parentId: profileUser!.userId },
        include: { parent: { select: { name: true } }, company: { select: { id: true, name: true, shortCode: true } } },
      })
    }

    // Parent list sirf informational — ab naya booker hamesha caller ke apne under banta hai
    const parents: BookerParentDTO[] = []

    const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    const monthKey = `${mStart.getFullYear()}-${String(mStart.getMonth() + 1).padStart(2, '0')}`

    const [monthOrders, targets, outlets, todayPlans] = await Promise.all([
      db.order.findMany({
        // Task 67: CANCELLED orders sales/target nahi hote — reports/targets jaisa hi base
        where: { orderDate: { gte: mStart }, salesmanId: { in: salesmen.map((s) => s.id) }, status: { not: 'CANCELLED' } },
        select: { salesmanId: true, total: true, orderDate: true },
      }),
      db.salesTarget.findMany({ where: { month: monthKey, salesmanId: { in: salesmen.map((s) => s.id) } } }),
      db.outlet.findMany({ where: { salesmanId: { in: salesmen.map((s) => s.id) } }, select: { salesmanId: true } }),
      db.pJPPlan.findMany({
        where: { salesmanId: { in: salesmen.map((s) => s.id) } },
        include: { visits: true },
        orderBy: { date: 'desc' },
      }),
    ])

    const result: SalesmanPerfDTO[] = salesmen.map((s) => {
      const mo = monthOrders.filter((o) => o.salesmanId === s.id)
      const target = targets.find((t) => t.salesmanId === s.id)?.targetValue ?? 0
      const sales = mo.reduce((sum, o) => sum + o.total, 0)
      const sPlans = todayPlans.filter((p) => p.salesmanId === s.id)
      const totalVisits = sPlans.reduce((n, p) => n + p.visits.length, 0)
      const doneVisits = sPlans.reduce((n, p) => n + p.visits.filter((v) => v.status === 'COMPLETED').length, 0)
      const lastActive = mo.length > 0 ? mo.map((o) => new Date(o.orderDate)).sort((a, b) => b.getTime() - a.getTime())[0] : null

      return {
        id: s.id,
        name: s.name,
        email: s.email,
        phone: s.phone,
        region: s.region,
        parentId: s.parentId,
        parentName: s.parent?.name ?? null,
        companyId: s.companyId,
        companyName: s.company?.name ?? null,
        companyShortCode: s.company?.shortCode ?? null,
        outletsAssigned: outlets.filter((o) => o.salesmanId === s.id).length,
        monthOrders: mo.length,
        monthSales: sales,
        monthTarget: target,
        achievement: target > 0 ? Math.round((sales / target) * 100) : 0,
        pjpCompliance: totalVisits > 0 ? Math.round((doneVisits / totalVisits) * 100) : 0,
        lastActive: lastActive ? lastActive.toISOString() : null,
      }
    })

    result.sort((a, b) => b.monthSales - a.monthSales)
    return Response.json({ salesmen: result, parents })
  } catch (e) {
    console.error(e)
    return jsonError('Field force load failed', 500)
  }
}

/**
 * POST /api/field-force — naya order booker (SALESMAN user) banao (Task 21-n, Task 22 update).
 * Body: { name, email, phone?, region?, password?, companyId? }
 * DISTRIBUTOR APNE network ke under booker banata hai (parentId auto = caller).
 * Distributor chahe to booker ko company assign bhi kar sakta hai (ab Admin nahi — mega admin
 * business data se door hai). Password default "demo123" — bcrypt-hash store hota hai (Task 95).
 */
export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const caller = auth.user
    const mbp = megaBlocked(caller.role)
    if (mbp) return mbp
    if (caller.role !== 'DISTRIBUTOR') {
      return jsonError('Sirf Distributor apne order booker bana sakta hai', 403)
    }

    const body = await req.json()
    const { name, email, phone, region, password, companyId } = body
    if (!name?.trim() || !email?.trim()) return jsonError('Order booker ka naam aur email zaroori hain')

    const normEmail = email.toLowerCase().trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return jsonError('Email ka format sahi nahi hai')

    // parent: hamesha caller khud (distributor apna network khud banata hai)
    const ownerUserId = caller.id
    if (!ownerUserId) return jsonError('Parent distributor select karein (ye booker kis ke under hoga?)')
    const parent = await db.user.findUnique({ where: { id: ownerUserId } })
    if (!parent || parent.role !== 'DISTRIBUTOR') {
      return jsonError('Parent distributor nahi mila', 404)
    }

    const dup = await db.user.findUnique({ where: { email: normEmail } })
    if (dup) return jsonError('Is email par pehle se koi user maujood hai')

    if (password !== undefined && password !== '' && String(password).length < 4) {
      return jsonError('Password kam az kam 4 harf ka ho')
    }

    if (companyId) {
      // company caller ke apne tenant ki honi chahiye (Task 23 isolation)
      const co = await db.company.findFirst({ where: { id: companyId, distributorId: caller.profile?.id } })
      if (!co) return jsonError('Company nahi mili (ya aap ki nahi hai)', 404)
    }

    const created = await db.user.create({
      data: {
        name: name.trim(),
        email: normEmail,
        // Task 95: password kabhi plaintext store nahi — bcrypt hash (default demo123 bhi hash hota hai)
        password: await bcrypt.hash(password?.trim() ? String(password).trim() : 'demo123', 10),
        role: 'SALESMAN',
        phone: phone?.trim() || null,
        region: region?.trim() || parent.region || null,
        parentId: ownerUserId,
        companyId: companyId || null,
      },
      include: { company: { select: { id: true, name: true, shortCode: true } } },
    })

    return Response.json({
      salesman: {
        id: created.id,
        name: created.name,
        email: created.email,
        phone: created.phone,
        region: created.region,
        parentId: created.parentId,
        companyId: created.companyId,
        companyName: created.company?.name ?? null,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Order booker create failed', 500)
  }
}
