import { db } from '@/lib/db'
import { jsonError, megaBlocked, tenantProfileId, distributorTenant } from '@/lib/dms-scope'
import { getAvailableToPromise } from '@/lib/dms-inventory'

/**
 * Task 23 — CATALOG TENANT ISOLATION: har distributor ka apna catalog.
 * - DISTRIBUTOR: apne profile ke products (distributorId = tenant)
 * - SALESMAN: apne owner distributor ka catalog (parent walk-up) + assigned company filter
 * - MEGA_ADMIN: 403 (business data locked)
 * Naya distributor ka catalog BILKUL KHALI hota hai.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const companyId = searchParams.get('companyId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const tenantId = await tenantProfileId(userId)
    if (!tenantId) return Response.json({ products: [], companyScoped: false })

    // Stock bhi sirf ISI tenant ke warehouses se (cross-tenant stock leak band)
    const stockFilter = { where: { warehouse: { distributorId: tenantId } } }

    const where: { isActive: boolean; distributorId: string; companyId?: string } = { isActive: true, distributorId: tenantId }
    // Order booker ki assigned company -> sirf usi company ke products
    if (user.role === 'SALESMAN' && user.companyId) where.companyId = user.companyId
    // Distributor ke liye optional company filter (catalog view)
    else if (companyId) where.companyId = companyId

    const products = await db.product.findMany({
      where,
      include: { brand: { select: { name: true } }, company: { select: { id: true, name: true, shortCode: true } }, stockBatches: stockFilter },
      orderBy: { name: 'asc' },
    })

    // Task 26: per-product ATP (stock − open bills booked qty) — order booking limit
    const atp = await getAvailableToPromise(tenantId, products.map((p) => p.id))

    const result = products.map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      brand: p.brand.name,
      company: p.company ? { id: p.company.id, name: p.company.name, shortCode: p.company.shortCode } : null,
      category: p.category,
      unitsPerCarton: p.unitsPerCarton,
      boxesPerCarton: p.boxesPerCarton,
      pcsPerBox: p.pcsPerBox,
      purchasePrice: p.purchasePrice,
      tradePrice: p.tradePrice,
      consumerPrice: p.consumerPrice,
      // Task 37: per-product GST
      gstEnabled: p.gstEnabled,
      gstRate: p.gstRate,
      stock: p.stockBatches.reduce((s, b) => s + b.qty, 0), // PIECES base
      // Task 26: ATP — stock − CONFIRMED (unprocessed) bills ki booked qty (PROCESSING van-out par deduct ho chuka hota hai).
      // Order booking UI isi ko limit ke tor par show/enforce karta hai.
      available: Math.max(0, atp.get(p.id)?.available ?? 0),
    }))

    return Response.json({ products: result, companyScoped: user.role === 'SALESMAN' && !!user.companyId })
  } catch (e) {
    console.error(e)
    return jsonError('Products load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { sku, name, brand, companyId, category, unitsPerCarton, boxesPerCarton, pcsPerBox, purchasePrice, tradePrice, consumerPrice, gstEnabled, gstRate, userId } = body
    if (!userId) return jsonError('userId required')
    if (!sku || !name || !brand || !tradePrice) return jsonError('SKU, name, brand aur trade price required hain')

    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    // brand per-tenant — find or create isi distributor ke andar
    let brandRec = await db.brand.findFirst({ where: { name: brand.trim(), distributorId: tenantId } })
    if (!brandRec) brandRec = await db.brand.create({ data: { name: brand.trim(), distributorId: tenantId } })

    // SKU duplicate check SIRF isi tenant ke andar (do distributors ka same SKU allowed)
    const exists = await db.product.findFirst({ where: { sku: sku.trim(), distributorId: tenantId } })
    if (exists) return jsonError('Ye SKU already exists hai (aap ke catalog mein)')

    if (companyId) {
      const co = await db.company.findFirst({ where: { id: companyId, distributorId: tenantId } })
      if (!co) return jsonError('Company nahi mili (ya aap ka nahi hai)', 404)
    }

    const product = await db.product.create({
      data: {
        sku, name, brandId: brandRec.id, companyId: companyId || null,
        distributorId: tenantId,
        category: category ?? 'General',
        ...packData(unitsPerCarton, boxesPerCarton, pcsPerBox),
        purchasePrice: purchasePrice ? Number(purchasePrice) : null,
        tradePrice: Number(tradePrice),
        consumerPrice: consumerPrice ? Number(consumerPrice) : null,
        // Task 37: per-product GST (rate 0-100, invalid par default 18)
        gstEnabled: gstEnabled === undefined ? true : Boolean(gstEnabled),
        gstRate: Number.isFinite(Number(gstRate)) && Number(gstRate) >= 0 && Number(gstRate) <= 100 ? Number(gstRate) : 18,
      },
    })
    return Response.json({ product })
  } catch (e) {
    console.error(e)
    return jsonError('Product create failed', 500)
  }
}

/** Pack size normalize: boxesPerCarton > 0 ho to unitsPerCarton = boxes * pcs enforce hota hai */
export function packData(unitsPerCarton: unknown, boxesPerCarton: unknown, pcsPerBox: unknown) {
  const u = Math.max(1, Math.floor(Number(unitsPerCarton) || 12))
  const b = Math.max(0, Math.floor(Number(boxesPerCarton) || 0))
  const pb = Math.max(0, Math.floor(Number(pcsPerBox) || 0))
  if (b > 0 && pb > 0) return { unitsPerCarton: b * pb, boxesPerCarton: b, pcsPerBox: pb }
  return { unitsPerCarton: u, boxesPerCarton: 0, pcsPerBox: 0 }
}
