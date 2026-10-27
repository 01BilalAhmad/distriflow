/**
 * P0 SECURITY (Task 95) — server-side API authentication.
 *
 * Pehle 60+ API routes client-supplied ?userId=/body.userId ko IDENTITY ki tarah trust
 * karte the — koi bhi logged-in user kisi doosre ki data mangwa sakta tha (IDOR), aur
 * koi bhi bina login ke API call kar sakta tha (proxy.ts sirf pages guard karta tha).
 *
 * Ab har business route par identity SIRF signed httpOnly cookie se aati hai:
 *   requireUser(req)  — cookie verify → DB user (isActive + subscription gate)
 *   salesmanGuard()   — SALESMAN doosre booker ka data filter nahi kar sakta
 *   tenantMismatch()  — SALESMAN/MEGA doosre distributor ka record touch nahi kar sakte
 *
 * Cookie verification Web Crypto par hai — edge (proxy) aur node (routes) dono chalega.
 */

import { db } from '@/lib/db'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth-token'
import { jsonError } from '@/lib/dms-scope'
import type { DistributorProfile } from '@prisma/client'

/** Route handlers ko milne wala authed user — profile relation ke sath */
export type AuthedUser = {
  id: string
  name: string
  email: string
  role: string
  phone: string | null
  region: string | null
  parentId: string | null
  companyId: string | null
  isActive: boolean
  allRoutesOpen: boolean
  profile: DistributorProfile | null
}

export type AuthResult = { user: AuthedUser; error?: never } | { user?: never; error: Response }

function parseCookieHeader(req: Request): string | undefined {
  const header = req.headers.get('cookie')
  if (!header) return undefined
  const m = header.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
  return m?.[1]
}

/**
 * Cookie se REAL user nikaalo (IDOR band):
 * - signed cookie invalid/missing → 401 (proxy bhi pehle hi rok chuka hota — defense in depth)
 * - user DB mein nahi / inactive → 401
 * - DISTRIBUTOR ki subscription expire → 401
 * Return: { user } ya { error: Response } — route mein `if ('error' in auth) return auth.error`
 */
export async function requireUser(req: Request): Promise<AuthResult> {
  const token = parseCookieHeader(req)
  const userId = await verifyAuthToken(token)
  if (!userId) return { error: jsonError('Login required — session invalid hai', 401) }

  const user = await db.user.findUnique({
    where: { id: userId },
    include: { profile: true },
  })
  if (!user || !user.isActive) {
    return { error: jsonError('Account inactive ya nahi mila — dobara login karein', 401) }
  }
  if (user.role === 'DISTRIBUTOR' && user.subscriptionExpiry && user.subscriptionExpiry.getTime() < Date.now()) {
    return { error: jsonError('Subscription khatam — renew ke liye Mega Admin se rabta karein', 403) }
  }

  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      region: user.region,
      parentId: user.parentId,
      companyId: user.companyId,
      isActive: user.isActive,
      allRoutesOpen: user.allRoutesOpen,
      profile: user.profile,
    },
  }
}

/**
 * SALESMAN filter guard — booker sirf APNA data filter kar sakta hai:
 * - SALESMAN ne doosre ka salesmanId bheja → 403
 * - SALESMAN ne kuch nahi bheja → forced self
 * - DISTRIBUTOR/MEGA pass-through (apni team filter karna allowed)
 */
export function salesmanGuard(
  user: AuthedUser,
  requested: string | null | undefined,
): { value: string | null; error?: never } | { value?: never; error: Response } {
  if (user.role === 'SALESMAN') {
    if (requested && requested !== user.id) {
      return { error: jsonError('Sirf apni data dekh sakte hain', 403) }
    }
    return { value: user.id }
  }
  return { value: requested ?? null }
}

/**
 * Tenant ownership guard — resource ka distributorId user ke tenant se match karna chahiye.
 * DISTRIBUTOR: apna profile. SALESMAN: owner distributor ka profile (parent walk-up).
 * MEGA_ADMIN: business data locked (403). Mismatch par 403.
 */
export async function tenantMismatch(user: AuthedUser, resourceDistributorId: string): Promise<Response | null> {
  if (user.role === 'MEGA_ADMIN') {
    return jsonError('Mega Admin sirf distributor accounts manage karta hai — business data locked hai', 403)
  }
  let tenantId: string | null = user.profile?.id ?? null
  if (!tenantId && user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, include: { profile: true } })
    tenantId = owner?.profile?.id ?? null
  }
  if (!tenantId || tenantId !== resourceDistributorId) {
    return jsonError('Yeh record aap ke scope mein nahi hai', 403)
  }
  return null
}

/**
 * Outlet-scope guard — outlet user ke scope mein hai? (distributor ka apna / salesman ki
 * assigned shop). resourceDistributorId ke sath same tenant hona bhi check hota hai.
 */
export async function outletScopeError(user: AuthedUser, outlet: { distributorId: string; salesmanId: string | null }): Promise<Response | null> {
  if (user.role === 'MEGA_ADMIN') {
    return jsonError('Mega Admin sirf distributor accounts manage karta hai — business data locked hai', 403)
  }
  if (user.role === 'SALESMAN') {
    if (outlet.salesmanId !== user.id) return jsonError('Yeh shop aap ki route mein nahi hai', 403)
    return null
  }
  return tenantMismatch(user, outlet.distributorId)
}
