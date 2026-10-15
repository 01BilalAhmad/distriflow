import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/**
 * Task 42 — Full JSON data export (MEGA_ADMIN only).
 *
 * Cloud (Neon/Vercel) par filesystem ephemeral hai is liye file-backup nahi ho sakta,
 * magar poore database ka JSON export browser se download HOTA hai — user apna data
 * kabhi bhi apne paas safe kar sakta hai (har hafte / kisi bhi bare change se pehle).
 *
 * GET /api/backup/export?userId=  ->  distriflow-backup-<stamp>.json (attachment)
 *
 * Export parents-first order me hota hai (FK-safe re-import ke liye).
 * Restore tool: scripts/task42-restore-from-branch.js
 */

const MODELS: Array<[string, keyof typeof db]> = [
  ['User', 'user'],
  ['DistributorProfile', 'distributorProfile'],
  ['Company', 'company'],
  ['Brand', 'brand'],
  ['Product', 'product'],
  ['PurchaseInvoice', 'purchaseInvoice'],
  ['PurchaseInvoiceItem', 'purchaseInvoiceItem'],
  ['CompanyLedgerEntry', 'companyLedgerEntry'],
  ['Outlet', 'outlet'],
  ['Warehouse', 'warehouse'],
  ['StockBatch', 'stockBatch'],
  ['StockAdjustment', 'stockAdjustment'],
  ['Scheme', 'scheme'],
  ['PJPPlan', 'pJPPlan'],
  ['Visit', 'visit'],
  ['DeliverySummary', 'deliverySummary'],
  ['Order', 'order'],
  ['OrderItem', 'orderItem'],
  ['Delivery', 'delivery'],
  ['DeliveryItem', 'deliveryItem'],
  ['SummarySettlement', 'summarySettlement'],
  ['AppSetting', 'appSetting'],
  ['OutletLedger', 'outletLedger'],
  ['SaleReturn', 'saleReturn'],
  ['ReturnItem', 'returnItem'],
  ['Claim', 'claim'],
  ['Recovery', 'recovery'],
  ['Collection', 'collection'],
  ['SalesTarget', 'salesTarget'],
]

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')
    const user = await db.user.findUnique({ where: { id: userId } })
    if (!user) return jsonError('User not found', 404)
    if (user.role !== 'MEGA_ADMIN') return jsonError('Backup sirf Mega Admin kar sakta hai', 403)

    const tables: Record<string, unknown[]> = {}
    let total = 0
    for (const [table, prop] of MODELS) {
      const rows = await (db[prop] as unknown as { findMany: () => Promise<unknown[]> }).findMany()
      tables[table] = rows
      total += rows.length
    }

    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    const filename = `distriflow-backup-${stamp}.json`

    const body = JSON.stringify(
      { meta: { app: 'DistriFlow', exportedAt: now.toISOString(), totalRows: total, format: 'json-full-v1' }, tables },
      null,
      1
    )

    return new Response(body, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${filename}"`,
        // Content-Length BYTE hona chahiye (chars nahi) — user data me •/Urdu multi-byte
        // chars hote hain: body.length (UTF-16 chars) < byte length → client body truncate
        // kar deta tha (backup adhoora download — Task 45 me pakra gaya)
        'Content-Length': String(Buffer.byteLength(body, 'utf8')),
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Backup export failed', 500)
  }
}
