import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { getTenantIdForSalesman } from '@/lib/dms-pjp'
import { resolveShopChannel } from '@/lib/dms-settings'

/**
 * Task 85 — OFFLINE-FIRST NEW SHOP TAGGING (booker app / web booker portal)
 * POST /api/outlets/tag
 * Body: { userId, clientRef, name, address, city, ownerName, ownerPhone, cnic, ntn, channel, lat, lng }
 * - SALESMAN only — booker apni nayi shop tag karta hai (mobile offline app ya web portal se)
 * - GPS LAZMI — location ke bagair shop tag nahi hogi
 * - Shop status = PENDING — admin approve kare tab Outlets/route/orders mein aayegi
 * - Idempotent: same clientRef dobara aaye to wahi outlet wapas (duplicate nahi banti)
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { userId, clientRef, name, address, city, ownerName, ownerPhone, cnic, ntn, channel, lat, lng } = body as {
      userId?: string; clientRef?: string; name?: string; address?: string; city?: string
      ownerName?: string; ownerPhone?: string; cnic?: string; ntn?: string; channel?: string
      lat?: number; lng?: number
    }
    if (!userId) return jsonError('userId required')
    if (!name || !String(name).trim()) return jsonError('Shop ka naam lazmi hai')
    if (!address || !String(address).trim()) return jsonError('Shop ka address lazmi hai (owner ke sath GPS tag)')
    if (!ownerName || !String(ownerName).trim()) return jsonError('Owner ka naam lazmi hai')
    if (!ownerPhone || !String(ownerPhone).trim()) return jsonError('Owner ka phone number lazmi hai')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user) return jsonError('User not found', 404)
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'SALESMAN') return jsonError('Sirf order booker nayi shop tag kar sakta hai', 403)

    const tenantId = await getTenantIdForSalesman(user.id)
    if (!tenantId) return jsonError('Aap kisi distributor se attached nahi hain', 403)

    // GPS LAZMI — shop jahan tag ki gayi wahan ke coordinates ke bagair entry nahi hogi
    const latN = Number(lat)
    const lngN = Number(lng)
    if (!Number.isFinite(latN) || !Number.isFinite(lngN) || Math.abs(latN) > 90 || Math.abs(lngN) > 180) {
      return jsonError('GPS capture lazmi hai — location ke bagair nayi shop tag nahi ho sakti. Location ON kar ke dobara koshish karein')
    }

    // Idempotent sync — same clientRef pehle se server par ho to wahi shop wapas
    const ref = (clientRef ?? '').trim()
    if (ref) {
      const existing = await db.outlet.findUnique({ where: { clientRef: ref } })
      if (existing && existing.salesmanId === user.id) {
        return Response.json({ outlet: { id: existing.id, code: existing.code, name: existing.name, status: existing.status }, duplicate: true })
      }
    }

    const count = await db.outlet.count()
    const code = `OUT-${1005 + (count + 1) * 5}`
    // Task 92: channel ab tenant ki shop-categories list se validate hota hai (case-insensitive) —
    // list mein nahi to GENERAL fallback
    const resolvedChannel = await resolveShopChannel(tenantId, channel)

    const outlet = await db.outlet.create({
      data: {
        code,
        name: String(name).trim(),
        ownerName: String(ownerName).trim(),
        phone: String(ownerPhone).trim(),
        address: String(address).trim(),
        city: (city ?? '').trim() || 'Lahore',
        channel: resolvedChannel,
        lat: latN,
        lng: lngN,
        ntn: (ntn ?? '').trim() || null,
        cnic: (cnic ?? '').trim() || null,
        filerStatus: (ntn ?? '').trim() ? 'FILER' : 'NON_FILER',
        distributorId: tenantId,
        salesmanId: user.id,
        // Task 85: booker-tagged shop — admin approve kare tab active hogi
        status: 'PENDING',
        clientRef: ref || null,
        taggedByName: user.name,
      },
    })

    return Response.json({
      outlet: { id: outlet.id, code: outlet.code, name: outlet.name, status: outlet.status },
      message: 'Shop tag ho gayi — admin approval ke baad route aur orders mein nazar aayegi',
    })
  } catch (e) {
    console.error(e)
    return jsonError('Shop tag failed', 500)
  }
}
