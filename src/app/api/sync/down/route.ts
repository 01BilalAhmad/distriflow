import { db } from '@/lib/db'
import { jsonError, megaBlocked, tenantProfileId } from '@/lib/dms-scope'
import { getAvailableToPromise } from '@/lib/dms-inventory'
import { getPjpSettings, getTenantIdForSalesman } from '@/lib/dms-pjp'

/**
 * Task 85 — SYNC DOWN (manual download — booker offline-first app ka poora data bundle)
 * GET /api/sync/down?userId=
 * SALESMAN-only. Ek hi call mein: shops (APPROVED, balances + visit schedule + GPS),
 * products (stock + rates), PJP settings, apni tag ki hui PENDING shops, pending approvals count.
 * Auto-sync NAHI hai — booker khud button daba kar download karega.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'SALESMAN') return jsonError('Sync down sirf order booker ke liye hai', 403)

    const tenantId = await getTenantIdForSalesman(user.id)
    if (!tenantId) return jsonError('Aap kisi distributor se attached nahi hain', 403)

    // --- Shops (sirf APPROVED — PENDING shops alag section mein) + ledger balances ---
    const outlets = await db.outlet.findMany({
      where: { salesmanId: user.id, status: 'APPROVED' },
      select: {
        id: true, name: true, code: true, city: true, channel: true, visitDays: true,
        address: true, ownerName: true, phone: true, lat: true, lng: true, creditDays: true,
        ledgerEntries: { select: { type: true, amount: true } },
      },
      orderBy: { name: 'asc' },
    })
    const shops = outlets.map((o) => {
      const debit = o.ledgerEntries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0)
      const credit = o.ledgerEntries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0)
      return {
        outletId: o.id, name: o.name, code: o.code, city: o.city, channel: o.channel,
        visitDays: o.visitDays, address: o.address, ownerName: o.ownerName, phone: o.phone,
        lat: o.lat, lng: o.lng, creditDays: o.creditDays,
        balance: Math.round((debit - credit) * 100) / 100,
      }
    })

    // --- Products (tenant catalog + booker ki assigned company + ATP stock) ---
    const products = await (async () => {
      const t = await tenantProfileId(user.id)
      if (!t) return []
      const stockFilter = { where: { warehouse: { distributorId: t } } }
      const where: { isActive: boolean; distributorId: string; companyId?: string } = { isActive: true, distributorId: t }
      if (user.companyId) where.companyId = user.companyId
      const rows = await db.product.findMany({
        where,
        include: { brand: { select: { name: true } }, stockBatches: stockFilter },
        orderBy: { name: 'asc' },
      })
      const atp = await getAvailableToPromise(t, rows.map((p) => p.id))
      return rows.map((p) => ({
        id: p.id, sku: p.sku, name: p.name, brand: p.brand?.name ?? '',
        unitsPerCarton: p.unitsPerCarton, boxesPerCarton: p.boxesPerCarton, pcsPerBox: p.pcsPerBox,
        tradePrice: p.tradePrice, gstEnabled: p.gstEnabled, gstRate: p.gstRate,
        available: atp.get(p.id)?.available ?? 0,
      }))
    })()

    // --- PJP settings (Jumma OFF / Unplanned) ---
    const pjp = await getPjpSettings(tenantId)

    // --- Booker ki tag ki hui shops jo ABHI BHI PENDING hain (admin approval ka intezar) ---
    const pendingShops = await db.outlet.findMany({
      where: { salesmanId: user.id, status: 'PENDING' },
      select: {
        id: true, code: true, name: true, address: true, city: true, channel: true,
        ownerName: true, phone: true, cnic: true, ntn: true, lat: true, lng: true, createdAt: true,
        orders: { select: { total: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // --- Meri aaj ki recoveries pending approval count (context ke liye) ---
    const pendingRecoveries = await db.recovery.count({ where: { bookerId: user.id, status: 'PENDING' } })

    return Response.json({
      serverTime: new Date().toISOString(),
      settings: { fridayOff: pjp.fridayOff, unplannedEnabled: pjp.unplannedEnabled },
      shops,
      products,
      pendingShops: pendingShops.map((s) => ({
        id: s.id, code: s.code, name: s.name, address: s.address, city: s.city, channel: s.channel,
        ownerName: s.ownerName, phone: s.phone, cnic: s.cnic, ntn: s.ntn, lat: s.lat, lng: s.lng,
        createdAt: new Date(s.createdAt).toISOString(),
        ordersCount: s.orders.length,
        ordersTotal: Math.round(s.orders.reduce((a, o) => a + o.total, 0) * 100) / 100,
      })),
      pendingRecoveries,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Sync down failed', 500)
  }
}
