import { db } from '@/lib/db'
import { jsonError, tenantProfileId } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { getAvailableToPromise } from '@/lib/dms-inventory'
import { getPjpSettings, getTenantIdForSalesman } from '@/lib/dms-pjp'
import { dayMatches, karachiDayCode } from '@/lib/dms-day'

/**
 * Task 85 — SYNC DOWN (manual download — booker offline-first app ka poora data bundle)
 * GET /api/sync/down   (Task 95: identity cookie se — userId param IGNORE)
 * SALESMAN-only. Ek hi call mein: shops (APPROVED, balances + visit schedule + GPS),
 * products (stock + rates), PJP settings, apni tag ki hui PENDING shops, pending approvals count.
 * Auto-sync NAHI hai — booker khud button daba kar download karega.
 */
export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    if (user.role !== 'SALESMAN') return jsonError('Sync down is available for order bookers only', 403)

    const tenantId = await getTenantIdForSalesman(user.id)
    if (!tenantId) return jsonError('You are not attached to any distributor', 403)

    // --- Shops (sirf APPROVED — PENDING shops alag section mein) + grouped ledger balances ---
    // Task 95 perf: pehle har shop ki POORI ledger history load hoti thi (JS agg) — ab EK groupBy
    const outlets = await db.outlet.findMany({
      where: { salesmanId: user.id, status: 'APPROVED' },
      select: {
        id: true, name: true, code: true, city: true, channel: true, visitDays: true,
        address: true, ownerName: true, phone: true, lat: true, lng: true, creditDays: true,
      },
      orderBy: { name: 'asc' },
    })
    const outletIds = outlets.map((o) => o.id)
    const ledgerSums = outletIds.length
      ? await db.outletLedger.groupBy({
          by: ['outletId', 'type'],
          where: { outletId: { in: outletIds } },
          _sum: { amount: true },
        })
      : []
    const balanceByOutlet = new Map<string, number>()
    for (const s of ledgerSums) {
      const signed = s.type === 'DEBIT' ? (s._sum.amount ?? 0) : -(s._sum.amount ?? 0)
      balanceByOutlet.set(s.outletId, (balanceByOutlet.get(s.outletId) ?? 0) + signed)
    }
    const shops = outlets.map((o) => ({
      outletId: o.id, name: o.name, code: o.code, city: o.city, channel: o.channel,
      visitDays: o.visitDays, address: o.address, ownerName: o.ownerName, phone: o.phone,
      lat: o.lat, lng: o.lng, creditDays: o.creditDays,
      balance: Math.round((balanceByOutlet.get(o.id) ?? 0) * 100) / 100,
      // Task 106: PJP-aware app — plannedToday = Karachi aaj ka din visitDays se match (orders route jaisa hi rule)
      plannedToday: dayMatches(o.visitDays, karachiDayCode()),
    }))

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

    // --- Booker target progress (home progress bar) — current Karachi month ---
    // SalesTarget (overall row pehle, warna brand-wise ka sum) + month-to-date achieved
    // (Order.total ka sum, CANCELLED exclude) — website /api/targets jaisa hi math.
    // Karachi = UTC+5: month key + boundaries usi hisaab se (app karachiDate se match).
    const nowKarachi = new Date(Date.now() + 5 * 3600 * 1000)
    const perfMonth = `${nowKarachi.getUTCFullYear()}-${String(nowKarachi.getUTCMonth() + 1).padStart(2, '0')}`
    const perfStartUtc = new Date(Date.UTC(nowKarachi.getUTCFullYear(), nowKarachi.getUTCMonth(), 1) - 5 * 3600 * 1000)
    const perfEndUtc = new Date(Date.UTC(nowKarachi.getUTCFullYear(), nowKarachi.getUTCMonth() + 1, 1) - 5 * 3600 * 1000)
    const [perfTargets, perfAchieved] = await Promise.all([
      db.salesTarget.findMany({ where: { salesmanId: user.id, month: perfMonth }, select: { brandId: true, targetValue: true } }),
      db.order.aggregate({
        where: { salesmanId: user.id, orderDate: { gte: perfStartUtc, lt: perfEndUtc }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
    ])
    const overallTarget = perfTargets.find((t) => !t.brandId)
    const perfTargetValue = overallTarget ? overallTarget.targetValue : perfTargets.reduce((s, t) => s + t.targetValue, 0)

    return Response.json({
      serverTime: new Date().toISOString(),
      settings: { fridayOff: pjp.fridayOff, unplannedEnabled: pjp.unplannedEnabled, allRoutesOpen: user.allRoutesOpen },
      performance: {
        month: perfMonth,
        target: Math.round(perfTargetValue * 100) / 100,
        achieved: Math.round((perfAchieved._sum.total ?? 0) * 100) / 100,
      },
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
