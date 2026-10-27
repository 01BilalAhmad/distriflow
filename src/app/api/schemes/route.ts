import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

/**
 * Task 23 — SCHEMES per-tenant: har distributor apni schemes/discounts khud banata hai.
 * GET  -> sirf USI tenant ki schemes (salesman => owner distributor ki).
 * POST -> DISTRIBUTOR apni nayi scheme banata hai.
 * PATCH -> apni scheme edit/toggle.
 * Task 95: identity cookie se (userId param/body IGNORE — IDOR band).
 *
 * Task 55 — CATEGORY-WIDE + FILER SCOPE:
 * - categoryId: "Apply To: Whole Category" — puri category par ek discount (null = filter off)
 * - filerScope: null = all outlets | FILER | NON_FILER — "Non-Filer Special" sirf matching shops par
 * - Engine (computeOrderLines) FULL STACK (Task 58): jitni schemes bill qualify karein
 *   (product + channel + category + filerScope match) wo SAB lagti hain — har ek apni row
 */

// Task 95: tenantProfileId(userId) helper ki jagah cookie-user se tenant resolve
// (same semantics: apna profile, warna salesman parent walk-up, warna null)
async function tenantProfileOf(user: AuthedUser): Promise<string | null> {
  if (user.profile) return user.profile.id
  if (user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, include: { profile: true } })
    return owner?.profile?.id ?? null
  }
  return null
}

// Task 95: distributorTenant(userId) helper ki jagah cookie-user par direct checks (same semantics)
function distributorTenantOf(user: AuthedUser): { tenantId: string; error?: never } | { tenantId?: never; error: Response } {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}
const FILER_SCOPES = ['FILER', 'NON_FILER'] as const
const normScope = (v: unknown): string | null => (typeof v === 'string' && (FILER_SCOPES as readonly string[]).includes(v) ? v : null)

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const tenantId = await tenantProfileOf(auth.user)
    if (!tenantId) return Response.json({ schemes: [] })

    const schemes = await db.scheme.findMany({
      where: { distributorId: tenantId },
      include: { product: { select: { name: true } }, category: { select: { name: true } } },
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
        categoryId: s.categoryId,
        categoryName: s.category?.name ?? null,
        filerScope: s.filerScope,
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

/** Task 55: categoryId tenant ka hona chahiye — cross-tenant category par scheme nahi ban sakti */
async function validCategory(categoryId: string | null | undefined, tenantId: string) {
  if (!categoryId) return true
  const cat = await db.category.findFirst({ where: { id: categoryId, distributorId: tenantId } })
  return !!cat
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { name, description, type, channel, productId, categoryId, filerScope, value, buyQty, freeQty, startDate, endDate } = body
    if (!name || !type) return jsonError('Scheme name aur type required hain')

    // Task 23: sirf DISTRIBUTOR apni scheme bana sakta hai — tenant ke product par hi
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error
    const tenantId = t.tenantId
    if (productId) {
      const prod = await db.product.findFirst({ where: { id: productId, distributorId: tenantId } })
      if (!prod) return jsonError('Product nahi mila (ya aap ke catalog ka nahi hai)', 404)
    }
    if (categoryId && !(await validCategory(categoryId, tenantId))) {
      return jsonError('Category nahi mili (ya aap ke catalog ki nahi hai)', 404)
    }

    const scheme = await db.scheme.create({
      data: {
        name, description: description ?? null, type,
        distributorId: tenantId,
        channel: channel || null,
        productId: productId || null,
        categoryId: categoryId || null,
        filerScope: normScope(filerScope),
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
    const { id, isActive, name, description, type, channel, productId, categoryId, filerScope, value, buyQty, freeQty, startDate, endDate } = await req.json()
    if (!id) return jsonError('Scheme id required')

    // ownership — sirf apni scheme edit/toggle
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
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
    if (categoryId !== undefined && categoryId !== null && categoryId !== existing.categoryId && !(await validCategory(categoryId, t.tenantId))) {
      return jsonError('Category nahi mili (ya aap ke catalog ki nahi hai)', 404)
    }
    await db.scheme.update({
      where: { id },
      data: {
        name,
        description: description ?? null,
        type,
        channel: channel || null,
        productId: productId || null,
        categoryId: categoryId || null,
        filerScope: normScope(filerScope),
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
