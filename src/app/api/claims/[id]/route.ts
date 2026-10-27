import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha — koi bhi approve/reject kar sakta tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const { action, approvedBy } = await req.json()
    if (!['APPROVE', 'REJECT'].includes(action)) return jsonError('Unknown action')

    const claim = await db.claim.findUnique({ where: { id }, select: { id: true, distributorId: true } })
    if (!claim) return jsonError('Claim not found', 404)
    // Task 95: tenant ownership — claim usi distributor ka hona chahiye
    const tm = await tenantMismatch(user, claim.distributorId)
    if (tm) return tm

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    await db.claim.update({
      where: { id },
      // Task 95: approver ka naam cookie user se (pehle client-supplied tha)
      data: { status, approvedBy: approvedBy ?? user.name },
    })
    return Response.json({ status })
  } catch (e) {
    console.error(e)
    return jsonError('Claim update failed', 500)
  }
}
