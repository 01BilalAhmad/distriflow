import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import type { HierarchyNode } from '@/lib/dms-types'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb

    const mStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)

    const allUsers = await db.user.findMany({
      where: { role: { in: ['DISTRIBUTOR', 'SALESMAN'] } },
      include: {
        profile: true,
        parent: { select: { id: true, name: true } },
        outlets: { select: { id: true } },
      },
    })

    // Scope (Task 22): distributor ko sirf APNA subtree dikhta hai —
    // doosre distributors ka network + sales numbers is view mein kabhi nazar nahi aate.
    const visible = new Set<string>()
    const queue = [me.id]
    while (queue.length) {
      const cur = queue.shift()!
      if (visible.has(cur)) continue
      visible.add(cur)
      for (const u of allUsers) if (u.parentId === cur) queue.push(u.id)
    }
    const users = allUsers.filter((u) => visible.has(u.id))

    const monthOrders = await db.order.findMany({
      where: { orderDate: { gte: mStart } },
      select: { distributorId: true, total: true },
    })

    const toNode = (u: (typeof users)[number]): HierarchyNode => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      region: u.region,
      phone: u.phone,
      businessName: u.profile?.businessName,
      city: u.profile?.city,
      creditLimit: u.profile?.creditLimit,
      outletsCount: u.outlets.length,
      monthSales:
        u.role === 'SALESMAN'
          ? 0
          : monthOrders.filter((o) => o.distributorId === u.profile?.id).reduce((s, o) => s + o.total, 0),
      children: [],
    })

    const byId = new Map(users.map((u) => [u.id, toNode(u)]))
    const roots: HierarchyNode[] = []
    for (const u of users) {
      const node = byId.get(u.id)!
      // scope: caller khud root hai (ya jab parent scoped set mein nahi)
      if (u.id === me.id || (u.role === 'DISTRIBUTOR' && visible.has(u.id) && !u.parentId) || !u.parentId || !byId.has(u.parentId)) {
        roots.push(node)
      } else {
        byId.get(u.parentId)!.children.push(node)
      }
    }

    // attach salesman month sales
    const salesmanOrders = await db.order.findMany({
      where: { orderDate: { gte: mStart }, salesmanId: { not: null } },
      select: { salesmanId: true, total: true },
    })
    for (const [id, node] of byId) {
      if (node.role === 'SALESMAN') {
        node.monthSales = salesmanOrders.filter((o) => o.salesmanId === id).reduce((s, o) => s + o.total, 0)
      }
    }

    return Response.json({ hierarchy: roots })
  } catch (e) {
    console.error(e)
    return jsonError('Hierarchy load failed', 500)
  }
}
