import { NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth-token'
import { db } from '@/lib/db'
import { audit } from '@/lib/audit'

/** Task 65 — Logout: httpOnly session cookie clear (localStorage client side clear karta hai)
 * Task 35 — LOGOUT audit: kaun logout hua (cookie se identity, phir clear) */
export async function POST(req: Request) {
  try {
    const m = req.headers.get('cookie')?.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
    const userId = m?.[1] ? await verifyAuthToken(m[1]) : null
    if (userId) {
      const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
      if (user) {
        await audit(
          { id: user.id, name: user.name, role: user.role, tenantId: user.profile?.id ?? null },
          'LOGOUT',
          { req, entity: 'auth', entityId: user.id, detail: `${user.name} (${user.role}) logout` },
        )
      }
    }
  } catch { /* audit fire-safe — logout hamesha succeed kare */ }
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
