import { db } from '@/lib/db'

/**
 * Per-tenant app settings (Task 23) — har distributor ke apne advance tax rates etc.
 * Advance Tax: shop FILER ho to filer% warna nonFiler% — invoice total par lagta hai
 * aur BILL par ADD hota hai (shop goods total + advance tax pay karti hai).
 */
export const TAX_KEYS = {
  filer: 'filerTaxRate',
  nonFiler: 'nonFilerTaxRate',
} as const

export const DEFAULT_TAX_RATES = { filer: 0.5, nonFiler: 2.5 }

/** tenantId = distributor profile id — har distributor ke apne rates (null => defaults) */
export async function getTaxRates(tenantId?: string | null): Promise<{ filer: number; nonFiler: number }> {
  if (!tenantId) return { ...DEFAULT_TAX_RATES }
  const rows = await db.appSetting.findMany({ where: { key: { in: [TAX_KEYS.filer, TAX_KEYS.nonFiler] }, distributorId: tenantId } })
  const map = new Map(rows.map((r) => [r.key, Number(r.value)]))
  const pick = (k: string, dflt: number) => {
    const v = map.get(k)
    return v != null && Number.isFinite(v) && v >= 0 ? v : dflt
  }
  return { filer: pick(TAX_KEYS.filer, DEFAULT_TAX_RATES.filer), nonFiler: pick(TAX_KEYS.nonFiler, DEFAULT_TAX_RATES.nonFiler) }
}

/** Order/invoice total par advance tax compute (snapshot ke liye) */
export function advanceTaxFor(total: number, filerStatus: string | null | undefined, rates: { filer: number; nonFiler: number }) {
  const rate = filerStatus === 'FILER' ? rates.filer : rates.nonFiler
  return { rate, amount: Math.round(total * rate / 100 * 100) / 100 }
}

// ============ GST (sales tax) — bill print ke liye on/off + rate ============

export const GST_KEYS = {
  enabled: 'gstEnabled',
  rate: 'gstRate',
} as const

export const DEFAULT_GST = { enabled: true, rate: 18 }

export type GstSettings = { enabled: boolean; rate: number }

/** tenantId = distributor profile id — GST bill print har distributor ke apne settings se */
export async function getGstSettings(tenantId?: string | null): Promise<GstSettings> {
  if (!tenantId) return { ...DEFAULT_GST }
  const rows = await db.appSetting.findMany({ where: { key: { in: [GST_KEYS.enabled, GST_KEYS.rate] }, distributorId: tenantId } })
  const map = new Map(rows.map((r) => [r.key, r.value]))
  const enabledRaw = map.get(GST_KEYS.enabled)
  const enabled = enabledRaw == null || enabledRaw === '' ? DEFAULT_GST.enabled : enabledRaw === '1' || enabledRaw === 'true'
  const rateNum = Number(map.get(GST_KEYS.rate))
  const rate = Number.isFinite(rateNum) && rateNum >= 0 && rateNum <= 100 ? rateNum : DEFAULT_GST.rate
  return { enabled, rate }
}
