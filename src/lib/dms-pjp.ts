import { db } from '@/lib/db'
import { karachiDateStr, karachiDayCode, karachiDayBounds, dayMatches, outletInTodayRoute } from '@/lib/dms-day'

/**
 * Task 82: PJP AUTO-ROUTE — manual daily journey plan khatam.
 *
 * Har shop pe EK DAFa orderbooker + din(s) assign hote hain (Outlet.salesmanId + Outlet.visitDays,
 * empty visitDays = har roz). Booker app khole to USI DIN ki shops khud nazar aati hain.
 *
 * Admin Settings (AppSetting KV — zero migration, tax/GST jaisa hi pattern):
 *  - pjpFridayOff        (default ON)  = Jumma OFF day — route nahi, sirf unplanned orders
 *  - pjpUnplannedEnabled (default ON)  = out-of-route shop par order ki ijazat
 *
 * Day/time pure helpers `@/lib/dms-day` mein hain (client-safe) — yahan re-export.
 */
export { karachiDateStr, karachiDayCode, karachiDayBounds, dayMatches, outletInTodayRoute }

export const PJP_KEYS = {
  fridayOff: 'pjpFridayOff',
  unplanned: 'pjpUnplannedEnabled',
} as const

export const DEFAULT_PJP = { fridayOff: true, unplannedEnabled: true }

export type PjpSettings = { fridayOff: boolean; unplannedEnabled: boolean }

/** Salesman ka tenant = uske parent distributor ki profile id (AppSetting KV wahan per-tenant hai) */
export async function getTenantIdForSalesman(salesmanId: string): Promise<string | null> {
  const sm = await db.user.findUnique({ where: { id: salesmanId }, select: { parentId: true } })
  if (!sm?.parentId) return null
  const prof = await db.distributorProfile.findUnique({ where: { userId: sm.parentId }, select: { id: true } })
  return prof?.id ?? null
}

/** PJP toggles — AppSetting KV se (per-tenant), missing par defaults */
export async function getPjpSettings(tenantId?: string | null): Promise<PjpSettings> {
  if (!tenantId) return { ...DEFAULT_PJP }
  const rows = await db.appSetting.findMany({
    where: { key: { in: [PJP_KEYS.fridayOff, PJP_KEYS.unplanned] }, distributorId: tenantId },
  })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const flag = (k: string, dflt: boolean) => {
    const v = map.get(k)
    return v == null || v === '' ? dflt : v === '1' || v === 'true'
  }
  return { fridayOff: flag(PJP_KEYS.fridayOff, DEFAULT_PJP.fridayOff), unplannedEnabled: flag(PJP_KEYS.unplanned, DEFAULT_PJP.unplannedEnabled) }
}

export async function upsertPjpFlag(tenantId: string, key: string, on: boolean) {
  await db.appSetting.upsert({
    where: { key_distributorId: { key, distributorId: tenantId } },
    update: { value: on ? '1' : '0' },
    create: { key, value: on ? '1' : '0', distributorId: tenantId },
  })
}
