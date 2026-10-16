import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { AUTH_COOKIE, authCookieOptions, makeAuthToken, verifyAuthToken } from '@/lib/auth-token'

/**
 * Task 65 — Session sync / restore (page-route security ka bridge):
 *
 * 1) LEGACY BRIDGE: purane logged-in users ke paas sirf localStorage session hai, cookie
 *    nahi. Login page par client { userId } bhejta hai — user DB mein mojood + active ho
 *    to cookie set ho jati hai aur bina dobara login kiye purana session chal jata hai.
 *    (Trust level wahi hai jo pehle se API model hai — client userId bhejta hai.)
 * 2) COOKIE REFRESH: shell mount par client bina body ke call karta hai — cookie se
 *    userId nikaal kar DB se fresh user wapas + cookie refresh. Cookie expire ho chuki
 *    ho (30 din) to 401 — client force-logout karega.
 */

function userDTO(user: {
  id: string; name: string; email: string; role: string; phone: string | null; region: string | null
  isActive: boolean; subscriptionExpiry: Date | null
  parent?: { name: string } | null
  profile?: { id: string; businessName: string; city: string; region: string | null; tier: string | null; creditLimit: number } | null
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    region: user.region,
    parentName: user.parent?.name ?? null,
    isActive: user.isActive,
    subscriptionExpiry: user.subscriptionExpiry ? user.subscriptionExpiry.toISOString() : null,
    profile: user.profile
      ? {
          id: user.profile.id,
          businessName: user.profile.businessName,
          city: user.profile.city,
          region: user.profile.region,
          tier: user.profile.tier,
          creditLimit: user.profile.creditLimit,
        }
      : null,
  }
}

export async function POST(req: Request) {
  try {
    let bodyUserId: string | null = null
    try {
      const body = await req.json() as { userId?: string } | null
      bodyUserId = body?.userId ?? null
    } catch { /* empty body — cookie path */ }

    let userId = bodyUserId
    if (!userId) {
      const m = req.headers.get('cookie')?.match(new RegExp(`${AUTH_COOKIE}=([^;]+)`))
      userId = await verifyAuthToken(m?.[1] ?? null)
    }
    if (!userId) return NextResponse.json({ error: 'Session nahi mili' }, { status: 401 })

    const user = await db.user.findUnique({
      where: { id: userId },
      include: { profile: true, parent: { select: { name: true } } },
    })
    if (!user || !user.isActive) {
      return NextResponse.json({ error: 'User inactive ya nahi mila' }, { status: 401 })
    }

    // subscription gate mirror — inactive/expired distributor ka session restore na ho
    if (user.role === 'DISTRIBUTOR' && user.subscriptionExpiry && user.subscriptionExpiry.getTime() < Date.now()) {
      return NextResponse.json({ error: 'Subscription khatam' }, { status: 401 })
    }

    const res = NextResponse.json({ user: userDTO(user) })
    res.cookies.set(AUTH_COOKIE, await makeAuthToken(user.id), authCookieOptions())
    return res
  } catch {
    return NextResponse.json({ error: 'Session restore failed' }, { status: 500 })
  }
}
