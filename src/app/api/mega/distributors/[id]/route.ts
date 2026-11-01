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
    const { action, months, password, until, note } = body
    if (!['activate', 'deactivate', 'renew', 'resetPassword', 'maintenanceOn', 'maintenanceOff'].includes(action)) {
      return jsonError('Action valid nahi hai (activate | deactivate | renew | resetPassword | maintenanceOn | maintenanceOff)')
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

    const label = target.profile?.businessName ?? target.name

    // resetPassword
    if (action === 'resetPassword') {
      if (!password || String(password).length < 4) return jsonError('Naya password kam az kam 4 harf ka ho')
      // Task 95: password kabhi plaintext store nahi — bcrypt hash
      await db.user.update({ where: { id }, data: { password: await bcrypt.hash(String(password).trim(), 10) } })
      return Response.json({ ok: true, message: `${label} ka login password update ho gaya` })
    }

    if (action === 'maintenanceOff') {
      // Task 127 — per-distributor maintenance (soft pause, isActive/subscription se alag):
      // window clear → distributor + team turant wapis online.
      await db.user.update({ where: { id }, data: { maintenanceUntil: null, maintenanceNote: null } })
      return Response.json({ ok: true, message: `${label} ka maintenance window khatam — abhi wapis online` })
    }

    // maintenanceOn — window max 7 din, note 160 chars. Khatam hote hi khud-ba-khud wapis.
    const untilDate = until ? new Date(String(until)) : null
    if (!untilDate || Number.isNaN(untilDate.getTime())) return jsonError('Maintenance window ka time (until) valid nahi hai')
    if (untilDate.getTime() <= Date.now()) return jsonError('Maintenance window future ka hona chahiye')
    if (untilDate.getTime() - Date.now() > 7 * 24 * 60 * 60 * 1000) return jsonError('Maintenance window max 7 din ho sakti hai')
    const cleanNote = note ? String(note).slice(0, 160) : null
    await db.user.update({ where: { id }, data: { maintenanceUntil: untilDate, maintenanceNote: cleanNote } })
    return Response.json({
      ok: true,
      message: `${label} maintenance par hai — ${untilDate.toLocaleString('en-PK')} tak band`,
      maintenanceUntil: untilDate.toISOString(),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Distributor account action failed', 500)
  }
}

/*
 * Task 127 — per-distributor MAINTENANCE (soft pause, isActive/subscription se alag):
 * PATCH action = 'maintenanceOn'  : body { until: ISO, note? } — distributor + team ka
 *                                   login/API block (503 + friendly message), window
 *                                   khatam hote hi khud-ba-khud wapis. Max 7 din.
 * PATCH action = 'maintenanceOff' : window clear — turant wapis.
 * MEGA_ADMIN ko maintenance gate kabhi block nahi karta, is liye seller apna toggle
 * khud chala sakta hai (requireUser gate usay pass karta hai — by design).
 */
