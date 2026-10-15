import { db } from '@/lib/db'
import { jsonError, distributorTenant } from '@/lib/dms-scope'
import { packData } from '../../products/route'

// Task 30 — BULK PRODUCTS IMPORT: Excel/CSV se poora catalog ek sath add.
// Rules:
// - sku, name, brand, tradePrice required; duplicate SKU (tenant ke andar, case-insensitive) SKIP
// - brand find-or-create per-tenant (single-add jaisa)
// - company naam se match — na mile to NAYI company auto-create (shortCode naam se derive)
// - pack normalize packData() se hi (boxes*pcs = unitsPerCarton enforce)
// - Task 37: optional 'gstRate' column — khali = 18% default, number = wo rate, no/off = GST nahi

/** Company shortCode naam se: "English Biscuit Manufacturers" -> "EBM" (max 4) */
function deriveShortCode(name: string): string {
  const words = name.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
  const initials = words.map((w) => w[0]).join('').toUpperCase()
  return (initials.length >= 2 ? initials : name.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4)).slice(0, 4).toUpperCase()
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, rows } = body as { userId?: string; rows?: Record<string, unknown>[] }
    if (!userId) return jsonError('userId required')
    if (!Array.isArray(rows) || rows.length === 0) return jsonError('Import rows khali hain')
    if (rows.length > 500) return jsonError('Ek dafa mein max 500 products import ho sakte hain')

    const t = await distributorTenant(userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    // Caches — brand/company/sku (tenant scope, case-insensitive)
    const [brands, companies, products] = await Promise.all([
      db.brand.findMany({ where: { distributorId: tenantId }, select: { id: true, name: true } }),
      db.company.findMany({ where: { distributorId: tenantId }, select: { id: true, name: true } }),
      db.product.findMany({ where: { distributorId: tenantId }, select: { sku: true } }),
    ])
    const brandMap = new Map(brands.map((b) => [b.name.toLowerCase(), b.id]))
    const companyMap = new Map(companies.map((c) => [c.name.toLowerCase(), c.id]))
    const seenSkus = new Set(products.map((p) => p.sku.toLowerCase()))

    const skipped: { row: number; name: string; reason: string }[] = []
    const warnings: { row: number; name: string; reason: string }[] = []

    const created: { id: string; sku: string; name: string }[] = []
    await db.$transaction(async (tx) => {
      for (let i = 0; i < rows.length; i++) {
        const raw = rows[i] ?? {}
        const rowNum = i + 1
        const get = (k: string) => {
          const v = raw[k]
          if (v == null) return ''
          return String(v).trim()
        }

        const sku = get('sku')
        const name = get('name')
        const brand = get('brand')
        const tradePrice = Number(get('tradePrice'))
        if (!sku || !name || !brand || !get('tradePrice')) {
          skipped.push({ row: rowNum, name: name || sku || '(bina naam wali line)', reason: 'SKU, Product Name, Brand aur Trade Price zaroori hain' })
          continue
        }
        if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
          skipped.push({ row: rowNum, name, reason: `Trade price ghalat hai: "${get('tradePrice')}"` })
          continue
        }
        if (seenSkus.has(sku.toLowerCase())) {
          skipped.push({ row: rowNum, name, reason: `SKU "${sku}" pehle se maujood hai (duplicate)` })
          continue
        }
        seenSkus.add(sku.toLowerCase())

        // Brand find-or-create (per-tenant)
        let brandId = brandMap.get(brand.toLowerCase())
        if (!brandId) {
          const nb = await tx.brand.create({ data: { name: brand, distributorId: tenantId } })
          brandMap.set(brand.toLowerCase(), nb.id)
          brandId = nb.id
        }

        // Company naam se match — naya ho to auto-create (warning ke sath)
        let companyId: string | null = null
        const coName = get('company')
        if (coName) {
          companyId = companyMap.get(coName.toLowerCase()) ?? null
          if (!companyId) {
            const nc = await tx.company.create({ data: { name: coName, distributorId: tenantId, shortCode: deriveShortCode(coName) } })
            companyMap.set(coName.toLowerCase(), nc.id)
            companyId = nc.id
            warnings.push({ row: rowNum, name, reason: `Nayi company bani: "${coName}"` })
          }
        }

        const num = (k: string) => {
          const v = Number(get(k))
          return Number.isFinite(v) && v > 0 ? v : null
        }
        // Task 37: GST parse — khali = 18% ON; number 0-100 = ON us rate par; no/off/nai = OFF
        const gstRaw = get('gstRate').toLowerCase()
        let gstEnabled = true
        let gstRate = 18
        if (gstRaw) {
          if (['no', 'off', 'nai', 'none', 'nahi'].includes(gstRaw)) {
            gstEnabled = false
          } else if (Number.isFinite(Number(gstRaw)) && Number(gstRaw) >= 0 && Number(gstRaw) <= 100) {
            gstRate = Number(gstRaw)
          } else {
            skipped.push({ row: rowNum, name, reason: `GST % ghalat: "${get('gstRate')}" — number likhein ya no/off` })
            continue
          }
        }
        const rec = await tx.product.create({
          data: {
            sku,
            name,
            brandId,
            companyId,
            distributorId: tenantId,
            category: get('category') || 'General',
            ...packData(get('unitsPerCarton'), get('boxesPerCarton'), get('pcsPerBox')),
            purchasePrice: num('purchasePrice'),
            tradePrice,
            consumerPrice: num('consumerPrice'),
            gstEnabled,
            gstRate,
          },
        })
        created.push({ id: rec.id, sku: rec.sku, name: rec.name })
      }
    })

    return Response.json({ imported: created.length, skipped, warnings, created })
  } catch (e) {
    console.error(e)
    return jsonError('Bulk products import failed', 500)
  }
}
