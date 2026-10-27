import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

// Task 53: per-tenant product categories — GET (list + first-run seed), POST (naya
// category), DELETE (products moveTo General par shift), PATCH (rename + merge).
// Product.category string isi table ke naam se match hota hai.
// Task 55: scheme us category ko refer karti ho to DELETE blocked — scheme ka target
// ALL products par switch hona silent margin-loss hai (user decision: block).
// Task 95: identity cookie se — distributorTenant(userId) helper ki jagah cookie-user
// par direct checks (same semantics: mega block → DISTRIBUTOR-only → profile required).
function distributorTenantOf(user: AuthedUser): { tenantId: string; error?: never } | { tenantId?: never; error: Response } {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}

const DEFAULT_CATEGORIES = ['Tea', 'Beverages', 'Dairy', 'Snacks', 'Home Care', 'Personal Care', 'Chocolate', 'Candy', 'Wafer', 'Mints']

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    // First run: 10 default categories seed (idempotent — duplicate safe)
    const existing = await db.category.count({ where: { distributorId: tenantId } })
    if (existing === 0) {
      await db.category.createMany({
        data: DEFAULT_CATEGORIES.map((name) => ({ name, distributorId: tenantId })),
        skipDuplicates: true,
      })
    }

    const cats = await db.category.findMany({
      where: { distributorId: tenantId },
      orderBy: { name: 'asc' },
    })
    const counts = await db.product.groupBy({
      by: ['category'],
      where: { distributorId: tenantId },
      _count: { _all: true },
    })
    const countMap = new Map(counts.map((c) => [c.category, c._count._all]))
    return Response.json({
      categories: cats.map((c) => ({ id: c.id, name: c.name, productCount: countMap.get(c.name) ?? 0 })),
    })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error

    const body = await req.json()
    const { name } = body as { name?: string }
    const clean = (name ?? '').trim()
    if (!clean) return jsonError('Category ka naam required hai')
    if (clean.length > 40) return jsonError('Category ka naam 40 characters se lamba nahi ho sakta')

    // Duplicate-safe: same naam wali wapas (UI ko select karne ke liye id chahiye)
    const cat = await db.category.upsert({
      where: { name_distributorId: { name: clean, distributorId: t.tenantId } },
      update: {},
      create: { name: clean, distributorId: t.tenantId },
    })
    return Response.json({ category: { id: cat.id, name: cat.name } })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}

export async function DELETE(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    const moveTo = (searchParams.get('moveTo') ?? 'General').trim() || 'General'
    if (!id) return jsonError('id required hai')

    const cat = await db.category.findFirst({ where: { id, distributorId: t.tenantId } })
    if (!cat) return jsonError('Category nahi mili', 404)

    // Task 55: scheme isi category par bani ho to delete BLOCK — warna wo scheme silently
    // ALL products par switch ho jati (categoryId SetNull). Pehle scheme ka target badlo.
    const schemeCount = await db.scheme.count({ where: { categoryId: id } })
    if (schemeCount > 0) {
      return jsonError(`Ye category ${schemeCount} scheme${schemeCount > 1 ? 's' : ''} par use ho rahi hai — pehle us scheme ka target change karein`, 409)
    }

    const inUse = await db.product.count({ where: { distributorId: t.tenantId, category: cat.name } })

    // Task 53b: in-use category delete ho to products moveTo (default General) par chale jate
    // hain — General category row bhi ensure hoti hai (dropdown consistent rahe).
    let moved = 0
    if (inUse > 0) {
      if (moveTo === cat.name) return jsonError('Products isi category par hain — dusra target dein')
      await db.category.upsert({
        where: { name_distributorId: { name: moveTo, distributorId: t.tenantId } },
        update: {},
        create: { name: moveTo, distributorId: t.tenantId },
      })
      const res = await db.product.updateMany({
        where: { distributorId: t.tenantId, category: cat.name },
        data: { category: moveTo },
      })
      moved = res.count
    }
    await db.category.delete({ where: { id } })
    return Response.json({ ok: true, moved })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}

// Task 53b: rename — Category ka naam badlo to us category ke products bhi naye naam par
// (category sirf Product.category string hai, isi liye updateMany zaroori).
export async function PATCH(req: Request) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error

    const body = await req.json()
    const { id, name } = body as { id?: string; name?: string }
    if (!id) return jsonError('id required hai')
    const clean = (name ?? '').trim()
    if (!clean) return jsonError('Category ka naam required hai')
    if (clean.length > 40) return jsonError('Category ka naam 40 characters se lamba nahi ho sakta')

    const cat = await db.category.findFirst({ where: { id, distributorId: t.tenantId } })
    if (!cat) return jsonError('Category nahi mili', 404)
    if (cat.name === clean) return Response.json({ category: { id: cat.id, name: cat.name }, moved: 0 })

    // Naam clash: same naam ki dusri category maujood hai — merge kar do (products move + old delete)
    const clash = await db.category.findFirst({
      where: { distributorId: t.tenantId, name: { equals: clean, mode: 'insensitive' }, id: { not: id } },
    })
    if (clash) {
      const res = await db.product.updateMany({
        where: { distributorId: t.tenantId, category: cat.name },
        data: { category: clash.name },
      })
      // Task 55: merge par schemes bhi clash category par re-point — SetNull ho kar
      // ALL-products par switch hone se pehle (rename-safe FK join isi liye hai)
      await db.scheme.updateMany({ where: { categoryId: id }, data: { categoryId: clash.id } })
      await db.category.delete({ where: { id } })
      return Response.json({ category: { id: clash.id, name: clash.name }, moved: res.count, merged: true })
    }

    const [updated, res] = await db.$transaction([
      db.category.update({ where: { id }, data: { name: clean } }),
      db.product.updateMany({ where: { distributorId: t.tenantId, category: cat.name }, data: { category: clean } }),
    ])
    return Response.json({ category: { id: updated.id, name: updated.name }, moved: res.count })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}
