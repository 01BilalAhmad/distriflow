import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

/**
 * Distributor profile edit (Task 21-l, Task 22 update).
 * PATCH /api/distributors/[id]  { name?, businessName?, city?, region?, phone? }
 * id = target USER id (distributor)
 * Scope: har user sirf APNI details edit karta hai (mega admin console accounts manage karta hai,
 * ye business route nahi). Credit limit bhi Mega Admin console ki jagah hai.
 * Email login credential hai — yahan change nahi hota (read-only UI par).
 * Task 95: identity cookie se (body userId IGNORE — IDOR band).
 */

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // Task 95: identity cookie se — caller hamesha login user (koi bhi kisi aur ki details nahi chhed sakta)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.id !== id) {
      return jsonError('Aap sirf apni hi details edit kar sakte hain', 403)
    }

    const body = await req.json()
    const { name, businessName, city, region, phone, creditLimit } = body

    const target = await db.user.findUnique({ where: { id }, include: { profile: true } })
    if (!target) return jsonError('Distributor nahi mila', 404)
    if (target.role !== 'DISTRIBUTOR') {
      return jsonError('Sirf distributor ki details edit hoti hain', 400)
    }

    const userData: { name?: string; phone?: string | null; region?: string | null } = {}
    const profileData: { businessName?: string; city?: string; region?: string; creditLimit?: number } = {}

    if (name !== undefined) {
      if (!name.trim()) return jsonError('Naam khali nahi ho sakta')
      userData.name = name.trim()
    }
    if (phone !== undefined) userData.phone = phone?.trim() || null
    if (region !== undefined) {
      const r = region?.trim() || null
      userData.region = r
      // profile.region bhi sync rakhte hain taake kahin purani region na dikhe
      profileData.region = r ?? ''
    }
    if (businessName !== undefined) {
      if (!businessName.trim()) return jsonError('Business name khali nahi ho sakta')
      profileData.businessName = businessName.trim()
    }
    if (city !== undefined) {
      if (!city.trim()) return jsonError('City khali nahi ho sakti')
      profileData.city = city.trim()
    }
    if (creditLimit !== undefined) {
      return jsonError('Credit limit ab Mega Admin console se manage hoti hai', 403)
    }

    const user = await db.user.update({
      where: { id },
      data: userData,
      include: { profile: true },
    })
    const profile = Object.keys(profileData).length > 0
      ? await db.distributorProfile.update({ where: { userId: id }, data: profileData })
      : target.profile

    return Response.json({
      node: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        region: user.region,
        phone: user.phone,
        businessName: profile?.businessName,
        city: profile?.city,
        creditLimit: profile?.creditLimit,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Distributor update failed', 500)
  }
}
