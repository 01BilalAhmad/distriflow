import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { AUTH_COOKIE, authCookieOptions, makeAuthToken } from '@/lib/auth-token'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { audit } from '@/lib/audit'

/**
 * MEGA ADMIN subscription model (Task 22):
 * - MEGA_ADMIN (software seller): distributor accounts banata hai, active/inactive karta hai,
 *   monthly subscription control karta hai — business data ka koi access nahi.
 * - DISTRIBUTOR (subscriber): apna poora business portal — inactive/expired subscription par login BLOCK.
 * - SALESMAN (order booker): distributor ki team — us ka distributor band ho to ye bhi
 *   login nahi kar sakta (subscription poori team par lagti hai).
 *
 * Task 95 (P0 security):
 * - bcrypt password compare (pehle PLAINTEXT tha — DB leak = sab passwords leak)
 * - Lazy migration: pehle login par purana plaintext password verify ho kar bcrypt hash
 *   mein upgrade ho jata hai (koi data migration script nahi chahiye)
 * - Account lock: 5 galat attempts par 15 min lock (DB-backed — saare instances par effective)
 * - IP rate limit: 10 login tries / 5 min (spam hammering slow)
 */

const MAX_FAILED_ATTEMPTS = 5
const LOCK_MINUTES = 15

// User-enumeration timing block — unknown email par bhi wahi bcrypt compare chalega
const DUMMY_HASH = '$2a$10$C6UzMDM.H6dfI/f/IKcEeO7VTgxjrpU8k95Lxvtqk1PGCvXnLBDF6'

interface GateUser {
  id: string
  role: string
  isActive: boolean
  subscriptionExpiry: Date | null
  parentId: string | null
}

function expired(u: GateUser): boolean {
  return !!u.subscriptionExpiry && u.subscriptionExpiry.getTime() < Date.now()
}

/** Distributor account gate — null = OK, warna error message */
function distributorGate(u: GateUser): string | null {
  if (!u.isActive) {
    return 'Aap ka distributor account INACTIVE hai — subscription renew ke liye Mega Admin se rabta karein'
  }
  if (expired(u)) {
    return 'Aap ki monthly subscription khatam ho gayi hai — renew ke liye Mega Admin se rabta karein'
  }
  return null
}

export async function POST(req: Request) {
  try {
    // ---- IP rate limit (per-instance) ----
    const ip = clientIp(req)
    const rl = rateLimit(`login:${ip}`, { windowMs: 5 * 60 * 1000, max: 10 })
    if (!rl.ok) {
      return Response.json(
        { error: `Bohat zyada login attempts — ${rl.retryAfterSec} second baad koshish karein` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
      )
    }

    const { email, password } = await req.json()
    if (!email || !password) return jsonError('Email aur password required hai')

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { profile: true, parent: { select: { name: true } } },
    })
    if (!user) {
      await bcrypt.compare(String(password), DUMMY_HASH) // timing equalizer
      // Task 35: security trail — kaunsa email login try kar raha tha (password KABHI log nahi)
      await audit(null, 'LOGIN_FAILED', { req, entity: 'auth', detail: `Login fail — email registered nahi: ${String(email).toLowerCase().trim().slice(0, 120)}` })
      return jsonError('Invalid credentials - ye email registered nahi hai', 401)
    }

    // ---- Account lock check (DB-backed — saare serverless instances par effective) ----
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      return jsonError(`Account lock hai — ${mins} minute baad koshish karein`, 429)
    }

    // ---- Password verify: bcrypt hash YA legacy plaintext (lazy upgrade) ----
    let passwordOk = false
    const isHashed = user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')
    if (isHashed) {
      passwordOk = await bcrypt.compare(String(password), user.password)
    } else {
      passwordOk = user.password === password
    }

    if (!passwordOk) {
      const failed = user.failedAttempts + 1
      const lock = failed >= MAX_FAILED_ATTEMPTS
      await db.user.update({
        where: { id: user.id },
        data: {
          failedAttempts: lock ? 0 : failed,
          lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60 * 1000) : user.lockedUntil,
        },
      })
      await audit(
        { id: user.id, name: user.name, role: user.role },
        'LOGIN_FAILED',
        { req, entity: 'auth', detail: `Galat password${lock ? ' — account lock ho gaya' : ''} (attempt ${failed}/${MAX_FAILED_ATTEMPTS})` },
      )
      if (lock) {
        return jsonError(`Bohat galat attempts — account ${LOCK_MINUTES} minute ke liye lock ho gaya`, 429)
      }
      return jsonError('Invalid credentials', 401)
    }

    // ---- Success: attempt counter reset + legacy plaintext password ko hash mein upgrade ----
    await db.user.update({
      where: { id: user.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
        ...(isHashed ? {} : { password: await bcrypt.hash(String(password), 10) }),
      },
    })

    // ---- Subscription gate ----
    if (user.role === 'DISTRIBUTOR') {
      const msg = distributorGate(user)
      if (msg) return jsonError(msg, 403)
    } else if (user.role === 'SALESMAN') {
      // team member: owner distributor tak walk-up (max 3 levels)
      let cursorId = user.parentId
      let hops = 0
      while (cursorId && hops < 3) {
        const owner = await db.user.findUnique({ where: { id: cursorId } })
        if (!owner) break
        if (owner.role === 'DISTRIBUTOR') {
          const msg = distributorGate(owner)
          if (msg) return jsonError(`${owner.name}: ${msg}`, 403)
          break
        }
        cursorId = owner.parentId
        hops++
      }
    }

    // Task 65: signed httpOnly session cookie — middleware isi se page routes protect karta hai
    const res = NextResponse.json({
      user: {
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
      },
    })
    res.cookies.set(AUTH_COOKIE, await makeAuthToken(user.id), authCookieOptions())
    // Task 35: LOGIN audit — kaun, kab, kis role se (profile tenant ke sath)
    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId: user.profile?.id ?? null },
      'LOGIN',
      { req, entity: 'auth', entityId: user.id, detail: `${user.name} (${user.role}) login — ${user.email}` },
    )
    return res
  } catch {
    return jsonError('Login failed', 500)
  }
}
