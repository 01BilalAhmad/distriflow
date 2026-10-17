import { db } from '@/lib/db'
import { jsonError } from '@/lib/dms-scope'

/** Edit outlet — basic info + Filer/Non-Filer tax status + NTN + CNIC + visit days + route booker assignment */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { name, ownerName, phone, address, city, channel, creditDays, ntn, cnic, filerStatus, visitDays, salesmanId } = body

    const existing = await db.outlet.findUnique({ where: { id } })
    if (!existing) return jsonError('Outlet not found', 404)
    if (!name || !String(name).trim()) return jsonError('Outlet name required hai')

    // Task 68 fix: form khali NTN/CNIC null bhejta hai — String(null) = "null" string ban kar save ho raha tha
    const nextNtn = ntn !== undefined ? cleanNullable(ntn) : cleanNullable(existing.ntn)
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
        cnic: cnic !== undefined ? cleanNullable(cnic) : cleanNullable(existing.cnic),
        filerStatus: nextStatus,
        visitDays: visitDays !== undefined ? sanitizeVisitDays(visitDays) : existing.visitDays,
        // Task 68: shop ko order booker ko assign — '' ya null = unassigned (kisi ke route par nahi)
        salesmanId: salesmanId !== undefined ? (salesmanId || null) : existing.salesmanId,
      },
    })
    return Response.json({ outlet })
  } catch (e) {
    console.error(e)
    return jsonError('Outlet update failed', 500)
  }
}

/** null/undefined/"null"/"undefined"/"" sab -> null (Task 68 fix: String(null) = "null" string DB mein save ho raha tha) */
function cleanNullable(v: unknown): string | null {
  if (v === undefined || v === null) return null
  const s = String(v).trim()
  return !s || s === 'null' || s === 'undefined' ? null : s
}

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** "mon,wed,,xyz" -> "MON,WED" (invalid/empty codes drop) */
function sanitizeVisitDays(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const days = raw.split(',').map((d) => d.trim().toUpperCase()).filter((d) => (DAY_CODES as readonly string[]).includes(d))
  return Array.from(new Set(days)).join(',')
}
