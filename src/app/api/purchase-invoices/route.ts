import { db } from '@/lib/db'
import { jsonError, nextSeq, tenantProfileId, distributorTenant } from '@/lib/dms-scope'

/** GET /api/purchase-invoices?userId=&companyId= — list with company + items summary (apna tenant) */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const companyId = searchParams.get('companyId') || undefined
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const tenantId = await tenantProfileId(userId)
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
  /** Task 43: per-item % discount (0-100); lineTotal gross par apply hota hai */
  discountPct?: number
}

interface InvoicePostBody {
  userId?: string
  companyId?: string
  date?: string
  supplierInvoiceNo?: string
  /** flat Rs discount (purana mode — discountPct > 0 ho to ye ignore hota hai) */
  discount?: number
  /** Task 43: bill-level % discount (subtotal par) — percentage mode */
  discountPct?: number
  paidNow?: number
  notes?: string
  items?: ItemBody[]
}

/** POST /api/purchase-invoices — stock purchase invoice post karo:
 *  invoice + items + warehouse stock IN (batches) + StockAdjustment log
 *  + ledger PURCHASE (credit = payable barh) + optional advance payment (debit) */
export async function POST(req: Request) {
  try {
    const b = await req.json() as InvoicePostBody
    if (!b.userId) return jsonError('userId required hai')
    if (!b.companyId) return jsonError('Company select karein')
    if (!b.items?.length) return jsonError('Kam az kam ek product add karein')

    // Task 23: tenant guard + ownership — company/product/warehouse sab ISI tenant ke
    const t = await distributorTenant(b.userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    const company = await db.company.findFirst({ where: { id: b.companyId, distributorId: tenantId } })
    if (!company) return jsonError('Company nahi mili (ya aap ki nahi hai)', 404)

    // validate items + snapshot product data
    const productIds = [...new Set(b.items.map((i) => i.productId!))]
    const products = await db.product.findMany({ where: { id: { in: productIds }, distributorId: tenantId } })
    const pMap = new Map(products.map((p) => [p.id, p]))
    const clean: { productId: string; cartons: number; purchasePrice: number; batchNo: string; expDate: Date | null; unitsPerCarton: number; units: number; lineTotal: number; discountPct: number; discountAmt: number }[] = []
    let itemIdx = 0
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
      // Task 43: per-item % discount — gross (cartons x price) par apply, Rs me snapshot
      const gross = cartons * price
      const discPct = Math.min(100, Math.max(0, Number(it.discountPct ?? 0) || 0))
      const discAmt = Math.round(gross * discPct) / 100
      clean.push({
        productId: p.id,
        cartons,
        purchasePrice: price,
        batchNo: it.batchNo?.trim() || `AUTO-${Date.now().toString(36).toUpperCase()}-${itemIdx}`,
        expDate: it.expDate ? new Date(it.expDate) : null,
        unitsPerCarton: upc,
        units,
        lineTotal: Math.round(gross * 100) / 100,
        discountPct: discPct,
        discountAmt: discAmt,
      })
    }

    const subtotal = Math.round(clean.reduce((s, i) => s + i.lineTotal, 0) * 100) / 100
    // Task 43: discount = item-level (% wise) + bill-level (% ya flat Rs)
    // Bill % ka base = item discounts ke BAAD wali value (UI preview bhi yehi dikhata hai)
    const itemDiscount = Math.round(clean.reduce((s, i) => s + i.discountAmt, 0) * 100) / 100
    const afterItemDisc = Math.round((subtotal - itemDiscount) * 100) / 100
    const billPct = Math.min(100, Math.max(0, Number(b.discountPct ?? 0) || 0))
    const billRs = billPct > 0 ? Math.round(afterItemDisc * billPct) / 100 : Math.max(0, Number(b.discount ?? 0) || 0)
    const discount = Math.round((itemDiscount + billRs) * 100) / 100
    if (discount > subtotal) return jsonError('Discount subtotal se zyada nahi ho sakta')
    const total = Math.round((subtotal - discount) * 100) / 100
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
            userId: b.userId ?? null,
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
          description: `Stock purchase — ${clean.length} item${clean.length > 1 ? 's' : ''}, ${clean.reduce((s, i) => s + i.cartons, 0)} cartons${discount > 0 ? `, discount ${billPct > 0 ? `${billPct}%` : fmtRs(discount)}` : ''}`,
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

    return Response.json({ invoice: { id: invoice.id, invoiceNo: invoice.invoiceNo, total: invoice.total, discount: invoice.discount, discountPct: invoice.discountPct, subtotal: invoice.subtotal }, warehouseName: stockWarehouseName })
  } catch (e) {
    console.error(e)
    return jsonError('Purchase invoice failed', 500)
  }
}

function fmtRs(n: number): string {
  return `Rs ${n.toLocaleString('en-PK')}`
}
