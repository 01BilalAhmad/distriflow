import { NextRequest, NextResponse } from 'next/server'
import { AUTH_COOKIE, verifyAuthToken } from '@/lib/auth-token'

/**
 * Task 65 — HAR SECTION KA APNA SECURE PAGE:
 * Har page route (/, /orders, /products ...) ab server-side protected hai.
 *  - Valid signed cookie nahi → /login?next=<path> redirect (page ka content kabhi serve nahi hota)
 *  - /login par already-authenticated user → wapas / (login dobara na dikhe)
 * API routes is proxy se bahar hain (unki apni scope checks hain — dms-scope.ts).
 * (Next 16: middleware convention deprecated — ab proxy.ts.)
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const userId = await verifyAuthToken(req.cookies.get(AUTH_COOKIE)?.value)
  const authed = !!userId

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
    // api + static assets + next internals chhor do, baqi sab page routes protect
    '/((?!api|_next/static|_next/image|_next/webpack-hmr|favicon.ico|robots.txt|logo.svg|.*\\.png$|.*\\.jpg$|.*\\.svg$|.*\\.ico$).*)',
  ],
}
