import { db, type DbClient } from '@/lib/db'
import type { Role } from '@/lib/dms-types'

export interface ScopeContext {
  userId: string
  role: Role
  profileId?: string | null
}

export async function resolveScope(userId: string): Promise<ScopeContext> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })
  if (!user) throw new Error('User not found')
  return {
    userId: user.id,
    role: user.role as Role,
    profileId: user.profile?.id ?? null,
  }
}

/**
 * MEGA_ADMIN business-data lock — mega admin sirf distributor ACCOUNTS manage karta hai
 * (create / active-inactive / subscription). Distributors ka business data (orders, shops,
 * recovery, reports...) usay API level par bhi nazar nahi aata — ye har business route
 * ke shuru mein guard ke tor par use hota hai.
 */
export function megaBlocked(role: string): Response | null {
  if (role === 'MEGA_ADMIN') {
    return jsonError('Mega Admin sirf distributor accounts manage karta hai — business data locked hai', 403)
  }
  return null
}

/** Returns prisma where fragment for scoping orders by role */
export async function orderScope(userId: string) {
  const ctx = await resolveScope(userId)
  if (ctx.role === 'SALESMAN') return { salesmanId: userId }
  return { distributorId: ctx.profileId! }
}

/**
 * Task 23 — TENANT ID (distributor profile id) nikaalo:
 * - DISTRIBUTOR: apna profile hi tenant hai
 * - SALESMAN: apne owner distributor ka profile (parent walk-up)
 * Ye catalog-level isolation ke liye hai (products/brands/companies/schemes/settings).
 */
export async function tenantProfileId(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!user) return null
  if (user.profile) return user.profile.id
  if (user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, include: { profile: true } })
    return owner?.profile?.id ?? null
  }
  return null
}

/** Distributor guard + tenant resolve — mega admin aur salesman catalog manage nahi kar sakte */
export async function distributorTenant(userId: string): Promise<{ error: Response } | { tenantId: string }> {
  const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!user) return { error: jsonError('User not found', 404) }
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}

/** Returns list of outlet ids this user can see */
export async function scopedOutletIds(userId: string): Promise<string[] | null> {
  const ctx = await resolveScope(userId)
  if (ctx.role === 'SALESMAN') {
    const outlets = await db.outlet.findMany({ where: { salesmanId: userId }, select: { id: true } })
    return outlets.map((o) => o.id)
  }
  const outlets = await db.outlet.findMany({ where: { distributorId: ctx.profileId! }, select: { id: true } })
  return outlets.map((o) => o.id)
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status })
}

export function fmtNo(prefix: string, n: number): string {
  return `${prefix}-${n}`
}

/**
 * Sequence generator: scans existing document numbers and returns max numeric suffix + 1.
 * count()-based numbering breaks when seeds use gapped numbers (e.g. ORD-5003, 5006, 5009...)
 * because count() < max existing number -> unique constraint violation (P2002).
 */
const SEQ_CONFIG = {
  order:    { table: 'order',    field: 'orderNo',    prefix: 'ORD-', base: 5000 },
  delivery: { table: 'delivery', field: 'deliveryNo', prefix: 'DLV-', base: 3000 },
  return:   { table: 'saleReturn', field: 'returnNo',   prefix: 'RET-', base: 1000 },
  claim:    { table: 'claim',    field: 'claimNo',    prefix: 'CLM-', base: 2000 },
  receipt:  { table: 'collection', field: 'receiptNo',  prefix: 'RCP-', base: 3000 },
  recovery: { table: 'recovery', field: 'recoveryNo', prefix: 'RCV-', base: 4000 },
  summary:  { table: 'deliverySummary', field: 'summaryNo', prefix: 'STM-', base: 6000 },
  purchase: { table: 'purchaseInvoice', field: 'invoiceNo', prefix: 'PIN-', base: 7000 },
} as const

export async function nextSeq(model: keyof typeof SEQ_CONFIG, client: DbClient = db): Promise<number> {
  const cfg = SEQ_CONFIG[model]
  const delegate = (client as unknown as Record<string, { findMany: (args: { select: Record<string, boolean> }) => Promise<Record<string, string | null>[]> }>)[cfg.table]
  const rows = await delegate.findMany({ select: { [cfg.field]: true } })

  let max: number = cfg.base
  for (const r of rows) {
    const no = r[cfg.field]
    if (!no || !no.startsWith(cfg.prefix)) continue
    const n = parseInt(no.slice(cfg.prefix.length), 10)
    if (!isNaN(n) && n > max) max = n
  }
  return max + 1
}
