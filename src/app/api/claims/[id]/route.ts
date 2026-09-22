import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { action, approvedBy } = await req.json()
    if (!['APPROVE', 'REJECT'].includes(action)) return jsonError('Unknown action')

    const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED'
    await db.claim.update({
      where: { id },
      data: { status, approvedBy: approvedBy ?? 'Management' },
    })
    return Response.json({ status })
  } catch (e) {
    console.error(e)
    return jsonError('Claim update failed', 500)
  }
}
