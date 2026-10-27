import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'
import { requireUser, outletScopeError } from '@/lib/api-auth'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (pehle bilkul unauthenticated tha — koi bhi approve/reject kar sakta tha)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const { id } = await params
    const { action } = await req.json()
    if (!['APPROVE', 'REJECT'].includes(action)) return jsonError('Unknown action')

    const ret = await db.saleReturn.findUnique({
      where: { id },
      include: { outlet: { select: { distributorId: true, salesmanId: true } } },
    })
    if (!ret) return jsonError('Return not found', 404)
    // Task 95: outlet scope — approval sirf apne tenant / apni route ke return par
    const ose = await outletScopeError(user, { distributorId: ret.outlet.distributorId, salesmanId: ret.outlet.salesmanId })
    if (ose) return ose

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    await db.saleReturn.update({ where: { id }, data: { status } })
    return Response.json({ status })
  } catch (e) {
    console.error(e)
    return jsonError('Return update failed', 500)
  }
}
