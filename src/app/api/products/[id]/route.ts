import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'
import { packData } from '../route'

// Task 95: distributorTenant(userId) helper ki jagah cookie-user par direct checks (same semantics)
function distributorTenantOf(user: AuthedUser): { tenantId: string; error?: never } | { tenantId?: never; error: Response } {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}

/**
 * PATCH /api/products/[id] — product edit + rate update (DISTRIBUTOR, apna catalog)
 * Editable: sku, name, brand, companyId, category, pack sizes (unitsPerCarton / boxesPerCarton / pcsPerBox),
 * purchasePrice, tradePrice, consumerPrice, gstEnabled, gstRate, isActive.
 * Note: rate change sirf NAYE orders par asar karta hai — purani invoices apna rate snapshot rakhti hain.
 * Task 23: sirf APNE tenant ka product edit ho sakta hai.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    // Task 95: caller cookie se — DISTRIBUTOR-only + tenant resolve (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const existing = await db.product.findUnique({ where: { id } })
    if (!existing) return jsonError('Product not found', 404)
    // ownership — doosre distributor ka product locked
    if (existing.distributorId !== tenantId) return jsonError('Ye product aap ke catalog ka nahi hai', 403)

    const { sku, name, brand, companyId, category, unitsPerCarton, boxesPerCarton, pcsPerBox, purchasePrice, tradePrice, consumerPrice, gstEnabled, gstRate, isActive } = body

    // SKU unique rehna chahiye (SIRF apne tenant ke andar)
    if (sku && sku !== existing.sku) {
      const dup = await db.product.findFirst({ where: { sku: sku.trim(), distributorId: tenantId, id: { not: id } } })
      if (dup) return jsonError('Ye SKU aap ke catalog mein kisi aur product ka hai')
    }

    let brandId: string | undefined
    if (brand && brand !== existing.brandId) {
      let brandRec = await db.brand.findFirst({ where: { name: brand.trim(), distributorId: tenantId } })
      if (!brandRec) brandRec = await db.brand.create({ data: { name: brand.trim(), distributorId: tenantId } })
      brandId = brandRec.id
    }

    if (companyId) {
      const co = await db.company.findFirst({ where: { id: companyId, distributorId: tenantId } })
      if (!co) return jsonError('Company nahi mili (ya aap ka nahi hai)', 404)
    }

    const pack = packData(
      unitsPerCarton ?? existing.unitsPerCarton,
      boxesPerCarton ?? existing.boxesPerCarton,
      pcsPerBox ?? existing.pcsPerBox,
    )

    const product = await db.product.update({
      where: { id },
      data: {
        ...(sku ? { sku } : {}),
        ...(name ? { name } : {}),
        ...(brandId ? { brandId } : {}),
        ...(companyId !== undefined ? { companyId: companyId || null } : {}),
        ...(category ? { category } : {}),
        ...pack,
        ...(tradePrice != null ? { tradePrice: Number(tradePrice) } : {}),
        ...(purchasePrice !== undefined ? { purchasePrice: purchasePrice ? Number(purchasePrice) : null } : {}),
        ...(consumerPrice !== undefined ? { consumerPrice: consumerPrice ? Number(consumerPrice) : null } : {}),
        // Task 37: per-product GST — dono fields ek sath update hoti hain
        ...(gstEnabled !== undefined ? { gstEnabled: Boolean(gstEnabled) } : {}),
        ...(gstRate !== undefined && Number.isFinite(Number(gstRate)) && Number(gstRate) >= 0 && Number(gstRate) <= 100 ? { gstRate: Number(gstRate) } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    })
    return Response.json({ product })
  } catch (e) {
    console.error(e)
    return jsonError('Product update failed', 500)
  }
}
