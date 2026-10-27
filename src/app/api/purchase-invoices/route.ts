import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

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

/** GET /api/purchase-invoices?companyId= — list with company + items summary (apna tenant) */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId') || undefined

    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const tenantId = await tenantProfileOf(auth.user)
    if (!tenantId) return Response.json({ invoices: [] })

    const invoices = await db.purchaseInvoice.findMany({
      where: { distributorId: tenantId, ...(companyId ? { companyId } : {}) },
      orderBy: { date: 'desc' },
      include: {
        company: { select: { name: true, shortCode: true, logo: true } },
        items: {
          include: { product: { select: { sku: true, name: true, unitsPerCarton: true } } },
          orderBy: { id: 'asc' },
        },
      },
    })
    return Response.json({
      invoices: invoices.map((i) => ({
        id: i.id,
        invoiceNo: i.invoiceNo,
        supplierInvoiceNo: i.supplierInvoiceNo,
        companyId: i.companyId,
        companyName: i.company.name,
        companyShortCode: i.company.shortCode,
        companyLogo: i.company.logo,
        date: i.date,
        subtotal: i.subtotal,
        discount: i.discount,
        discountPct: i.discountPct,
        taxTotal: i.taxTotal,
        advanceTaxPct: i.advanceTaxPct,
        advanceTaxTotal: i.advanceTaxTotal,
        tradeOfferTotal: i.tradeOfferTotal,
        total: i.total,
        paidAmount: i.paidAmount,
        status: i.status,
        notes: i.notes,
        items: i.items.map((it) => ({
          id: it.id,
          productId: it.productId,
          sku: it.product.sku,
          productName: it.product.name,
          batchNo: it.batchNo,
          expDate: it.expDate,
          cartons: it.cartons,
          unitsPerCarton: it.product.unitsPerCarton,
          units: it.units,
          purchasePrice: it.purchasePrice,
          lineTotal: it.lineTotal,
          discountPct: it.discountPct,
          discountAmt: it.discountAmt,
          netAmount: it.netAmount,
          gstRate: it.gstRate,
          salesTax: it.salesTax,
          furtherTaxPct: it.furtherTaxPct,
          furtherTax: it.furtherTax,
          totalTax: it.totalTax,
          tradeOfferAmt: it.tradeOfferAmt,
          advanceTax: it.advanceTax,
          amountInclusive: it.amountInclusive,
        })),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Purchase invoices load failed', 500)
  }
}

interface ItemBody {
  productId?: string
  cartons?: number
  purchasePrice?: number
  batchNo?: string
  expDate?: string | null
  /** Task 43: per-item % discount / invoice ka "Pass On" (0-100); lineTotal gross par apply hota hai */
  discountPct?: number
  /** Task 44: GST % override — na do to product ka gstRate snapshot hoga (gstEnabled false = 0) */
  gstRate?: number
  /** Task 44: Further Sales Tax % (invoice column; default 0) */
  furtherTaxPct?: number
  /** Task 44: Trade Offer Rs (scheme value — net+tax se minus hota hai) */
  tradeOfferAmt?: number
}

interface InvoicePostBody {
  companyId?: string
  date?: string
  supplierInvoiceNo?: string
  /** flat Rs discount (purana mode — discountPct > 0 ho to ye ignore hota hai) */
  discount?: number
  /** Task 43: bill-level % discount (subtotal par) — percentage mode */
  discountPct?: number
  /** Task 44: invoice-level Advance Tax 236H % (default 0.5 — company invoice jaisa; 0 bhejo to band) */
  advanceTaxPct?: number
  paidNow?: number
  notes?: string
  items?: ItemBody[]
}

/** POST /api/purchase-invoices — stock purchase invoice post karo:
 *  invoice + items + warehouse stock IN (batches) + StockAdjustment log
 *  + ledger PURCHASE (credit = payable barh) + optional advance payment (debit) */
export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const t = distributorTenantOf(user)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const b = await req.json() as InvoicePostBody
    if (!b.companyId) return jsonError('Company select karein')
    if (!b.items?.length) return jsonError('Kam az kam ek product add karein')

    // Task 23: tenant guard + ownership — company/product/warehouse sab ISI tenant ke

    const company = await db.company.findFirst({ where: { id: b.companyId, distributorId: tenantId } })
    if (!company) return jsonError('Company nahi mili (ya aap ki nahi hai)', 404)

    // validate items + snapshot product data
    const productIds = [...new Set(b.items.map((i) => i.productId!))]
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: tenantId } })
    const pMap = new Map(products.map((p) => [p.id, p]))
    const clean: {
      productId: string; cartons: number; purchasePrice: number; batchNo: string; expDate: Date | null
      unitsPerCarton: number; units: number
      lineTotal: number; discountPct: number; discountAmt: number
      netAmount: number; gstRate: number; salesTax: number; furtherTaxPct: number; furtherTax: number
      totalTax: number; tradeOfferAmt: number; advanceTax: number; amountInclusive: number
    }[] = []
    let itemIdx = 0
    // Task 44: invoice-level Advance Tax 236H % — default 0.5 (company invoice ka actual rate)
    const advPct = Math.min(100, Math.max(0, Number(b.advanceTaxPct ?? 0.5)))
    for (const it of b.items) {
      const p = it.productId ? pMap.get(it.productId) : undefined
      const cartons = Math.floor(Number(it.cartons ?? 0))
      const price = Number(it.purchasePrice ?? 0)
      if (!p) return jsonError('Product invalid hai')
      if (cartons <= 0) return jsonError(`${p.name}: cartons 0 se zyada hone chahiye`)
      if (price <= 0) return jsonError(`${p.name}: purchase price enter karein`)
      if (p.companyId && p.companyId !== b.companyId) return jsonError(`${p.name} is company ka product nahi hai`)
      const upc = p.unitsPerCarton || 1
      const units = cartons * upc
      itemIdx++
      // ---- Task 44: REAL INVOICE CALC CHAIN (har step save hota hai, kuch bhi hardcoded nahi) ----
      // 1) Gross = Trade Price x Qty
      const gross = Math.round(cartons * price * 100) / 100
      // 2) Pass On discount (% ya flat — UI se) -> Net (Excl. Sales Tax)
      const discPct = Math.min(100, Math.max(0, Number(it.discountPct ?? 0) || 0))
      const discAmt = Math.round(gross * discPct) / 100
      const netAmount = Math.round((gross - discAmt) * 100) / 100
      // 3) Sales Tax (GST %) — product ka rate (gstEnabled false = 0), UI override allowed
      const gstRate = it.gstRate != null
        ? Math.min(100, Math.max(0, Number(it.gstRate) || 0))
        : (p.gstEnabled ? p.gstRate : 0)
      const salesTax = Math.round(netAmount * gstRate) / 100
      // 4) Further Sales Tax % (invoice column)
      const furtherTaxPct = Math.min(100, Math.max(0, Number(it.furtherTaxPct ?? 0) || 0))
      const furtherTax = Math.round(netAmount * furtherTaxPct) / 100
      const totalTax = Math.round((salesTax + furtherTax) * 100) / 100
      // 5) Trade Offer Rs (scheme value) — net + tax se minus
      const tradeOfferAmt = Math.min(netAmount + totalTax, Math.max(0, Number(it.tradeOfferAmt ?? 0) || 0))
      // 6) Advance Tax 236H = advPct% x (net + totalTax − tradeOffer)
      const advanceTax = Math.round(Math.max(0, netAmount + totalTax - tradeOfferAmt) * advPct) / 100
      // 7) Amount Inclusive of All Tax
      const amountInclusive = Math.round((netAmount + totalTax - tradeOfferAmt + advanceTax) * 100) / 100
      clean.push({
        productId: p.id,
        cartons,
        purchasePrice: price,
        batchNo: it.batchNo?.trim() || `AUTO-${Date.now().toString(36).toUpperCase()}-${itemIdx}`,
        expDate: it.expDate ? new Date(it.expDate) : null,
        unitsPerCarton: upc,
        units,
        lineTotal: gross,
        discountPct: discPct,
        discountAmt: discAmt,
        netAmount,
        gstRate,
        salesTax,
        furtherTaxPct,
        furtherTax,
        totalTax,
        tradeOfferAmt,
        advanceTax,
        amountInclusive,
      })
    }

    const subtotal = Math.round(clean.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100
    // Task 44: discount = Pass On (item %) + Trade Offer + bill-level (% ya flat Rs) — invoice ka "Total Discount"
    const itemDiscount = Math.round(clean.reduce((s, i) => s + i.discountAmt, 0) * 100) / 100
    const tradeOfferTotal = Math.round(clean.reduce((s, i) => s + i.tradeOfferAmt, 0) * 100) / 100
    const afterItemDisc = Math.round((subtotal - itemDiscount) * 100) / 100
    const billPct = Math.min(100, Math.max(0, Number(b.discountPct ?? 0) || 0))
    const billRs = billPct > 0 ? Math.round(afterItemDisc * billPct) / 100 : Math.max(0, Number(b.discount ?? 0) || 0)
    const discount = Math.round((itemDiscount + tradeOfferTotal + billRs) * 100) / 100
    if (discount > subtotal) return jsonError('Discount subtotal se zyada nahi ho sakta')
    // Task 44: taxes — GST + Further (Σ totalTax) aur Advance Tax 236H
    const taxTotal = Math.round(clean.reduce((s, i) => s + i.totalTax, 0) * 100) / 100
    const advanceTaxTotal = Math.round(clean.reduce((s, i) => s + i.advanceTax, 0) * 100) / 100
    // Net Invoice Amount = Gross − Total Discount + GST + Advance Tax 236H (invoice ke formula se)
    const total = Math.round((subtotal - discount + taxTotal + advanceTaxTotal) * 100) / 100
    const paidNow = Math.min(total, Math.max(0, Number(b.paidNow ?? 0)))

    let stockWarehouseName = 'warehouse'
    const invoice = await db.$transaction(async (tx) => {
      const invoiceNo = `PIN-${await nextSeq('purchase', tx)}`

      const inv = await tx.purchaseInvoice.create({
        data: {
          invoiceNo,
          companyId: b.companyId!,
          distributorId: tenantId,
          supplierInvoiceNo: b.supplierInvoiceNo?.trim() || null,
          date: b.date ? new Date(b.date) : new Date(),
          subtotal,
          discount,
          discountPct: billPct,
          taxTotal,
          advanceTaxPct: advPct,
          advanceTaxTotal,
          tradeOfferTotal,
          total,
          paidAmount: paidNow,
          status: paidNow >= total - 0.01 ? 'PAID' : paidNow > 0 ? 'PARTIAL' : 'UNPAID',
          notes: b.notes?.trim() || null,
        },
      })

      await tx.purchaseInvoiceItem.createMany({
        data: clean.map((i) => ({
          invoiceId: inv.id,
          productId: i.productId,
          batchNo: i.batchNo,
          expDate: i.expDate,
          cartons: i.cartons,
          unitsPerCarton: i.unitsPerCarton,
          units: i.units,
          purchasePrice: i.purchasePrice,
          lineTotal: i.lineTotal,
          discountPct: i.discountPct,
          discountAmt: i.discountAmt,
          netAmount: i.netAmount,
          gstRate: i.gstRate,
          salesTax: i.salesTax,
          furtherTaxPct: i.furtherTaxPct,
          furtherTax: i.furtherTax,
          totalTax: i.totalTax,
          tradeOfferAmt: i.tradeOfferAmt,
          advanceTax: i.advanceTax,
          amountInclusive: i.amountInclusive,
        })),
      })

      // Stock IN — ISI tenant ka primary warehouse (ya pehla warehouse), same batchNo merge
      // Task 24 FIX: pehle agar tenant ka koi warehouse nahi tha to stock IN SILENTLY SKIP
      // ho jata tha — invoice ban jati magar stock kahin nahi jata (naye distributor ka
      // purchase stock gayab). Ab default primary warehouse auto-provision hota hai.
      let wh = await tx.warehouse.findFirst({ where: { distributorId: tenantId, isPrimary: true } })
      if (!wh) wh = await tx.warehouse.findFirst({ where: { distributorId: tenantId } })
      if (!wh) {
        const profile = await tx.distributorProfile.findUnique({ where: { id: tenantId } })
        wh = await tx.warehouse.create({
          data: { name: 'Main Warehouse', distributorId: tenantId, city: profile?.city || 'Lahore', isPrimary: true },
        })
      }
      for (const i of clean) {
        if (!i.batchNo) continue
        stockWarehouseName = wh.name
        const existing = await tx.stockBatch.findFirst({
          where: { warehouseId: wh.id, productId: i.productId, batchNo: i.batchNo },
        })
        if (existing) {
          await tx.stockBatch.update({ where: { id: existing.id }, data: { qty: existing.qty + i.units } })
        } else {
          await tx.stockBatch.create({
            data: {
              warehouseId: wh.id,
              productId: i.productId,
              batchNo: i.batchNo,
              qty: i.units,
              expDate: i.expDate,
            },
          })
        }
        await tx.stockAdjustment.create({
          data: {
            warehouseId: wh.id,
            productId: i.productId,
            type: 'IN',
            qty: i.units,
            reason: `Purchase ${invoiceNo} — ${company.shortCode ?? company.name}`,
            userId: user.id,
          },
        })
      }

      // Ledger: purchase = payable barha (credit) — net total (discount ke baad)
      await tx.companyLedgerEntry.create({
        data: {
          companyId: b.companyId!,
          distributorId: tenantId,
          date: b.date ? new Date(b.date) : new Date(),
          type: 'PURCHASE',
          description: `Stock purchase — ${clean.length} item${clean.length > 1 ? 's' : ''}, ${clean.reduce((s, i) => s + i.cartons, 0)} cartons${discount > 0 ? `, discount ${billPct > 0 ? `${billPct}%` : fmtRs(discount)}` : ''}${taxTotal > 0 ? `, GST ${fmtRs(taxTotal)}` : ''}${advanceTaxTotal > 0 ? `, Adv 236H ${fmtRs(advanceTaxTotal)}` : ''}`,
          refNo: invoiceNo,
          invoiceId: inv.id,
          credit: total,
        },
      })

      // Advance payment hua to PAYMENT (debit) entry bhi
      if (paidNow > 0) {
        await tx.companyLedgerEntry.create({
          data: {
            companyId: b.companyId!,
            distributorId: tenantId,
            date: b.date ? new Date(b.date) : new Date(),
            type: 'PAYMENT',
            description: `Advance payment against ${invoiceNo}`,
            refNo: invoiceNo,
            invoiceId: inv.id,
            debit: paidNow,
          },
        })
      }

      return inv
    })

    return Response.json({ invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo, total: invoice.total, discount: invoice.discount, discountPct: invoice.discountPct, subtotal: invoice.subtotal, taxTotal: invoice.taxTotal, advanceTaxTotal: invoice.advanceTaxTotal }, warehouseName: stockWarehouseName })
  } catch (e) {
    console.error(e)
    return jsonError('Purchase invoice failed', 500)
  }
}

function fmtRs(n: number): string {
  return `Rs ${n.toLocaleString('en-PK')}`
}
