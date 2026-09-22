import { db } from '@/lib/db'
import { jsonError, tenantProfileId, distributorTenant } from '@/lib/dms-scope'
import { getTaxRates, getGstSettings, TAX_KEYS, GST_KEYS } from '@/lib/dms-settings'

/** Per-tenant settings (Task 23) — GET ?userId= => us distributor ke apne tax/GST rates */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    const tenantId = userId ? await tenantProfileId(userId) : null
    const [rates, gst] = await Promise.all([getTaxRates(tenantId), getGstSettings(tenantId)])
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Settings load failed', 500)
  }
}

/** Tax settings update — sirf DISTRIBUTOR (mega admin business se door) */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { userId, filerTaxRate, nonFilerTaxRate, gstEnabled, gstRate } = body as {
      userId: string
      filerTaxRate?: number
      nonFilerTaxRate?: number
      gstEnabled?: boolean | number | string
      gstRate?: number
    }
    if (!userId) return jsonError('userId required')

    const user = await db.user.findUnique({ where: { id: userId }, include: { profile: true } })
    if (!user || user.role !== 'DISTRIBUTOR' || !user.profile) {
      return jsonError('Sirf Distributor apni tax settings change kar sakta hai', 403)
    }
    const tenantId = user.profile.id

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
    return Response.json({
      settings: {
        filerTaxRate: rates.filer,
        nonFilerTaxRate: rates.nonFiler,
        gstEnabled: gst.enabled,
        gstRate: gst.rate,
      },
    })
  } catch (e) {
    console.error(e)
    return jsonError('Settings update failed', 500)
  }
}
