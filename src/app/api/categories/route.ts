import { db } from '@/lib/db'
import { jsonError, distributorTenant } from '@/lib/dms-scope'

// Task 53: per-tenant product categories — GET (list + first-run seed), POST (naya
// category), DELETE (sirf jab koi product use na kar raha ho). Product.category
// string isi table ke naam se match hota hai.

const DEFAULT_CATEGORIES = ['Tea', 'Beverages', 'Dairy', 'Snacks', 'Home Care', 'Personal Care', 'Chocolate', 'Candy', 'Wafer', 'Mints']

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')
    const t = await distributorTenant(userId)
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
    const body = await req.json()
    const { userId, name } = body as { userId?: string; name?: string }
    if (!userId) return jsonError('userId required')
    const clean = (name ?? '').trim()
    if (!clean) return jsonError('Category ka naam required hai')
    if (clean.length > 40) return jsonError('Category ka naam 40 characters se lamba nahi ho sakta')
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error

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
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const id = searchParams.get('id')
    const moveTo = (searchParams.get('moveTo') ?? 'General').trim() || 'General'
    if (!userId || !id) return jsonError('userId aur id required hain')
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error

    const cat = await db.category.findFirst({ where: { id, distributorId: t.tenantId } })
    if (!cat) return jsonError('Category nahi mili', 404)
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
    const body = await req.json()
    const { userId, id, name } = body as { userId?: string; id?: string; name?: string }
    if (!userId || !id) return jsonError('userId aur id required hain')
    const clean = (name ?? '').trim()
    if (!clean) return jsonError('Category ka naam required hai')
    if (clean.length > 40) return jsonError('Category ka naam 40 characters se lamba nahi ho sakta')
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error

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
