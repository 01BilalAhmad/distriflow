import { NextResponse } from 'next/server'
import { AUTH_COOKIE } from '@/lib/auth-token'

/** Task 65 — Logout: httpOnly session cookie clear (localStorage client side clear karta hai) */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE, '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 })
  return res
}
