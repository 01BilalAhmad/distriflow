import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import bcrypt from 'bcryptjs'

/**
 * Task 129 — CHANGE PASSWORD (self-service, sab roles: MEGA_ADMIN / DISTRIBUTOR / SALESMAN).
 *
 * Security rules:
 * - Authed session zaroori (requireUser) — hamesha APNA password badalta hai (cookie identity,
 *   body mein koi userId accept NAHI — IDOR band)
 * - Purana password verify hota hai (bcrypt YA legacy plaintext — login route jaisa)
 * - Account lock ho to change nahi hoga (429 — login jaisa consistent)
 * - Naya password: min 8 / max 72 (bcrypt limit), purane se different
 * - Success par: bcrypt hash + failedAttempts/lockedUntil reset + audit PASSWORD_CHANGED
 * - Session cookie waisi hi rehti hai (token user-id based hai — user logged-in rehta hai)
 */

const MIN_LEN = 8
const MAX_LEN = 72

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const authed = auth.user

    const body = await req.json().catch(() => null)
    const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : ''
    const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : ''
    if (!currentPassword || !newPassword) return jsonError('Current and new password are required')

    if (newPassword.length < MIN_LEN) return jsonError(`New password must be at least ${MIN_LEN} characters long`)
    if (newPassword.length > MAX_LEN) return jsonError(`New password must be at most ${MAX_LEN} characters long`)
    if (newPassword === currentPassword) return jsonError('New password must be different from the current password')

    const user = await db.user.findUnique({ where: { id: authed.id } })
    if (!user) return jsonError('Account not found — please sign in again', 401)

    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000)
      return jsonError(`Account is locked — try again in ${mins} minute${mins === 1 ? '' : 's'}`, 429)
    }

    // Purana password verify — hashed YA legacy plaintext (Task 95 lazy-migration jaisa)
    const isHashed = user.password.startsWith('$2a$') || user.password.startsWith('$2b$') || user.password.startsWith('$2y$')
    const currentOk = isHashed ? await bcrypt.compare(currentPassword, user.password) : user.password === currentPassword
    if (!currentOk) {
      await audit(
        { id: user.id, name: user.name, role: user.role, tenantId: authed.profile?.id ?? null },
        'PASSWORD_CHANGE_FAILED',
        { req, entity: 'auth', entityId: user.id, detail: 'Password change failed — current password ghalat tha' },
      )
      return jsonError('Current password is incorrect', 400)
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        password: await bcrypt.hash(newPassword, 10),
        failedAttempts: 0,
        lockedUntil: null,
      },
    })

    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId: authed.profile?.id ?? null },
      'PASSWORD_CHANGED',
      { req, entity: 'auth', entityId: user.id, detail: 'Password changed (self-service — Settings page)' },
    )

    return Response.json({ ok: true, message: 'Password updated successfully' })
  } catch (e) {
    console.error(e)
    return jsonError('Password change failed', 500)
  }
}
