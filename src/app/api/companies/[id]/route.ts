import { db } from '@/lib/db'
import { jsonError, distributorTenant } from '@/lib/dms-scope'

const MAX_LOGO_LEN = 700_000

interface CompanyBody {
  name?: string
  shortCode?: string
  contactPerson?: string
  phone?: string
  email?: string
  address?: string
  notes?: string
  logo?: string | null
  isActive?: boolean
  userId?: string
}

/** GET /api/companies/[id] — company detail + quick stats */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const c = await db.company.findUnique({
      where: { id },
      include: {
        _count: { select: { products: true, salesmen: true, purchaseInvoices: true } },
        ledgerEntries: { select: { debit: true, credit: true } },
      },
    })
    if (!c) return jsonError('Company not found', 404)
    const balance = c.ledgerEntries.reduce((s, e) => s + e.credit - e.debit, 0)
    return Response.json({
      company: {
        id: c.id, name: c.name, shortCode: c.shortCode,
        contactPerson: c.contactPerson, phone: c.phone, email: c.email,
        address: c.address, notes: c.notes, logo: c.logo, isActive: c.isActive,
        productCount: c._count.products, salesmanCount: c._count.salesmen,
        invoiceCount: c._count.purchaseInvoices,
        balance: Math.round(balance * 100) / 100,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Company load failed', 500)
  }
}

/** PATCH /api/companies/[id] — profile update (logo, details, active toggle) — sirf APNI company */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const b = await req.json() as CompanyBody
    if (!b.userId) return jsonError('userId required hai')
    if (b.logo && b.logo.length > MAX_LOGO_LEN) return jsonError('Logo bohat bara hai — chhoti image use karein')
    if (b.name !== undefined && !b.name.trim()) return jsonError('Company name required hai')

    const t = await distributorTenant(b.userId)
    if ('error' in t) return t.error

    const existing = await db.company.findUnique({ where: { id } })
    if (!existing) return jsonError('Company not found', 404)
    if (existing.distributorId !== t.tenantId) return jsonError('Ye company aap ki nahi hai', 403)

    // rename hua to duplicate name check isi tenant ke andar
    if (b.name !== undefined && b.name.trim() !== existing.name) {
      const dup = await db.company.findFirst({ where: { name: b.name.trim(), distributorId: t.tenantId, id: { not: id } } })
      if (dup) return jsonError('Ye naam ki company already exists hai (aap ki companies mein)')
    }

    const data: Record<string, string | boolean | null> = {}
    if (b.name !== undefined) data.name = b.name.trim()
    if (b.shortCode !== undefined) data.shortCode = b.shortCode?.trim() || null
    if (b.contactPerson !== undefined) data.contactPerson = b.contactPerson?.trim() || null
    if (b.phone !== undefined) data.phone = b.phone?.trim() || null
    if (b.email !== undefined) data.email = b.email?.trim() || null
    if (b.address !== undefined) data.address = b.address?.trim() || null
    if (b.notes !== undefined) data.notes = b.notes?.trim() || null
    if (b.logo !== undefined) data.logo = b.logo || null
    if (b.isActive !== undefined) data.isActive = b.isActive

    const company = await db.company.update({ where: { id }, data })
    return Response.json({ company: { id: company.id, name: company.name, shortCode: company.shortCode } })
  } catch (e) {
    console.error(e)
    return jsonError('Company update failed', 500)
  }
}
