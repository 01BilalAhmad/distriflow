import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth-token'

/**
 * Task 65 — HAR SECTION KA APNA SECURE PAGE:
 * Har page route (/, /orders, /products ...) ab server-side protected hai.
 *  - Valid signed cookie nahi → /login?next=<path> redirect (page ka content kabhi serve nahi hota)
 *  - /login par already-authenticated user → wapas / (login dobara na dikhe)
 *
 * Task 95 (P0 security) — API routes bhi ab proxy gate ke andar:
 *  - /api/* bina valid cookie → 401 JSON (pehle poora /api anonymous tha — 60+ routes
 *    sirf client-supplied userId par chalte the)
 *  - Exempt: /api/auth/login, /api/auth/session, /api/auth/logout, /api/health
 *    (login/session/logout to khud session banate hain; health probe tools ke liye auth-free)
 *  - Baqi per-route authorization (role scoping) requireUser() se har route ke andar hai —
 *    ye proxy layer sirf pehli deewar hai.
 *
 * (Next 16: middleware convention deprecated — ab proxy.ts.)
 */

/** Bina cookie ke allowed API paths (exact prefix match) */
const API_PUBLIC_PREFIXES = ['/api/auth/login', '/api/auth/session', '/api/auth/logout', '/api/health']

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const userId = await verifyAuthToken(req.cookies.get(AUTH_COOKIE)?.value)
  const authed = !!userId

  // ---- API gate (Task 95) ----
  if (pathname.startsWith('/api/')) {
    const isPublic = API_PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
    if (isPublic || authed) return NextResponse.next()
    return NextResponse.json(
      { error: 'Login required — API access sirf valid session ke sath hai' },
      { status: 401 },
    )
  }

  if (pathname === '/login') {
    if (authed) return NextResponse.redirect(new URL('/', req.url))
    return NextResponse.next()
  }

  if (!authed) {
    const url = new URL('/login', req.url)
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // sab kuch protect — public API paths code ke andar exempt, baqi pages redirect
    '/((?!_next/static|_next/image|_next/webpack-hmr|favicon.ico|robots.txt|logo.svg|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
