import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { distributorsUnderMaintenance, getGlobalMaintenance, setGlobalMaintenance } from '@/lib/maintenance'

/**
 * Task 127 — GLOBAL maintenance switch (MEGA_ADMIN only).
 *
 * GET  — current status: { global: { until, note } | null, users: [...] }
 * POST — body { until: ISO | null, note? }:
 *        until = ISO future time  → global maintenance ON (sab distributors + team 503)
 *        until = null             → OFF (turant wapis)
 * MEGA_ADMIN kabhi block nahi hota — ye route usi ke toggle ke liye hai.
 * Per-distributor maintenance /api/mega/distributors/[id] PATCH par hai.
 */

export async function GET(req: Request) {
  const auth = await requireUser(req)
  if ('error' in auth) return auth.error
  if (auth.user.role !== 'MEGA_ADMIN') return jsonError('Only the Mega Admin can view system status', 403)

  const global = await getGlobalMaintenance()
  const users = await distributorsUnderMaintenance()
  return Response.json({
    global: global ? { until: global.until.toISOString(), note: global.note } : null,
    users,
  })
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    if (me.role !== 'MEGA_ADMIN') return jsonError('Only the Mega Admin can toggle system maintenance', 403)

    const body = await req.json().catch(() => null)
    if (!body || !('until' in body)) return jsonError('Body mein until (ISO ya null) zaroori hai')

    const note = body.note ? String(body.note).slice(0, 160) : null

    if (body.until === null || body.until === '') {
      await setGlobalMaintenance(null, null)
      await audit({ id: me.id, name: me.name, role: me.role }, 'MAINTENANCE_OFF', {
        req, entity: 'system', detail: 'Global maintenance OFF — sab distributors wapis online',
      })
      return Response.json({ ok: true, message: 'Global maintenance OFF — sab distributors ab online hain' })
    }

    const until = new Date(String(body.until))
    if (Number.isNaN(until.getTime())) return jsonError('until valid ISO date honi chahiye')
    if (until.getTime() <= Date.now()) return jsonError('Maintenance window future ki honi chahiye')
    if (until.getTime() - Date.now() > 24 * 60 * 60 * 1000) return jsonError('Global maintenance max 24 ghante ho sakti hai')

    await setGlobalMaintenance(until, note)
    await audit({ id: me.id, name: me.name, role: me.role }, 'MAINTENANCE_ON', {
      req, entity: 'system', detail: `Global maintenance ON — ${until.toLocaleString('en-PK')} tak${note ? ` (${note})` : ''}`,
    })
    return Response.json({
      ok: true,
      message: `Global maintenance ON — distributors ${until.toLocaleString('en-PK')} tak band`,
      global: { until: until.toISOString(), note },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Maintenance toggle failed', 500)
  }
}
