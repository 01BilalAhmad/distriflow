import { db } from '@/lib/db'
import { jsonError, tenantProfileId } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { getTaxRates, getGstSettings, getDistributorAddress, setDistributorAddress, TAX_KEYS, GST_KEYS } from '@/lib/dms-settings'
import { getPjpSettings, upsertPjpFlag, PJP_KEYS } from '@/lib/dms-pjp'
import { audit } from '@/lib/audit'

/** Per-tenant settings (Task 23) — GET ?userId= => us distributor ke apne tax/GST rates.
 * Task 78: ab profile (distribution name, distributor name, cell, city) bhi — bill print isi se. */
export async function GET(req: Request) {
  try {
    // Task 95: identity cookie se (userId param IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user
    const tenantId = await tenantProfileId(user.id)
    const [rates, gst, address, pjp] = await Promise.all([
      getTaxRates(tenantId),
      getGstSettings(tenantId),
      getDistributorAddress(tenantId),
      getPjpSettings(tenantId),
    ])
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
      // Task 82: PJP auto-route toggles — Jumma OFF day + Unplanned orders
      pjp: {
        fridayOff: pjp.fridayOff,
        unplannedEnabled: pjp.unplannedEnabled,
      },
      // Task 78: distributor profile — Settings page isi se form fill karta hai
      // Task 78b: address bhi (AppSetting KV) — bill header Name → Address → Cell No
      profile: {
        distributorName: user?.name ?? '',
        phone: user?.phone ?? '',
        businessName: user?.profile?.businessName ?? '',
        city: user?.profile?.city ?? '',
        address,
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
    // Task 95: identity cookie se (body userId IGNORE — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const user = auth.user

    const body = await req.json()
    const { filerTaxRate, nonFilerTaxRate, gstEnabled, gstRate, distributorName, phone, businessName, city, address, pjpFridayOff, pjpUnplannedEnabled } = body as {
      userId?: string // legacy — IGNORE
      filerTaxRate?: number
      nonFilerTaxRate?: number
      gstEnabled?: boolean | number | string
      gstRate?: number
      distributorName?: string
      phone?: string
      businessName?: string
      city?: string
      address?: string
      // Task 82: PJP toggles — Jumma OFF day + Unplanned orders
      pjpFridayOff?: boolean | number | string
      pjpUnplannedEnabled?: boolean | number | string
    }
    if (user.role !== 'DISTRIBUTOR' || !user.profile) {
      return jsonError('Sirf Distributor apni settings change kar sakta hai', 403)
    }
    const tenantId = user.profile.id

    // ---- Task 78: profile update (bill print ke naam/cell/city) ----
    const pName = typeof distributorName === 'string' ? distributorName.trim() : undefined
    const pPhone = typeof phone === 'string' ? phone.trim() : undefined
    const pBiz = typeof businessName === 'string' ? businessName.trim() : undefined
    const pCity = typeof city === 'string' ? city.trim() : undefined
    const pAddr = typeof address === 'string' ? address.trim() : undefined
    if (pName !== undefined && !pName) return jsonError('Distributor ka naam khali nahi ho sakta')
    if (pBiz !== undefined && !pBiz) return jsonError('Distribution (business) ka naam khali nahi ho sakta')
    if (pPhone !== undefined && pPhone && !/^[0-9+\-\s()]{7,20}$/.test(pPhone)) {
      return jsonError('Cell number 7-20 digits ka hona chahiye (03001234567 ya +92 300 1234567)')
    }
    if (pAddr !== undefined && pAddr.length > 200) {
      return jsonError('Address 200 characters se zyada na ho')
    }
    // Task 78b: address AppSetting KV mein (zero migration) — khali value purani line hata deta hai
    if (pAddr !== undefined) await setDistributorAddress(tenantId, pAddr)
    if (pName !== undefined || pPhone !== undefined) {
      await db.user.update({
        where: { id: user.id },
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
      // Task 82: PJP toggles (true/1/'1'/'true' => ON)
      const toFlag = (raw: boolean | number | string | undefined): boolean | undefined =>
        raw === undefined || raw === null || raw === '' ? undefined : raw === true || raw === 1 || raw === '1' || raw === 'true'
      const fridayFlag = toFlag(pjpFridayOff)
      const unplannedFlag = toFlag(pjpUnplannedEnabled)
      if (fridayFlag !== undefined) await upsertPjpFlag(tenantId, PJP_KEYS.fridayOff, fridayFlag)
      if (unplannedFlag !== undefined) await upsertPjpFlag(tenantId, PJP_KEYS.unplanned, unplannedFlag)
    } catch (err) {
      return jsonError(err instanceof Error ? err.message : 'Invalid setting')
    }

    const [rates, gst, freshAddr, freshPjp] = await Promise.all([getTaxRates(tenantId), getGstSettings(tenantId), getDistributorAddress(tenantId), getPjpSettings(tenantId)])
    // Task 35: SETTINGS_UPDATE — tax/GST/profile settings badalne ka record
    await audit(
      { id: user.id, name: user.name, role: user.role, tenantId },
      'SETTINGS_UPDATE',
      { req, entity: 'AppSetting', entityId: tenantId, detail: 'Tax/GST/profile settings update huay' },
    )
    const fresh = await db.user.findUnique({ where: { id: user.id }, include: { profile: true } })
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
      pjp: {
        fridayOff: freshPjp.fridayOff,
        unplannedEnabled: freshPjp.unplannedEnabled,
      },
      profile: {
        distributorName: fresh?.name ?? '',
        phone: fresh?.phone ?? '',
        businessName: fresh?.profile?.businessName ?? '',
        city: fresh?.profile?.city ?? '',
        address: freshAddr,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Settings update failed', 500)
  }
}
