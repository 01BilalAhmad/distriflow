import { db } from '@/lib/db'

/**
 * Task 35 — AUDIT LOG: "hr AK CHOTI CHOTI activity ka log — jo bhi action perform
 * ho rha ho website pr, ye lazmi hy" (user directive).
 *
 * Do layers:
 *  1) GENERIC auto-audit — requireUser() HAR mutation (non-GET) par auditApiCall()
 *     chalata hai => poore website ki har API action ka record, koi route miss nahi.
 *  2) RICH labeled audit — critical business events (login, order create, settle,
 *     returns, backup...) apni human-readable row bhi likhte hain (ORDER_CREATE jaisa
 *     action label + detail). Generic row raw API trail deta hai (method + path).
 *
 * FIRE-SAFE: audit ki apni failure business action ko KABHI nahi rokti — try/catch +
 * console.error, throw nahi hota. Password jaisi sensitive values detail mein KABHI
 * nahi likhte — caller ki zimmedari.
 */

export interface AuditActor {
  id: string
  name: string
  role: string
  /** tenant scope (DistributorProfile id) — distributor apni team ki activity dekhta hai */
  tenantId?: string | null
}

function clientMeta(req?: Request): { ip: string | null; userAgent: string | null } {
  if (!req) return { ip: null, userAgent: null }
  const fwd = req.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim() || req.headers.get('x-real-ip') || null
  return { ip, userAgent: req.headers.get('user-agent')?.slice(0, 250) ?? null }
}

/** RICH audit — labeled business event. Kisi bhi route se 1 line mein. */
export async function audit(
  actor: AuditActor | null,
  action: string,
  opts: { entity?: string | null; entityId?: string | null; detail?: string | null; req?: Request } = {},
): Promise<void> {
  try {
    const { ip, userAgent } = clientMeta(opts.req)
    await db.auditLog.create({
      data: {
        userId: actor?.id ?? null,
        userName: actor?.name ?? null,
        userRole: actor?.role ?? null,
        distributorId: actor?.tenantId ?? null,
        action,
        entity: opts.entity ?? null,
        entityId: opts.entityId ?? null,
        detail: opts.detail ?? null,
        ip,
        userAgent,
      },
    })
  } catch (e) {
    // fire-safe — audit fail = sirf console, business flow untouched
    console.error('[audit] log fail (action continue):', action, e instanceof Error ? e.message : e)
  }
}

/** Path se resource id — /api/summaries/abc/settle -> "abc" */
function pathEntityId(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean) // [api, summaries, abc, settle]
  return parts.length >= 3 ? parts[2] : null
}

/** GENERIC auto-audit — requireUser se HAR mutation (non-GET) yahan se guzarta hai. */
export async function auditApiCall(req: Request, user: AuditActor): Promise<void> {
  try {
    const url = new URL(req.url)
    const method = req.method.toUpperCase()
    await audit(user, `API_${method}`, {
      req,
      entity: url.pathname,
      entityId: pathEntityId(url.pathname),
      detail: `${method} ${url.pathname}`,
    })
  } catch (e) {
    console.error('[audit] api call log fail:', e instanceof Error ? e.message : e)
  }
}

/** Tenant (DistributorProfile id) resolve — DISTRIBUTOR apna profile, SALESMAN owner
 * walk-up (tenantMismatch jaisa), MEGA_ADMIN null. Fire-safe. */
export async function resolveTenantId(user: { id: string; role: string; parentId: string | null; profile?: { id: string } | null }): Promise<string | null> {
  try {
    if (user.role === 'DISTRIBUTOR') return user.profile?.id ?? null
    if (user.role === 'SALESMAN' && user.parentId) {
      const owner = await db.user.findUnique({ where: { id: user.parentId }, include: { profile: true } })
      return owner?.profile?.id ?? null
    }
    return null
  } catch {
    return null
  }
}
