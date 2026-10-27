import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { matchShopCategory, readShopCategories } from '@/lib/dms-settings'

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

function sanitizeVisitDays(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const days = raw.split(',').map((d) => d.trim().toUpperCase()).filter((d) => (DAY_CODES as readonly string[]).includes(d))
  return Array.from(new Set(days)).join(',')
}

/**
 * Task 85 — NEW SHOP EDIT / APPROVE (admin)
 * PATCH /api/new-shops/[id]
 * Body: { userId, ...fields }                    => shop edit (approval se pehle BHI, baad MEIN bhi)
 * Body: { userId, action: 'APPROVE' }            => status PENDING -> APPROVED (shop Outlets/route/orders mein aa jati hai)
 * DISTRIBUTOR-only, sirf apne tenant ki shop.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { userId } = body as { userId?: string; action?: string }
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'DISTRIBUTOR' || !user.profile) return jsonError('Sirf distributor shop edit/approve kar sakta hai', 403)

    const outlet = await db.outlet.findUnique({ where: { id } })
    if (!outlet || outlet.distributorId !== user.profile.id) return jsonError('Shop not found', 404)

    // ---- APPROVE action ----
    if (body.action === 'APPROVE') {
      if (outlet.status === 'APPROVED') return jsonError('Ye shop pehle se approved hai')
      const updated = await db.outlet.update({ where: { id }, data: { status: 'APPROVED' } })
      return Response.json({ outlet: { id: updated.id, code: updated.code, name: updated.name, status: updated.status }, message: 'Shop approved — ab Outlets, route aur orders mein nazar aayegi' })
    }

    // ---- EDIT (fields) — approval se pehle aur baad dono mein allowed ----
    const b = body as {
      name?: string; ownerName?: string; ownerPhone?: string; phone?: string; address?: string
      city?: string; channel?: string; cnic?: string; ntn?: string; creditDays?: number; visitDays?: string
      lat?: number; lng?: number
    }
    const data: Record<string, unknown> = {}
    if (typeof b.name === 'string' && b.name.trim()) data.name = b.name.trim()
    if (typeof b.ownerName === 'string') data.ownerName = b.ownerName.trim() || null
    const phone = typeof b.ownerPhone === 'string' ? b.ownerPhone : typeof b.phone === 'string' ? b.phone : undefined
    if (typeof phone === 'string') data.phone = phone.trim() || null
    if (typeof b.address === 'string') data.address = b.address.trim() || null
    if (typeof b.city === 'string' && b.city.trim()) data.city = b.city.trim()
    // Task 92: channel tenant ki shop-categories list se validate — match to canonical naam,
    // unchanged legacy value (shop ka apna channel) to keep, warna GENERAL fallback
    if (typeof b.channel === 'string' && b.channel.trim()) {
      const list = await readShopCategories(user.profile.id)
      const matched = matchShopCategory(list, b.channel)
      if (matched) data.channel = matched
      else if (b.channel.trim() === outlet.channel) { /* legacy unchanged — chhoro */ }
      else data.channel = 'GENERAL'
    }
    if (typeof b.cnic === 'string') data.cnic = b.cnic.trim() || null
    if (typeof b.ntn === 'string') {
      const ntn = b.ntn.trim() || null
      data.ntn = ntn
      // Filer/Non-Filer auto: NTN likha ho to FILER (admin outlets page se override kar sakta hai)
      if (ntn) data.filerStatus = 'FILER'
    }
    if (b.creditDays != null && Number.isFinite(Number(b.creditDays))) data.creditDays = Math.max(0, Math.round(Number(b.creditDays)))
    const vd = sanitizeVisitDays(b.visitDays)
    if (vd !== undefined) data.visitDays = vd
    if (b.lat != null && Number.isFinite(Number(b.lat)) && Math.abs(Number(b.lat)) <= 90) data.lat = Number(b.lat)
    if (b.lng != null && Number.isFinite(Number(b.lng)) && Math.abs(Number(b.lng)) <= 180) data.lng = Number(b.lng)

    if (Object.keys(data).length === 0) return jsonError('Edit ke liye koi valid field nahi mila')

    const updated = await db.outlet.update({ where: { id }, data, select: { id: true, code: true, name: true, status: true } })
    return Response.json({ outlet: updated, message: 'Shop update ho gayi' })
  } catch (e) {
    console.error(e)
    return jsonError('Shop update failed', 500)
  }
}
