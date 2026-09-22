import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * Warehouse management (Task 21-k, Task 22 update) — create / edit / delete warehouses.
 * GET  ?userId=                -> owner list (ab caller ka apna profile)
 * POST { userId, name, city, isPrimary? } -> naya warehouse (caller ke apne naam par)
 * Scope: DISTRIBUTOR apne warehouses — mega admin business se door hai.
 */

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
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
    const body = await req.json()
    const { userId, name, city, isPrimary } = body
    if (!userId) return jsonError('userId required')
    if (!name?.trim() || !city?.trim()) return jsonError('Warehouse ka naam aur city required hain')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mbp = megaBlocked(user.role)
    if (mbp) return mbp
    if (user.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor warehouse bana sakta hai', 403)

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
