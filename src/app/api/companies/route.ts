import { db } from '@/lib/db'
import { jsonError, tenantProfileId, distributorTenant } from '@/lib/dms-scope'

const MAX_LOGO_LEN = 700_000 // ~700KB base64 guard

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

/**
 * GET /api/companies?userId= — companies with details, product/salesman counts + payable balance
 * Task 23: sirf caller ke APNI tenant ki companies (naye distributor ki list khali hoti hai).
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return jsonError('userId required')

    const tenantId = await tenantProfileId(userId)
    if (!tenantId) return Response.json({ companies: [], totals: { payable: 0, purchaseTotal: 0, count: 0 } })

    const companies = await db.company.findMany({
      where: { isActive: true, distributorId: tenantId },
      include: {
        _count: { select: { products: true, salesmen: true, purchaseInvoices: true } },
        ledgerEntries: { select: { debit: true, credit: true } },
        purchaseInvoices: { select: { total: true } },
      },
      orderBy: { name: 'asc' },
    })
    return Response.json({
      companies: companies.map((c) => {
        const balance = c.ledgerEntries.reduce((s, e) => s + e.credit - e.debit, 0)
        const purchaseTotal = c.purchaseInvoices.reduce((s, i) => s + i.total, 0)
        return {
          id: c.id,
          name: c.name,
          shortCode: c.shortCode,
          contactPerson: c.contactPerson,
          phone: c.phone,
          email: c.email,
          address: c.address,
          notes: c.notes,
          logo: c.logo,
          productCount: c._count.products,
          salesmanCount: c._count.salesmen,
          invoiceCount: c._count.purchaseInvoices,
          balance: Math.round(balance * 100) / 100,
          purchaseTotal: Math.round(purchaseTotal * 100) / 100,
        }
      }),
      totals: {
        payable: Math.round(companies.reduce((s, c) => {
          const bal = c.ledgerEntries.reduce((x, e) => x + e.credit - e.debit, 0)
          return s + Math.max(0, bal)
        }, 0) * 100) / 100,
        purchaseTotal: Math.round(companies.reduce((s, c) => s + c.purchaseInvoices.reduce((x, i) => x + i.total, 0), 0) * 100) / 100,
        count: companies.length,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Companies load failed', 500)
  }
}

/** POST /api/companies — nayi company (logo + details ke saath) — DISTRIBUTOR apni tenant mein */
export async function POST(req: Request) {
  try {
    const b = await req.json() as CompanyBody
    if (!b.userId) return jsonError('userId required hai')
    if (!b.name?.trim()) return jsonError('Company name required hai')
    if (b.logo && b.logo.length > MAX_LOGO_LEN) return jsonError('Logo bohat bara hai — chhoti image use karein')

    const t = await distributorTenant(b.userId)
    if ('error' in t) return t.error
    const tenantId = t.tenantId

    // duplicate name — SIRF isi tenant ke andar (do distributors ki same-name company allowed)
    const exists = await db.company.findFirst({ where: { name: b.name.trim(), distributorId: tenantId } })
    if (exists) return jsonError('Ye company already exists hai (aap ki companies mein)')

    const company = await db.company.create({
      data: {
        name: b.name.trim(),
        distributorId: tenantId,
        shortCode: b.shortCode?.trim() || null,
        contactPerson: b.contactPerson?.trim() || null,
        phone: b.phone?.trim() || null,
        email: b.email?.trim() || null,
        address: b.address?.trim() || null,
        notes: b.notes?.trim() || null,
        logo: b.logo ?? null,
      },
    })
    return Response.json({ company: { id: company.id, name: company.name, shortCode: company.shortCode } })
  } catch (e) {
    console.error(e)
    return jsonError('Company create failed', 500)
  }
}
