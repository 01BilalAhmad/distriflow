import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { action, approvedBy } = await req.json()
    if (!['APPROVE', 'REJECT'].includes(action)) return jsonError('Unknown action')

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    await db.saleReturn.update({ where: { id }, data: { status } })
    return Response.json({ status })
  } catch (e) {
    console.error(e)
    return jsonError('Return update failed', 500)
  }
}
