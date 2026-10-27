import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

// Task 95: distributorTenant(userId) helper ki jagah cookie-user par direct checks (same semantics)
function distributorTenantOf(user: AuthedUser): { tenantId: string; error?: never } | { tenantId?: never; error: Response } {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}

/** DELETE /api/purchase-invoices/[id] — invoice reverse karo:
 *  ledger entries delete + stock batches kam (StockAdjustment OUT log) + invoice delete
 *  Task 23: sirf APNI tenant ka invoice reverse ho sakta hai
 *  Task 95: identity cookie se (userId param IGNORE — IDOR band) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error

    const inv = await db.purchaseInvoice.findUnique({
      where: { id },
      include: { items: true },
    })
    if (!inv) return jsonError('Invoice not found', 404)
    if (inv.distributorId !== t.tenantId) return jsonError('Ye invoice aap ki nahi hai', 403)

    await db.$transaction(async (tx) => {
      // 1) stock reverse — batch (same batchNo) se units kam
      for (const it of inv.items) {
        const batch = await tx.stockBatch.findFirst({
          where: { productId: it.productId, batchNo: it.batchNo, qty: { gt: 0 } },
          orderBy: { receivedAt: 'desc' },
        })
        const remove = batch ? Math.min(batch.qty, it.units) : 0
        if (batch && remove > 0) {
          await tx.stockBatch.update({ where: { id: batch.id }, data: { qty: batch.qty - remove } })
          await tx.stockAdjustment.create({
            data: {
              warehouseId: batch.warehouseId,
              productId: it.productId,
              type: 'OUT',
              qty: remove,
              reason: `Purchase ${inv.invoiceNo} reversal`,
            },
          })
        }
      }

      // 2) ledger entries delete (PURCHASE + linked PAYMENT)
      await tx.companyLedgerEntry.deleteMany({ where: { invoiceId: inv.id } })

      // 3) invoice delete (items cascade)
      await tx.purchaseInvoice.delete({ where: { id: inv.id } })
    })

    return Response.json({ ok: true })
  } catch (e) {
    console.error(e)
    return jsonError('Invoice reversal failed', 500)
  }
}
