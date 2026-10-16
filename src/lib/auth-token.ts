/**
 * Task 65 — Secure page routes: HMAC-signed session token (httpOnly cookie).
 *
 * Pehle session sirf localStorage thi — koi bhi bina login page URL khol sakta tha
 * (middleware kuch nahi tha). Ab login par signed cookie milti hai aur middleware
 * har page route par cookie verify karta hai:
 *   - token = "u.<userId>.<hmac_sha256("u.<userId>", SECRET)>" — tampering detect hoti hai
 *   - SECRET env AUTH_SECRET se aata hai (fallback dev ke liye)
 *   - Web Crypto API — middleware (edge) aur node API routes dono par chalta hai
 */

const SECRET = process.env.AUTH_SECRET || 'distriflow-auth-secret-v1'

export const AUTH_COOKIE = 'dms_auth'
export const AUTH_MAX_AGE = 60 * 60 * 24 * 30 // 30 din

async function hmacHex(payload: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload))
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Signed token banao (login / session sync ke waqt) */
export async function makeAuthToken(userId: string): Promise<string> {
  const payload = `u.${userId}`
  return `${payload}.${await hmacHex(payload)}`
}

/** Cookie token verify karo — valid ho to userId, warna null */
export async function verifyAuthToken(token: string | undefined | null): Promise<string | null> {
  if (!token) return null
  const idx = token.lastIndexOf('.')
  if (idx <= 2) return null
  const payload = token.slice(0, idx)
  const sig = token.slice(idx + 1)
  if (!payload.startsWith('u.')) return null
  const expected = await hmacHex(payload)
  if (sig.length !== expected.length) return null
  // constant-time-ish compare — timing leak avoid
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i)
  if (diff !== 0) return null
  return payload.slice(2)
}

/** httpOnly cookie options — production mein secure flag */
export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: AUTH_MAX_AGE,
  }
}
