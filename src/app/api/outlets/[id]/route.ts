import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/** Edit outlet — basic info + Filer/Non-Filer tax status + NTN + CNIC + visit days */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, ownerName, phone, address, city, channel, creditDays, ntn, cnic, filerStatus, visitDays } = body

    const existing = await db.outlet.findUnique({ where: { id } })
    if (!existing) return jsonError('Outlet not found', 404)
    if (!name || !String(name).trim()) return jsonError('Outlet name required hai')

    const nextNtn = ntn !== undefined ? (String(ntn).trim() || null) : existing.ntn
    let nextStatus = existing.filerStatus
    if (filerStatus === 'FILER' || filerStatus === 'NON_FILER') nextStatus = filerStatus
    else if (ntn !== undefined && nextNtn) nextStatus = 'FILER' // NTN add hua to Filer default

    const outlet = await db.outlet.update({
      where: { id },
      data: {
        name: String(name).trim(),
        ownerName: ownerName !== undefined ? (ownerName || null) : existing.ownerName,
        phone: phone !== undefined ? (phone || null) : existing.phone,
        address: address !== undefined ? (address || null) : existing.address,
        city: city || existing.city,
        channel: channel || existing.channel,
        creditDays: creditDays != null ? (Number(creditDays) || existing.creditDays) : existing.creditDays,
        ntn: nextNtn,
        cnic: cnic !== undefined ? (String(cnic).trim() || null) : existing.cnic,
        filerStatus: nextStatus,
        visitDays: visitDays !== undefined ? sanitizeVisitDays(visitDays) : existing.visitDays,
      },
    })
    return Response.json({ outlet })
  } catch (e) {
    console.error(e)
    return jsonError('Outlet update failed', 500)
  }
}

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** "mon,wed,,xyz" -> "MON,WED" (invalid/empty codes drop) */
function sanitizeVisitDays(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const days = raw.split(',').map((d) => d.trim().toUpperCase()).filter((d) => (DAY_CODES as readonly string[]).includes(d))
  return Array.from(new Set(days)).join(',')
}
