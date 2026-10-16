import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { r2 } from '@/lib/reports-kit-server'

// ============================================================
// Task 67 — single target PATCH (value edit) + DELETE.
// Ownership: target ka salesman caller (DISTRIBUTOR) ka apna booker hona chahiye.
// ============================================================

async function ownTarget(id: string, userId: string | undefined) {
  if (!userId) return { error: jsonError('userId required') }
  const caller = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
  if (!caller) return { error: jsonError('User not found', 404) }
  const mb = megaBlocked(caller.role)
  if (mb) return { error: mb }
  if (caller.role !== 'DISTRIBUTOR') return { error: jsonError('Permission nahi hai', 403) }
  if (!caller.profile) return { error: jsonError('Distributor profile nahi mila', 404) }

  const target = await db.salesTarget.findUnique({ where: { id }, select: { id: true, salesman: { select: { parentId: true } } } })
  if (!target) return { error: jsonError('Target nahi mila', 404) }
  if (target.salesman.parentId !== caller.profile.userId) return { error: jsonError('Ye target aapke booker ka nahi hai', 403) }
  return { target }
}

/** PATCH — sirf targetValue edit (inline edit) */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as { userId?: string; targetValue?: number | string }
    const own = await ownTarget(id, body.userId)
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
    const { id } = await params
    const url = new URL(req.url)
    const own = await ownTarget(id, url.searchParams.get('userId') ?? undefined)
    if ('error' in own) return own.error

    await db.salesTarget.delete({ where: { id } })
    return Response.json({ ok: true })
  } catch (e) {
    console.error('targets DELETE', e)
    return jsonError('Target delete failed', 500)
  }
}
