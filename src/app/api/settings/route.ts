import { db } from '@/lib/db'
import { jsonError, tenantProfileId, distributorTenant } from '@/lib/dms-scope'
import { getTaxRates, getGstSettings, TAX_KEYS, GST_KEYS } from '@/lib/dms-settings'

/** Per-tenant settings (Task 23) — GET ?userId= => us distributor ke apne tax/GST rates.
 * Task 78: ab profile (distribution name, distributor name, cell, city) bhi — bill print isi se. */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const tenantId = userId ? await tenantProfileId(userId) : null
    const [rates, gst, user] = await Promise.all([
      getTaxRates(tenantId),
      getGstSettings(tenantId),
      userId
        ? db.user.findUnique({ where: { id: userId }, include: { profile: true } })
        : null,
    ])
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
      // Task 78: distributor profile — Settings page isi se form fill karta hai
      profile: {
        distributorName: user?.name ?? '',
        phone: user?.phone ?? '',
        businessName: user?.profile?.businessName ?? '',
        city: user?.profile?.city ?? '',
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Settings load failed', 500)
  }
}

/** Tax settings update — sirf DISTRIBUTOR (mega admin business se door).
 * Task 78: profile fields (distributorName/phone → User, businessName/city → DistributorProfile)
 * bhi isi PUT se update hote hain — ye hi fields bill print par chapte hain. */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { userId, filerTaxRate, nonFilerTaxRate, gstEnabled, gstRate, distributorName, phone, businessName, city } = body as {
      userId: string
      filerTaxRate?: number
      nonFilerTaxRate?: number
      gstEnabled?: boolean | number | string
      gstRate?: number
      distributorName?: string
      phone?: string
      businessName?: string
      city?: string
    }
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user || user.role !== 'DISTRIBUTOR' || !user.profile) {
      return jsonError('Sirf Distributor apni settings change kar sakta hai', 403)
    }
    const tenantId = user.profile.id

    // ---- Task 78: profile update (bill print ke naam/cell/city) ----
    const pName = typeof distributorName === 'string' ? distributorName.trim() : undefined
    const pPhone = typeof phone === 'string' ? phone.trim() : undefined
    const pBiz = typeof businessName === 'string' ? businessName.trim() : undefined
    const pCity = typeof city === 'string' ? city.trim() : undefined
    if (pName !== undefined && !pName) return jsonError('Distributor ka naam khali nahi ho sakta')
    if (pBiz !== undefined && !pBiz) return jsonError('Distribution (business) ka naam khali nahi ho sakta')
    if (pPhone !== undefined && pPhone && !/^[0-9+\-\s()]{7,20}$/.test(pPhone)) {
      return jsonError('Cell number 7-20 digits ka hona chahiye (03001234567 ya +92 300 1234567)')
    }
    if (pName !== undefined || pPhone !== undefined) {
      await db.user.update({
        where: { id: userId },
        data: {
          ...(pName !== undefined ? { name: pName } : {}),
          ...(pPhone !== undefined ? { phone: pPhone || null } : {}),
        },
      })
    }
    if ((pBiz !== undefined || pCity !== undefined) && user.profile) {
      await db.distributorProfile.update({
        where: { id: tenantId },
        data: {
          ...(pBiz !== undefined ? { businessName: pBiz } : {}),
          ...(pCity !== undefined ? { city: pCity } : {}),
        },
      })
    }

    const upsertRate = async (key: string, raw: unknown) => {
      if (raw === undefined || raw === null || raw === '') return
      const v = Number(raw)
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new Error(`${key} 0-100 ke beech hona chahiye`)
      await db.appSetting.upsert({
        where: { key_distributorId: { key, distributorId: tenantId } },
        update: { value: String(v) },
        create: { key, value: String(v), distributorId: tenantId },
      })
    }
    const upsertFlag = async (raw: unknown) => {
      if (raw === undefined || raw === null || raw === '') return
      const on = raw === true || raw === 1 || raw === '1' || raw === 'true'
      await db.appSetting.upsert({
        where: { key_distributorId: { key: GST_KEYS.enabled, distributorId: tenantId } },
        update: { value: on ? '1' : '0' },
        create: { key: GST_KEYS.enabled, value: on ? '1' : '0', distributorId: tenantId },
      })
    }
    try {
      await upsertRate(TAX_KEYS.filer, filerTaxRate)
      await upsertRate(TAX_KEYS.nonFiler, nonFilerTaxRate)
      await upsertFlag(gstEnabled)
      await upsertRate(GST_KEYS.rate, gstRate)
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Invalid setting')
    }

    const [rates, gst] = await Promise.all([getTaxRates(tenantId), getGstSettings(tenantId)])
    const fresh = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
      profile: {
        distributorName: fresh?.name ?? '',
        phone: fresh?.phone ?? '',
        businessName: fresh?.profile?.businessName ?? '',
        city: fresh?.profile?.city ?? '',
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Settings update failed', 500)
  }
}
