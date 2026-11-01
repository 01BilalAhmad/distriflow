import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

// Task 133 — RECOVERY TRANSACTION HISTORY: tamam wasooli vouchers (RCV-) ki list jis par
// distributor edit/delete kar sakta hai (galti se post/approve hui entries ke liye).
//
// GET /api/recovery/transactions?status=&bookerId=&from=&to=&q=&page=1
//   - status: ALL | PENDING | APPROVED | REJECTED | DELETED (default ALL — deleted bhi
//     dikhti hain sirf is page par, baqi app/report se chhupi hui hain)
//   - bookerId: booker (User) id ya 'UNASSIGNED'
//   - from/to: recoveredAt range (ISO yyyy-mm-dd)
//   - q: RCV no / shop name / receipt no search
//   - page: 1-based, 50 rows per page
// Response: { rows, total, page, pages, sums: { approved, pending, rejected, deleted, approvedCount } }
// Scope: sirf DISTRIBUTOR (apni tenant ki) — SALESMAN/MEGA_ADMIN 403.

const PAGE_SIZE = 50
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'DELETED'] as const

export async function GET(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor recovery history dekh sakta hai', 403)
    if (!me.profile) return jsonError('Distributor profile nahi mila', 404)
    const tenantId = me.profile.id

    const { searchParams } = new URL(req.url)
    const status = (searchParams.get('status') ?? 'ALL').toUpperCase()
    const bookerId = searchParams.get('bookerId') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    const q = (searchParams.get('q') || '').trim()
    const page = Math.max(1, Number(searchParams.get('page')) || 1)

    const where: Record<string, unknown> = { outlet: { distributorId: tenantId } }
    if (STATUSES.includes(status as (typeof STATUSES)[number])) where.status = status
    if (bookerId === 'UNASSIGNED') where.bookerId = null
    else if (bookerId) where.bookerId = bookerId
    const dateRange: Record<string, Date> = {}
    if (from) dateRange.gte = new Date(`${from}T00:00:00.000Z`)
    if (to) dateRange.lte = new Date(`${to}T23:59:59.999Z`)
    if (Object.keys(dateRange).length) where.recoveredAt = dateRange
    if (q) {
      where.OR = [
        { recoveryNo: { contains: q, mode: 'insensitive' } },
        { receiptNo: { contains: q, mode: 'insensitive' } },
        { outlet: { name: { contains: q, mode: 'insensitive' } } },
        { outlet: { code: { contains: q, mode: 'insensitive' } } },
      ]
    }

    const [total, rowsRaw, agg] = await Promise.all([
      db.recovery.count({ where }),
      db.recovery.findMany({
        where,
        include: {
          outlet: { select: { name: true, code: true, code4: true } },
          booker: { select: { name: true } },
        },
        orderBy: [{ recoveredAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      db.recovery.groupBy({
        by: ['status'],
        where: { outlet: { distributorId: tenantId } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ])

    const sums = {
      approved: agg.find((a) => a.status === 'APPROVED')?._sum.amount ?? 0,
      approvedCount: agg.find((a) => a.status === 'APPROVED')?._count._all ?? 0,
      pending: agg.find((a) => a.status === 'PENDING')?._sum.amount ?? 0,
      rejected: agg.find((a) => a.status === 'REJECTED')?._sum.amount ?? 0,
      deleted: agg.find((a) => a.status === 'DELETED')?._sum.amount ?? 0,
      deletedCount: agg.find((a) => a.status === 'DELETED')?._count._all ?? 0,
    }

    return Response.json({
      rows: rowsRaw.map((r) => ({
        id: r.id,
        recoveryNo: r.recoveryNo,
        date: new Date(r.recoveredAt).toISOString(),
        createdAt: new Date(r.createdAt).toISOString(),
        outletId: r.outletId,
        shopName: r.outlet.name,
        shopCode: r.outlet.code,
        bookerName: r.booker?.name ?? null,
        amount: r.amount,
        originalAmount: r.originalAmount,
        editedAmount: r.editedAmount,
        method: r.method,
        reference: r.reference,
        note: r.note,
        status: r.status,
        receiptNo: r.receiptNo,
        postedByName: r.postedByName,
        approvedByName: r.approvedByName,
        approvedAt: r.approvedAt ? new Date(r.approvedAt).toISOString() : null,
        reviewNote: r.reviewNote,
      })),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      sums,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Recovery history load failed', 500)
  }
}
