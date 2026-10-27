import { describe, it, expect } from 'vitest'
import {
  makeAuthToken,
  verifyAuthToken,
  authCookieOptions,
  AUTH_COOKIE,
  AUTH_MAX_AGE,
} from './auth-token'

/**
 * Unit tests for the HMAC session token (audit Finding 2-d — "TOP 5 TESTS" #3).
 * This module is the sole guard for all page routes (src/proxy.ts), so the
 * malformed-token edge cases are pinned here on purpose.
 *
 * NOTE: SECRET is captured at module scope (process.env.AUTH_SECRET with a dev
 * fallback) — tests run against whatever env the runner loads; roundtrip and
 * tamper assertions are secret-agnostic on purpose.
 */

describe('makeAuthToken / verifyAuthToken roundtrip', () => {
  it('verifies a freshly minted token back to the userId', async () => {
    const token = await makeAuthToken('user-123')
    expect(token).toMatch(/^u\.user-123\.[0-9a-f]{64}$/)
    await expect(verifyAuthToken(token)).resolves.toBe('user-123')
  })

  it('supports userIds containing dots (lastIndexOf splits the signature only)', async () => {
    const token = await makeAuthToken('usr_01H.xyz')
    await expect(verifyAuthToken(token)).resolves.toBe('usr_01H.xyz')
  })
})

describe('verifyAuthToken — tamper and malformed rejection', () => {
  it('rejects a tampered payload (userId swapped, signature kept)', async () => {
    const token = await makeAuthToken('user-123')
    const forged = token.replace('u.user-123.', 'u.admin-001.')
    await expect(verifyAuthToken(forged)).resolves.toBeNull()
  })

  it('rejects a tampered signature of correct length', async () => {
    const token = await makeAuthToken('user-123')
    const sig = token.slice(token.lastIndexOf('.') + 1)
    const flipped = (sig[0] === '0' ? '1' : '0') + sig.slice(1)
    await expect(verifyAuthToken(`${token.slice(0, token.lastIndexOf('.'))}.${flipped}`)).resolves.toBeNull()
  })

  it('rejects wrong-length signatures', async () => {
    const token = await makeAuthToken('user-123')
    const truncated = `${token.slice(0, token.lastIndexOf('.'))}.deadbeef`
    await expect(verifyAuthToken(truncated)).resolves.toBeNull()
  })

  it('rejects tokens without the u. payload prefix', async () => {
    await expect(verifyAuthToken('x.user-123.deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).resolves.toBeNull()
  })

  it('rejects empty, dotless, and bare-payload tokens', async () => {
    await expect(verifyAuthToken('')).resolves.toBeNull()
    await expect(verifyAuthToken('nodots')).resolves.toBeNull()
    await expect(verifyAuthToken('u.user-123')).resolves.toBeNull() // no signature
  })

  it('rejects missing/null tokens', async () => {
    await expect(verifyAuthToken(undefined)).resolves.toBeNull()
    await expect(verifyAuthToken(null)).resolves.toBeNull()
  })
})

describe('authCookieOptions', () => {
  it('is httpOnly + lax + root path with the documented max age', () => {
    const opts = authCookieOptions()
    expect(opts.httpOnly).toBe(true)
    expect(opts.sameSite).toBe('lax')
    expect(opts.path).toBe('/')
    expect(opts.maxAge).toBe(AUTH_MAX_AGE)
    expect(AUTH_MAX_AGE).toBe(60 * 60 * 24 * 30)
  })

  it('sets secure exactly when running in production', () => {
    const opts = authCookieOptions()
    expect(opts.secure).toBe(process.env.NODE_ENV === 'production')
  })

  it('uses the documented cookie name', () => {
    expect(AUTH_COOKIE).toBe('dms_auth')
  })
})
