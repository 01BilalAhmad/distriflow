import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

/**
 * Warehouse edit/delete (Task 21-k, Task 22 update).
 * PATCH  { name?, city?, isPrimary? } -> naam/city/primary edit
 * DELETE -> khali warehouse delete (stock/deliveries/summaries/adjustments hon to block)
 * Scope: DISTRIBUTOR sirf apna warehouse.
 * Task 95: identity cookie se (userId param/body IGNORE — IDOR band).
 */

async function loadOwned(id: string, user: AuthedUser) {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Permission nahi hai', 403) }

  const warehouse = await db.warehouse.findUnique({ where: { id } })
  if (!warehouse) return { error: jsonError('Warehouse nahi mila', 404) }

  // sirf apne distributor ke warehouse chhed sakta hai
  if (warehouse.distributorId !== user.profile?.id) {
    return { error: jsonError('Ye warehouse aapka nahi hai', 403) }
  }
  return { user, warehouse }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const body = await req.json()
    const { name, city, isPrimary } = body

    const owned = await loadOwned(id, auth.user)
    if (owned.error) return owned.error
    const { warehouse } = owned

    const data: { name?: string; city?: string; isPrimary?: boolean } = {}
    if (name !== undefined) {
      if (!name.trim()) return jsonError('Warehouse ka naam khali nahi ho sakta')
      // duplicate name guard (apne siwaye is warehouse ke)
      const dup = await db.warehouse.findFirst({
        where: { distributorId: warehouse.distributorId, name: name.trim(), id: { not: id } },
      })
      if (dup) return jsonError('Is naam ka warehouse pehle se maujood hai')
      data.name = name.trim()
    }
    if (city !== undefined) {
      if (!city.trim()) return jsonError('City khali nahi ho sakti')
      data.city = city.trim()
    }
    if (isPrimary !== undefined) data.isPrimary = !!isPrimary

    const updated = await db.$transaction(async (tx) => {
      // primary set hui to usi distributor ke baqi warehouses se primary hatao
      if (data.isPrimary) {
        await tx.warehouse.updateMany({
          where: { distributorId: warehouse.distributorId, id: { not: id } },
          data: { isPrimary: false },
        })
      }
      // primary hatayi aur ye akela warehouse tha -> wapas primary (har distributor ka 1 primary zaroori)
      if (data.isPrimary === false) {
        const others = await tx.warehouse.count({ where: { distributorId: warehouse.distributorId, isPrimary: true, id: { not: id } } })
        if (others === 0) data.isPrimary = true
      }
      return tx.warehouse.update({ where: { id }, data })
    })

    return Response.json({ warehouse: updated })
  } catch (e) {
    console.error(e)
    return jsonError('Warehouse update failed', 500)
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const owned = await loadOwned(id, auth.user)
    if (owned.error) return owned.error
    const { warehouse } = owned

    // relation guard — stock ya records wale warehouse ko delete nahi karne dete
    const [batches, deliveries, summaries, adjustments] = await Promise.all([
      db.stockBatch.count({ where: { warehouseId: id } }),
      db.delivery.count({ where: { warehouseId: id } }),
      db.deliverySummary.count({ where: { warehouseId: id } }),
      db.stockAdjustment.count({ where: { warehouseId: id } }),
    ])
    const blocks: string[] = []
    if (batches > 0) blocks.push(`${batches} stock batches`)
    if (deliveries > 0) blocks.push(`${deliveries} deliveries`)
    if (summaries > 0) blocks.push(`${summaries} summaries`)
    if (adjustments > 0) blocks.push(`${adjustments} adjustments`)
    if (blocks.length > 0) {
      return jsonError(`Ye warehouse khali nahi hai (${blocks.join(', ')}) — pehla stock/record transfer ya clear karein`)
    }

    await db.warehouse.delete({ where: { id } })

    // agar distributor ka primary warehouse delete ho gaya -> pehle baqi ko primary banao (1 primary zaroori)
    if (warehouse.isPrimary) {
      const remaining = await db.warehouse.findMany({
        where: { distributorId: warehouse.distributorId },
        orderBy: { name: 'asc' },
        take: 1,
      })
      if (remaining[0]) {
        await db.warehouse.update({ where: { id: remaining[0].id }, data: { isPrimary: true } })
      }
    }

    return Response.json({ ok: true })
  } catch (e) {
    console.error(e)
    return jsonError('Warehouse delete failed', 500)
  }
}
