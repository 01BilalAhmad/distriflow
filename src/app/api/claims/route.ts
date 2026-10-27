import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'
import { requireUser, tenantMismatch } from '@/lib/api-auth'

export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb

    const where = { distributorId: user.profile?.id }

    const claims = await db.claim.findMany({
      where,
      include: { distributor: { select: { businessName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    return Response.json({
      claims: claims.map((c) => ({
        id: c.id,
        claimNo: c.claimNo,
        distributorName: c.distributor.businessName,
        type: c.type,
        amount: c.amount,
        status: c.status,
        approvedBy: c.approvedBy,
        reason: c.reason,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
    })
  } catch (e) {
    console.error(e)
    return jsonError('Claims load failed', 500)
  }
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { distributorId, type, amount, reason } = body
    if (!distributorId || !type || !amount) return jsonError('Distributor, type aur amount required hain')

    // Task 95: tenant ownership — claim apne hi tenant par banega
    const tm = await tenantMismatch(user, distributorId)
    if (tm) return tm

    const seq = await nextSeq('claim')
    const claim = await db.claim.create({
      data: {
        claimNo: `CLM-${seq}`,
        distributorId, type, amount: Number(amount),
        reason: reason ?? null, status: 'PENDING',
      },
    })
    return Response.json({ claim: { id: claim.id, claimNo: claim.claimNo } })
  } catch (e) {
    console.error(e)
    return jsonError('Claim create failed', 500)
  }
}
