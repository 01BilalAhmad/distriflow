import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * PATCH /api/field-force/[id] — order booker edit (Task 21-n, Task 22 update).
 * Body: { userId (caller), companyId?, name?, phone?, email?, region?, password? }
 * - companyId: DISTRIBUTOR apne booker ko company assign karta hai
 * - name/phone/email/region/password: sirf apne (parentId check) bookers
 * - Email unique hai — duplicate block. Password blank = koi change nahi.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json() as {
      userId?: string
      companyId?: string | null
      name?: string
      phone?: string
      email?: string
      region?: string
      password?: string
    }
    if (!body.userId) return jsonError('userId required hai')

    const caller = await db.user.findUnique({ where: { id: body.userId }, include: { profile: true } })
    if (!caller) return jsonError('Caller user not found', 404)
    const mb = megaBlocked(caller.role)
    if (mb) return mb
    if (caller.role !== 'DISTRIBUTOR') {
      return jsonError('Permission nahi hai', 403)
    }

    const salesman = await db.user.findUnique({ where: { id } })
    if (!salesman) return jsonError('Salesman not found', 404)
    if (salesman.role !== 'SALESMAN') return jsonError('Ye user salesman nahi hai')

    // sirf apne hi bookers edit kar sakte hain
    if (salesman.parentId !== caller.id) {
      return jsonError('Ye order booker aapka nahi hai', 403)
    }

    const data: {
      companyId?: string | null
      name?: string
      phone?: string | null
      email?: string
      region?: string | null
      password?: string
    } = {}

    // company assign — distributor ka control (booker ko sirf usi company ke products dikhte hain)
    if (body.companyId !== undefined) {
      if (body.companyId) {
        // company caller ke apne tenant ki honi chahiye (Task 23 isolation)
        const co = await db.company.findFirst({ where: { id: body.companyId, distributorId: caller.profile?.id } })
        if (!co) return jsonError('Company nahi mili (ya aap ki nahi hai)', 404)
      }
      data.companyId = body.companyId ?? null
    }

    if (body.name !== undefined) {
      if (!body.name.trim()) return jsonError('Naam khali nahi ho sakta')
      data.name = body.name.trim()
    }
    if (body.phone !== undefined) data.phone = body.phone?.trim() || null
    if (body.region !== undefined) data.region = body.region?.trim() || null
    if (body.email !== undefined) {
      const normEmail = body.email.toLowerCase().trim()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normEmail)) return jsonError('Email ka format sahi nahi hai')
      if (normEmail !== salesman.email) {
        const dup = await db.user.findUnique({ where: { email: normEmail } })
        if (dup) return jsonError('Is email par pehle se koi user maujood hai')
        data.email = normEmail
      }
    }
    if (body.password !== undefined && body.password !== '') {
      if (String(body.password).length < 4) return jsonError('Password kam az kam 4 harf ka ho')
      data.password = String(body.password).trim()
    }

    const updated = await db.user.update({
      where: { id },
      data,
      include: { company: { select: { id: true, name: true, shortCode: true } } },
    })

    return Response.json({
      salesman: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone,
        region: updated.region,
        parentId: updated.parentId,
        companyId: updated.companyId,
        companyName: updated.company?.name ?? null,
        companyShortCode: updated.company?.shortCode ?? null,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Order booker update failed', 500)
  }
}
