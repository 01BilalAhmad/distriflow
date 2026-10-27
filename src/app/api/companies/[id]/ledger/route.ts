import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser, type AuthedUser } from '@/lib/api-auth'

// Task 95: tenantProfileId(userId) helper ki jagah cookie-user se tenant resolve
// (same semantics: apna profile, warna salesman parent walk-up, warna null)
async function tenantProfileOf(user: AuthedUser): Promise<string | null> {
  if (user.profile) return user.profile.id
  if (user.parentId) {
    const owner = await db.user.findUnique({ where: { id: user.parentId }, include: { profile: true } })
    return owner?.profile?.id ?? null
  }
  return null
}

// Task 95: distributorTenant(userId) helper ki jagah cookie-user par direct checks (same semantics)
function distributorTenantOf(user: AuthedUser): { tenantId: string; error?: never } | { tenantId?: never; error: Response } {
  const mb = megaBlocked(user.role)
  if (mb) return { error: mb }
  if (user.role !== 'DISTRIBUTOR') return { error: jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403) }
  if (!user.profile) return { error: jsonError('Distributor profile nahi mila', 404) }
  return { tenantId: user.profile.id }
}

/**
 * GET /api/companies/[id]/ledger — payable ledger entries (ascending) + running balance.
 * Balance = SUM(credit) - SUM(debit) => positive = company ko dena hai.
 * Task 23: company ownership check — sirf apni tenant ki company ka ledger.
 * Task 95: identity cookie se (userId param IGNORE — IDOR band).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error

    const { id } = await params
    const tenantId = await tenantProfileOf(auth.user)
    if (!tenantId) return jsonError('Tenant nahi mila', 404)

    const company = await db.company.findUnique({ where: { id } })
    if (!company) return jsonError('Company not found', 404)
    if (company.distributorId !== tenantId) return jsonError('Ye company aap ki nahi hai', 403)

    const entries = await db.companyLedgerEntry.findMany({
      where: { companyId: id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { invoice: { select: { invoiceNo: true } } },
    })

    let running = 0
    let totalDebit = 0
    let totalCredit = 0
    const rows = entries.map((e) => {
      running += e.credit - e.debit
      totalDebit += e.debit
      totalCredit += e.credit
      return {
        id: e.id,
        date: e.date,
        type: e.type,
        description: e.description,
        refNo: e.refNo,
        invoiceNo: e.invoice?.invoiceNo ?? null,
        debit: e.debit,
        credit: e.credit,
        balance: Math.round(running * 100) / 100,
      }
    })

    return Response.json({
      company: { id: company.id, name: company.name, shortCode: company.shortCode, logo: company.logo, address: company.address, phone: company.phone },
      totals: {
        debit: Math.round(totalDebit * 100) / 100,
        credit: Math.round(totalCredit * 100) / 100,
        balance: Math.round(running * 100) / 100, // payable
      },
      entries: rows,
    })
  } catch (e) {
    console.error(e)
    return jsonError('Ledger load failed', 500)
  }
}

interface LedgerPostBody {
  type?: string // PAYMENT | DEBIT_NOTE | CREDIT_NOTE | ADJUSTMENT
  amount?: number
  direction?: 'DEBIT' | 'CREDIT' // sirf ADJUSTMENT ke liye
  date?: string
  description?: string
  refNo?: string
  invoiceId?: string | null // payment ko invoice par apply karne ke liye
}

/** POST /api/companies/[id]/ledger — manual payment / adjustment entry — sirf APNI company */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const t = distributorTenantOf(auth.user)
    if ('error' in t) return t.error

    const { id } = await params
    const b = await req.json() as LedgerPostBody
    const amount = Number(b.amount ?? 0)
    if (!amount || amount <= 0) return jsonError('Amount 0 se bara hona chahiye')
    if (!b.description?.trim()) return jsonError('Description required hai')

    const company = await db.company.findUnique({ where: { id } })
    if (!company) return jsonError('Company not found', 404)
    if (company.distributorId !== t.tenantId) return jsonError('Ye company aap ki nahi hai', 403)

    const VALID = ['PAYMENT', 'DEBIT_NOTE', 'CREDIT_NOTE', 'ADJUSTMENT']
    if (!b.type || !VALID.includes(b.type)) return jsonError('Entry type invalid hai')

    // Direction: PAYMENT/DEBIT_NOTE = debit (payable kam), CREDIT_NOTE = credit (payable barh)
    let debit = 0
    let credit = 0
    if (b.type === 'PAYMENT' || b.type === 'DEBIT_NOTE') debit = amount
    else if (b.type === 'CREDIT_NOTE') credit = amount
    else {
      if (b.direction !== 'DEBIT' && b.direction !== 'CREDIT') return jsonError('Adjustment ke liye direction select karein')
      if (b.direction === 'DEBIT') debit = amount
      else credit = amount
    }

    const entry = await db.$transaction(async (tx) => {
      const created = await tx.companyLedgerEntry.create({
        data: {
          companyId: id,
          distributorId: t.tenantId,
          date: b.date ? new Date(b.date) : new Date(),
          type: b.type!,
          description: b.description!.trim(),
          refNo: b.refNo?.trim() || null,
          invoiceId: b.invoiceId || null,
          debit,
          credit,
        },
      })

      // Payment/debit note kisi purchase invoice par apply hua to paidAmount + status update
      if (b.invoiceId && debit > 0) {
        const inv = await tx.purchaseInvoice.findUnique({ where: { id: b.invoiceId } })
        if (inv && inv.companyId === id) {
          const paid = Math.min(inv.total, inv.paidAmount + debit)
          const status = paid >= inv.total - 0.01 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID'
          await tx.purchaseInvoice.update({ where: { id: inv.id }, data: { paidAmount: paid, status } })
        }
      }
      return created
    })

    return Response.json({ entry: { id: entry.id } })
  } catch (e) {
    console.error(e)
    return jsonError('Ledger entry failed', 500)
  }
}
