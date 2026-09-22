import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * GET /api/ledgers?userId=&outletId= — shop keepers ledger (udhaar khata).
 * Without outletId: all scoped outlets with debit/credit/balance aggregates.
 * With outletId: full entry history with running balance.
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const outletId = searchParams.get('outletId')
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb

    // Scope outlets by role
    let outletWhere: Record<string, unknown> = {}
    if (user.role === 'SALESMAN') outletWhere = { salesmanId: userId }
    else outletWhere = { distributorId: user.profile?.id }

    if (outletId) {
      const outlet = await db.outlet.findFirst({ where: { id: outletId, ...outletWhere } })
      if (!outlet) return jsonError('Outlet not found', 404)

      const entries = await db.outletLedger.findMany({
        where: { outletId },
        orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      })
      let running = 0
      const rows = entries.map((e) => {
        running += e.type === 'DEBIT' ? e.amount : -e.amount
        return {
          id: e.id,
          date: new Date(e.date).toISOString(),
          type: e.type,
          refType: e.refType,
          refNo: e.refNo,
          note: e.note,
          debit: e.type === 'DEBIT' ? e.amount : 0,
          credit: e.type === 'CREDIT' ? e.amount : 0,
          balance: Math.round(running * 100) / 100,
        }
      })

      return Response.json({
        outlet: {
          id: outlet.id, name: outlet.name, code: outlet.code, city: outlet.city,
          channel: outlet.channel, creditDays: outlet.creditDays,
        },
        balance: Math.round(running * 100) / 100,
        entries: rows.reverse(), // newest first for UI
      })
    }

    const outlets = await db.outlet.findMany({
      where: outletWhere,
      include: { ledgerEntries: true, distributor: { select: { businessName: true } } },
      orderBy: { name: 'asc' },
    })

    const rows = outlets.map((o) => {
      const debit = o.ledgerEntries.filter((e) => e.type === 'DEBIT').reduce((s, e) => s + e.amount, 0)
      const credit = o.ledgerEntries.filter((e) => e.type === 'CREDIT').reduce((s, e) => s + e.amount, 0)
      return {
        outletId: o.id,
        name: o.name,
        code: o.code,
        city: o.city,
        channel: o.channel,
        distributorName: o.distributor.businessName,
        entries: o.ledgerEntries.length,
        lastEntryAt: o.ledgerEntries.length
          ? new Date(o.ledgerEntries.reduce((a, b) => (a.date > b.date ? a : b)).date).toISOString()
          : null,
        debit: Math.round(debit * 100) / 100,
        credit: Math.round(credit * 100) / 100,
        balance: Math.round((debit - credit) * 100) / 100,
      }
    })

    return Response.json({
      ledgers: rows,
      totals: {
        outstanding: Math.round(rows.reduce((s, r) => s + Math.max(0, r.balance), 0) * 100) / 100,
        shopsWithUdhaar: rows.filter((r) => r.balance > 0.01).length,
        totalShops: rows.length,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Ledgers load failed', 500)
  }
}
