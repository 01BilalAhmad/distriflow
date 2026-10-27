import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'
import { r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 67 — single target PATCH (value edit) + DELETE.
// Ownership: target ka salesman caller (DISTRIBUTOR) ka apna booker hona chahiye.
// ============================================================

async function ownTarget(id: string, user: AuthedUser) {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Permission nahi hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }

  const target = await db.salesTarget.findUnique({ where: { id }, select: { id: true, salesman: { select: { parentId: true } } } })
  if (!target) return { error: jsonError('Target nahi mila', 404) }
  if (target.salesman.parentId !== user.profile.userId) return { error: jsonError('Ye target aapke booker ka nahi hai', 403) }
  return { target }
}

/** PATCH — sirf targetValue edit (inline edit) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const { id } = await params
    const body = await req.json() as { userId?: string; targetValue?: number | string }
    const own = await ownTarget(id, auth.user)
    if ('error' in own) return own.error

    const value = Number(body.targetValue)
    if (!Number.isFinite(value) || value <= 0) return jsonError('Target value 0 se bara number hona chahiye')

    const saved = await db.salesTarget.update({ where: { id }, data: { targetValue: r2(value) } })
    return Response.json({ target: { id: saved.id, targetValue: saved.targetValue } })
  } catch (e) {
    console.error('targets PATCH', e)
    return jsonError('Target update failed', 500)
  }
}

/** DELETE — target hatao (galti se ban gaya ho) */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (userId query param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const { id } = await params
    const own = await ownTarget(id, auth.user)
    if ('error' in own) return own.error

    await db.salesTarget.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (e) {
    console.error('targets DELETE', e)
    return jsonError('Target delete failed', 500)
  }
}
