import { db } from '@/lib/db'
import { jsonError, tenantProfileId, distributorTenant } from '@/lib/dms-scope'

/**
 * Task 23 — SCHEMES per-tenant: har distributor apni schemes/discounts khud banata hai.
 * GET  ?userId= -> sirf USI tenant ki schemes (salesman => owner distributor ki).
 * POST { userId, ... } -> DISTRIBUTOR apni nayi scheme banata hai.
 * PATCH { userId, id, isActive } -> sirf apni scheme toggle ho sakti hai.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const tenantId = await tenantProfileId(userId)
    if (!tenantId) return Response.json({ schemes: [] })

    const schemes = await db.scheme.findMany({
      where: { distributorId: tenantId },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    })
    return Response.json({
      schemes: schemes.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        type: s.type,
        channel: s.channel,
        productId: s.productId,
        productName: s.product?.name ?? null,
        value: s.value,
        buyQty: s.buyQty,
        freeQty: s.freeQty,
        startDate: new Date(s.startDate).toISOString(),
        endDate: s.endDate ? new Date(s.endDate).toISOString() : null,
        isActive: s.isActive,
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Schemes load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, type, channel, productId, value, buyQty, freeQty, startDate, endDate, userId } = body
    if (!userId) return jsonError('userId required')
    if (!name || !type) return jsonError('Scheme name aur type required hain')

    // Task 23: sirf DISTRIBUTOR apni scheme bana sakta hai — tenant ke product par hi
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId
    if (productId) {
      const prod = await db.product.findFirst({ where: { id: productId, distributorId: tenantId } })
      if (!prod) return jsonError('Product nahi mila (ya aap ke catalog ka nahi hai)', 404)
    }

    const scheme = await db.scheme.create({
      data: {
        name, description: description ?? null, type,
        distributorId: tenantId,
        channel: channel || null,
        productId: productId || null,
        value: Number(value) || 0,
        buyQty: Number(buyQty) || 0,
        freeQty: Number(freeQty) || 0,
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        isActive: true,
      },
    })
    return Response.json({ scheme: { id: scheme.id } })
  } catch (e) {
    console.error(e)
    return jsonError('Scheme create failed', 500)
  }
}

export async function PATCH(req: Request) {
  try {
    const { id, isActive, userId, name, description, type, channel, productId, value, buyQty, freeQty, startDate, endDate } = await req.json()
    if (!id) return jsonError('Scheme id required')
    if (!userId) return jsonError('userId required')

    // ownership — sirf apni scheme edit/toggle
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const existing = await db.scheme.findUnique({ where: { id } })
    if (!existing) return jsonError('Scheme nahi mili', 404)
    if (existing.distributorId !== t.tenantId) return jsonError('Ye scheme aap ki nahi hai', 403)

    // Task 41: toggle-only call (sirf isActive) — purana behavior intact
    if (name === undefined && type === undefined && value === undefined) {
      await db.scheme.update({ where: { id }, data: { isActive: !!isActive } })
      return Response.json({ ok: true })
    }

    // Task 41: full edit — new orders par naye values lagenge; PURANE bills untouched
    // (OrderItem snapshot ke saath) — discount jis % par bana, usi par rahega.
    if (!name || !type) return jsonError('Scheme name aur type required hain')
    if (productId && productId !== existing.productId) {
      const prod = await db.product.findFirst({ where: { id: productId, distributorId: t.tenantId } })
      if (!prod) return jsonError('Product nahi mila (ya aap ke catalog ka nahi hai)', 404)
    }
    await db.scheme.update({
      where: { id },
      data: {
        name,
        description: description ?? null,
        type,
        channel: channel || null,
        productId: productId || null,
        value: Number(value) || 0,
        buyQty: Number(buyQty) || 0,
        freeQty: Number(freeQty) || 0,
        ...(startDate ? { startDate: new Date(startDate) } : {}),
        endDate: endDate ? new Date(endDate) : null,
        ...(isActive !== undefined ? { isActive: !!isActive } : {}),
      },
    })
    return Response.json({ ok: true })
  } catch (e) {
    console.error(e)
    return jsonError('Scheme update failed', 500)
  }
}
