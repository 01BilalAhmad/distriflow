import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

/**
 * PATCH /api/mega/distributors/[id] — Mega Admin account actions (Task 22)
 * id = target DISTRIBUTOR user id
 * Body: { action, months?, password? }
 *   action = 'activate'      : account ON
 *   action = 'deactivate'    : account OFF (distributor + uski team login se block)
 *   action = 'renew'         : monthly subscription extend — expiry = max(aaj, current expiry) + months
 *   action = 'resetPassword' : login password set (bcrypt-hash store hota hai)
 * Task 95: identity cookie se (body userId IGNORE) — acting user hamesha MEGA_ADMIN.
 */

function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    if (me.role !== 'MEGA_ADMIN') return jsonError('Sirf Mega Admin ye action kar sakta hai', 403)

    const body = await req.json()
    const { action, months, password } = body
    if (!['activate', 'deactivate', 'renew', 'resetPassword'].includes(action)) {
      return jsonError('Action valid nahi hai (activate | deactivate | renew | resetPassword)')
    }

    const target = await db.user.findUnique({ where: { id }, include: { profile: true } })
    if (!target) return jsonError('Distributor account nahi mila', 404)
    if (target.role !== 'DISTRIBUTOR') return jsonError('Sirf distributor accounts par ye action hota hai', 400)

    if (action === 'activate') {
      await db.user.update({ where: { id }, data: { isActive: true } })
      return Response.json({ ok: true, message: `${target.profile?.businessName ?? target.name} ka account ACTIVE ho gaya` })
    }

    if (action === 'deactivate') {
      await db.user.update({ where: { id }, data: { isActive: false } })
      return Response.json({
        ok: true,
        message: `${target.profile?.businessName ?? target.name} ka account INACTIVE — login band (team bhi block)`,
      })
    }

    if (action === 'renew') {
      const m = Number(months)
      if (!Number.isFinite(m) || m < 1 || m > 36) return jsonError('Months 1 se 36 ke beech hone chahiye')
      const base = target.subscriptionExpiry && target.subscriptionExpiry.getTime() > Date.now()
        ? target.subscriptionExpiry
        : new Date()
      const newExpiry = addMonths(base, Math.floor(m))
      await db.user.update({
        where: { id },
        data: {
          subscriptionExpiry: newExpiry,
          // expiry khatam hone par reactivate bhi hota hai (renew = chalu rakhna)
          isActive: true,
          subscriptionStart: target.subscriptionStart ?? new Date(),
        },
      })
      return Response.json({
        ok: true,
        message: `${target.profile?.businessName ?? target.name} ki subscription ${Math.floor(m)} month extend — nayi expiry ${newExpiry.toLocaleDateString('en-PK')}`,
        subscriptionExpiry: newExpiry.toISOString(),
      })
    }

    // resetPassword
    if (!password || String(password).length < 4) return jsonError('Naya password kam az kam 4 harf ka ho')
    // Task 95: password kabhi plaintext store nahi — bcrypt hash
    await db.user.update({ where: { id }, data: { password: await bcrypt.hash(String(password).trim(), 10) } })
    return Response.json({ ok: true, message: `${target.profile?.businessName ?? target.name} ka login password update ho gaya` })
  } catch (e) {
    console.error(e)
    return jsonError('Distributor account action failed', 500)
  }
}
