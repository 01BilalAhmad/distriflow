import { db } from '@/lib/db'
import { jsonError, distributorTenant, megaBlocked } from '@/lib/dms-scope'
import { getTenantIdForSalesman } from '@/lib/dms-pjp'
import {
  matchShopCategory,
  normalizeShopChannel,
  readShopCategories,
  seedShopCategoriesIfAbsent,
  writeShopCategories,
} from '@/lib/dms-settings'

// Task 92: per-tenant SHOP categories — pehle hardcoded 4 values thin (KIRYANA/SUPERMARKET/
// WHOLESALE/GENERAL), ab admin apni marzi ki categories bana/rename/delete kar sakta hai.
// Outlet.channel string isi naam se match hota hai (Product.category jaisa name-based link) —
// rename par shops + channel-schemes dono naye naam par move hote hain (rename-safe).
// Storage AppSetting KV (shopCategories JSON[]) — ZERO schema migration (Task 78 pattern).
// DELETE par channel-scheme block: scheme silently ALL-channels par switch hona margin-loss
// hai (Task 55 wala user decision: block).

const MAX_NAME = 40

function cleanName(raw: unknown): string {
  return String(raw ?? '').trim()
}

/** GET reader — distributor apni list, order booker apne distributor ki (tag form select ke liye) */
async function tenantForRead(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!user) return null
  const mb = megaBlocked(user.role)
  if (mb) return null
  if (user.role === 'DISTRIBUTOR' && user.profile) return user.profile.id
  if (user.role === 'SALESMAN') return getTenantIdForSalesman(user.id)
  return null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')
    const tenantId = await tenantForRead(userId)
    if (!tenantId) return jsonError('Shop categories sirf distributor/booker dekh sakte hain', 403)

    // First run: 4 default categories seed (idempotent — products jaisa hi pattern)
    await seedShopCategoriesIfAbsent(tenantId)
    const cats = await readShopCategories(tenantId)

    // Counts normalized match par — legacy case-variants (kiryana vs KIRYANA) bhi aggregate hon
    const outletCounts = await db.outlet.groupBy({
      by: ['channel'],
      where: { distributorId: tenantId },
      _count: { _all: true },
    })
    const outletMap = new Map(outletCounts.map((c) => [normalizeShopChannel(c.channel), c._count._all]))

    const schemeCounts = await db.scheme.groupBy({
      by: ['channel'],
      where: { distributorId: tenantId, channel: { not: null } },
      _count: { _all: true },
    })
    const schemeMap = new Map(schemeCounts.map((c) => [normalizeShopChannel(c.channel), c._count._all]))

    return Response.json({
      categories: cats.map((name) => ({
        name,
        outletCount: outletMap.get(normalizeShopChannel(name)) ?? 0,
        schemeCount: schemeMap.get(normalizeShopChannel(name)) ?? 0,
      })),
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
    const clean = cleanName(name)
    if (!clean) return jsonError('Category ka naam required hai')
    if (clean.length > MAX_NAME) return jsonError(`Category ka naam ${MAX_NAME} characters se lamba nahi ho sakta`)
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error

    const cats = await readShopCategories(t.tenantId)
    // Duplicate-safe: same naam (case/underscore-insensitive) wapas — naya row nahi banta
    const existing = matchShopCategory(cats, clean)
    if (existing) return Response.json({ category: { name: existing }, duplicate: true })

    cats.push(clean)
    await writeShopCategories(t.tenantId, cats)
    return Response.json({ category: { name: clean } })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}

// Rename — Category ka naam badlo to us channel ki shops + schemes bhi naye naam par chale
// jate hain (interactive transaction — list + shops + schemes ek sath). Same naam (case-insensitive)
// ki dusri category par rename = MERGE: shops/schemes clash par move, purani list se hat jati hai.
export async function PATCH(req: Request) {
  try {
    const body = await req.json()
    const { userId, from, to } = body as { userId?: string; from?: string; to?: string }
    if (!userId) return jsonError('userId required')
    const cleanFrom = cleanName(from)
    const cleanTo = cleanName(to)
    if (!cleanFrom || !cleanTo) return jsonError('Purana aur naya naam dono required hain')
    if (cleanTo.length > MAX_NAME) return jsonError(`Category ka naam ${MAX_NAME} characters se lamba nahi ho sakta`)
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const cats = await readShopCategories(tenantId)
    const fromCat = matchShopCategory(cats, cleanFrom)
    if (!fromCat) return jsonError('Category nahi mili', 404)
    if (fromCat === cleanTo) return Response.json({ category: { name: fromCat }, moved: 0, schemes: 0 })

    const clash = matchShopCategory(cats.filter((c) => c !== fromCat), cleanTo)
    const next = clash
      ? cats.filter((c) => c !== fromCat)
      : cats.map((c) => (c === fromCat ? cleanTo : c))
    const target = clash ?? cleanTo

    const { moved, schemes } = await db.$transaction(async (tx) => {
      const out = await tx.outlet.updateMany({ where: { distributorId: tenantId, channel: fromCat }, data: { channel: target } })
      const sch = await tx.scheme.updateMany({ where: { distributorId: tenantId, channel: fromCat }, data: { channel: target } })
      await writeShopCategories(tenantId, next, tx)
      return { moved: out.count, schemes: sch.count }
    })
    return Response.json({ category: { name: target }, moved, schemes, merged: !!clash })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const name = searchParams.get('name')
    const moveTo = (searchParams.get('moveTo') ?? 'GENERAL').trim() || 'GENERAL'
    if (!userId || !name) return jsonError('userId aur name required hain')
    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const cats = await readShopCategories(tenantId)
    const cat = matchShopCategory(cats, name)
    if (!cat) return jsonError('Category nahi mili', 404)

    // Task 55 pattern: scheme isi channel par bani ho to delete BLOCK — warna wo silently
    // ALL channels par switch ho jati (user margin khota). Pehle scheme ka channel badlo.
    const schemeCount = await db.scheme.count({ where: { distributorId: tenantId, channel: cat } })
    if (schemeCount > 0) {
      return jsonError(`Ye category ${schemeCount} scheme${schemeCount > 1 ? 's' : ''} par use ho rahi hai — pehle un schemes ka channel change karein`, 409)
    }
    if (cats.length <= 1) return jsonError('Aakhri category delete nahi ho sakti — pehle nayi category banayein')

    const moveToCat = matchShopCategory(cats.filter((c) => c !== cat), moveTo)
    if (!moveToCat) return jsonError(`Target category "${moveTo}" list mein nahi hai — pehle usay banayein ya dusri target dein`, 400)

    const moved = await db.$transaction(async (tx) => {
      const out = await tx.outlet.updateMany({ where: { distributorId: tenantId, channel: cat }, data: { channel: moveToCat } })
      await writeShopCategories(tenantId, cats.filter((c) => c !== cat), tx)
      return out.count
    })
    return Response.json({ ok: true, moved, moveTo: moveToCat })
  } catch (e) {
    return jsonError(e instanceof Error ? e.message : 'Server error', 500)
  }
}
