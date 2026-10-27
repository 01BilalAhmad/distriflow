import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

/**
 * Warehouse management (Task 21-k, Task 22 update) — create / edit / delete warehouses.
 * GET  -> owner list (ab caller ka apna profile)
 * POST { name, city, isPrimary? } -> naya warehouse (caller ke apne naam par)
 * Scope: DISTRIBUTOR apne warehouses — mega admin business se door hai.
 * Task 95: identity cookie se (userId param/body IGNORE — IDOR band).
 */

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    // caller ka apna profile hi owner hai (network apna khud manage karta hai)
    const owners = user.profile
      ? [{ id: user.profile.id, businessName: user.profile.businessName, tier: user.profile.tier }]
      : []

    return Response.json({ owners })
  } catch (e) {
    console.error(e)
    return jsonError('Warehouse owners load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mbp = megaBlocked(user.role)
    if (mbp) return mbp
    if (user.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor warehouse bana sakta hai', 403)

    const body = await req.json()
    const { name, city, isPrimary } = body
    if (!name?.trim() || !city?.trim()) return jsonError('Warehouse ka naam aur city required hain')

    // owner: hamesha caller ka apna profile
    const ownerId = user.profile?.id ?? null
    if (!ownerId) return jsonError('Distributor select karein (warehouse kis distributor ka hai?)')
    const owner = await db.distributorProfile.findUnique({ where: { id: ownerId } })
    if (!owner) return jsonError('Distributor profile nahi mila', 404)

    // duplicate name guard — usi distributor ke warehouses mein naam unique
    const dup = await db.warehouse.findFirst({ where: { distributorId: ownerId, name: name.trim() } })
    if (dup) return jsonError('Is distributor ka is naam ka warehouse pehle se maujood hai')

    const warehouse = await db.$transaction(async (tx) => {
      if (isPrimary) {
        await tx.warehouse.updateMany({ where: { distributorId: ownerId }, data: { isPrimary: false } })
      }
      return tx.warehouse.create({
        data: {
          name: name.trim(),
          city: city.trim(),
          isPrimary: !!isPrimary,
          distributorId: ownerId,
        },
      })
    })

    return Response.json({ warehouse })
  } catch (e) {
    console.error(e)
    return jsonError('Warehouse create failed', 500)
  }
}
