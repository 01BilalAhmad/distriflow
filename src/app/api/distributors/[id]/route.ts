import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'

/**
 * Distributor profile edit (Task 21-l, Task 22 update).
 * PATCH /api/distributors/[id]  { userId, name?, businessName?, city?, region?, phone? }
 * id = target USER id (distributor)
 * Scope: har user sirf APNI details edit karta hai (mega admin console accounts manage karta hai,
 * ye business route nahi). Credit limit bhi Mega Admin console ki jagah hai.
 * Email login credential hai — yahan change nahi hota (read-only UI par).
 */

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const { userId, name, businessName, city, region, phone, creditLimit } = body
    if (!userId) return jsonError('userId required')

    const me = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!me) return jsonError('User not found', 404)
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.id !== id) {
      return jsonError('Aap sirf apni hi details edit kar sakte hain', 403)
    }

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
