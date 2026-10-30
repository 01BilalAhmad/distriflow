import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { getTenantIdForSalesman } from '@/lib/dms-pjp'
import { resolveShopChannel } from '@/lib/dms-settings'
import { currentMaxCode4, padCode4, CODE4_MAX } from '@/lib/dms-code4'
import { Prisma } from '@prisma/client'

/**
 * Task 85 — OFFLINE-FIRST NEW SHOP TAGGING (booker app / web booker portal)
 * POST /api/outlets/tag
 * Body: { clientRef, name, address, city, ownerName, ownerPhone?, cnic, ntn, channel, lat, lng }
 * (userId ab IGNORE — identity signed cookie se aati hai)
 * - SALESMAN only — booker apni nayi shop tag karta hai (mobile offline app ya web portal se)
 * - Task 104: ownerPhone OPTIONAL — user requirement: Name/Address/Owner lazmi,
 *   Phone/CNIC/NTN optional (schema phone String? nullable hai)
 * - GPS LAZMI — location ke bagair shop tag nahi hogi
 * - Shop status = PENDING — admin approve kare tab Outlets/route/orders mein aayegi
 * - Idempotent: same clientRef dobara aaye to wahi outlet wapas (duplicate nahi banti)
 */
export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se — booker apni hi shop tag karta hai (body userId IGNORE)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const mb = megaBlocked(user.role)
    if (mb) return mb
    if (user.role !== 'SALESMAN') return jsonError('Only an order booker can tag a new shop', 403)

    const body = await req.json()
    const { clientRef, name, address, city, ownerName, ownerPhone, cnic, ntn, channel, lat, lng } = body as {
      userId?: string // legacy — IGNORE
      clientRef?: string; name?: string; address?: string; city?: string
      ownerName?: string; ownerPhone?: string; cnic?: string; ntn?: string; channel?: string
      lat?: number; lng?: number
    }
    if (!name || !String(name).trim()) return jsonError('Shop name is required')
    if (!address || !String(address).trim()) return jsonError('Shop address is required')
    if (!ownerName || !String(ownerName).trim()) return jsonError('Owner name is required')

    const tenantId = await getTenantIdForSalesman(user.id)
    if (!tenantId) return jsonError('You are not attached to any distributor', 403)

    // GPS LAZMI — shop jahan tag ki gayi wahan ke coordinates ke bagair entry nahi hogi
    const latN = Number(lat)
    const lngN = Number(lng)
    if (!Number.isFinite(latN) || !Number.isFinite(lngN) || Math.abs(latN) > 90 || Math.abs(lngN) > 180) {
      return jsonError('GPS capture is required — a new shop cannot be tagged without location. Turn location ON and try again')
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

    // Task 100: unique 4-digit shop code — sequential, collision par bump (retry)
    const outletData = {
      code,
      name: String(name).trim(),
      ownerName: String(ownerName).trim(),
      phone: String(ownerPhone ?? '').trim() || null,
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
    }
    const createTagged = (c4: string) => db.outlet.create({ data: { ...outletData, code4: c4 } })
    let code4 = padCode4(Math.min((await currentMaxCode4(db)) + 1, CODE4_MAX))
    let outlet: Awaited<ReturnType<typeof createTagged>> | null = null
    for (let attempt = 0; attempt < 5 && !outlet; attempt++) {
      try {
        outlet = await createTagged(code4)
      } catch (e) {
        const isCode4 = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
          && String((e.meta as { target?: string[] } | null)?.target ?? '').includes('code4')
        if (!isCode4 || attempt === 4) throw e
        code4 = padCode4(Math.min((await currentMaxCode4(db)) + 1, CODE4_MAX))
      }
    }
    if (!outlet) return jsonError('Shop tag failed — code4 range exhausted', 500)

    return Response.json({
      outlet: { id: outlet.id, code: outlet.code, name: outlet.name, status: outlet.status },
      message: 'Shop tagged successfully — it will appear in the route and orders after admin approval',
    })
  } catch (e) {
    console.error(e)
    return jsonError('Shop tag failed', 500)
  }
}
