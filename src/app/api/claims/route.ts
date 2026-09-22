import { db } from '@/lib/db'
import { jsonError, nextSeq, megaBlocked } from '@/lib/dms-scope'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
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
    const body = await req.json()
    const { distributorId, type, amount, reason } = body
    if (!distributorId || !type || !amount) return jsonError('Distributor, type aur amount required hain')

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
