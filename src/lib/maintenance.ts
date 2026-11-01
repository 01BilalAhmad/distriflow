/**
 * Task 127 — MAINTENANCE MODE (DB layer).
 *
 * SystemFlag (global) + User.maintenanceUntil (per-distributor) ko parh kar
 * maintenance-core ka gate apply karta hai. Har business request par ek chhota
 * KV query hoti hai — scale (tens of distributors) par negligible.
 */

import { db } from '@/lib/db'
import {
  maintenanceResponse,
  resolveMaintenance,
  type GlobalFlag,
  type MaintenanceState,
} from '@/lib/maintenance-core'

const KEY_UNTIL = 'maintenance_until'
const KEY_NOTE = 'maintenance_note'

/** Global maintenance flag parho (null = active nahi) */
export async function getGlobalMaintenance(): Promise<{ until: Date; note: string | null } | null> {
  const rows = await db.systemFlag.findMany({ where: { key: { in: [KEY_UNTIL, KEY_NOTE] } } })
  const untilRaw = rows.find((r) => r.key === KEY_UNTIL)?.value ?? null
  if (!untilRaw) return null
  const until = new Date(untilRaw)
  if (!(until.getTime() > Date.now())) return null // expired flag — treat as off
  const note = rows.find((r) => r.key === KEY_NOTE)?.value ?? null
  return { until, note }
}

/** Global maintenance ON/OFF (MEGA_ADMIN only — route guard karta hai) */
export async function setGlobalMaintenance(until: Date | null, note: string | null): Promise<void> {
  if (until) {
    await db.systemFlag.upsert({
      where: { key: KEY_UNTIL },
      create: { key: KEY_UNTIL, value: until.toISOString() },
      update: { value: until.toISOString() },
    })
    await db.systemFlag.upsert({
      where: { key: KEY_NOTE },
      create: { key: KEY_NOTE, value: note ?? '' },
      update: { value: note ?? '' },
    })
  } else {
    // OFF — dono flags delete (getGlobalMaintenance null return karega)
    await db.systemFlag.deleteMany({ where: { key: { in: [KEY_UNTIL, KEY_NOTE] } } })
  }
}

/**
 * requireUser/login/session gate — MEGA_ADMIN hamesha pass.
 * subject ko minimal shape chahiye (Prisma User dono fields rakhta hai).
 */
export async function checkMaintenance(subject: {
  role: string
  maintenanceUntil?: Date | null
  maintenanceNote?: string | null
}): Promise<Response | null> {
  const global = await getGlobalMaintenance()
  const state = resolveMaintenance(subject, global)
  return state ? maintenanceResponse(state) : null
}

/** System Health page ke liye — abhi maintenance mein band distributors */
export async function distributorsUnderMaintenance(): Promise<
  Array<{ id: string; businessName: string; name: string; until: string; note: string | null }>
> {
  const rows = await db.user.findMany({
    where: { role: 'DISTRIBUTOR', maintenanceUntil: { gt: new Date() } },
    include: { profile: { select: { businessName: true } } },
    orderBy: { maintenanceUntil: 'asc' },
  })
  return rows.map((u) => ({
    id: u.id,
    businessName: u.profile?.businessName ?? u.name,
    name: u.name,
    until: (u.maintenanceUntil as Date).toISOString(),
    note: u.maintenanceNote,
  }))
}

export type { MaintenanceState }
