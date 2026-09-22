import { db } from '@/lib/db'
import { jsonError, distributorTenant } from '@/lib/dms-scope'
import { packData } from '../route'

/**
 * PATCH /api/products/[id] — product edit + rate update (DISTRIBUTOR, apna catalog)
 * Editable: sku, name, brand, companyId, category, pack sizes (unitsPerCarton / boxesPerCarton / pcsPerBox),
 * purchasePrice, tradePrice, consumerPrice, isActive.
 * Note: rate change sirf NAYE orders par asar karta hai — purani invoices apna rate snapshot rakhti hain.
 * Task 23: sirf APNE tenant ka product edit ho sakta hai.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    // Task 22/23: caller verify — DISTRIBUTOR-only + tenant resolve
    if (!body.userId) return jsonError('userId required')
    const t = await distributorTenant(body.userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const existing = await db.product.findUnique({ where: { id } })
    if (!existing) return jsonError('Product not found', 404)
    // ownership — doosre distributor ka product locked
    if (existing.distributorId !== tenantId) return jsonError('Ye product aap ke catalog ka nahi hai', 403)

    const { sku, name, brand, companyId, category, unitsPerCarton, boxesPerCarton, pcsPerBox, purchasePrice, tradePrice, consumerPrice, isActive } = body

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
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
    })
    return Response.json({ product })
  } catch (e) {
    console.error(e)
    return jsonError('Product update failed', 500)
  }
}
