import { db, type DbClient } from '@/lib/db'
import type { AppSetting } from '@prisma/client'

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

// ============ DISTRIBUTOR PROFILE extras (Task 78) ============
// Address DistributorProfile/User model mein nahi hai — production Neon schema sync risk se
// bachne ke liye AppSetting KV use kiya (tax rates/GST jaisa hi pattern, ZERO migration).

export const PROFILE_KEYS = {
  address: 'distributorAddress',
} as const

/** Distributor ka poora address — bill print header par naam ke neeche (settings page se manage) */
export async function getDistributorAddress(tenantId?: string | null): Promise<string> {
  if (!tenantId) return ''
  const row = await db.appSetting.findUnique({ where: { key_distributorId: { key: PROFILE_KEYS.address, distributorId: tenantId } } })
  return row?.value?.trim() ?? ''
}

/** Settings page save par address upsert (empty string par purani value delete — khali = print par line nahi) */
export async function setDistributorAddress(tenantId: string, address: string) {
  const value = address.trim()
  if (!value) {
    await db.appSetting.deleteMany({ where: { key: PROFILE_KEYS.address, distributorId: tenantId } })
    return
  }
  await db.appSetting.upsert({
    where: { key_distributorId: { key: PROFILE_KEYS.address, distributorId: tenantId } },
    update: { value },
    create: { key: PROFILE_KEYS.address, value, distributorId: tenantId },
  })
}

// ============ SHOP CATEGORIES (Task 92) ============
// Outlet.channel pehle hardcoded 4-value list thi (KIRYANA/SUPERMARKET/WHOLESALE/GENERAL) —
// ab per-tenant editable list hai. Schema change se bachne ke liye AppSetting KV use kiya
// (Task 78 jaisa hi pattern, ZERO migration): value = JSON string[] — Outlet.channel string
// isi naam se match hota hai (Product.category jaisa hi name-based link).

export const SHOP_CATEGORIES_KEY = 'shopCategories'
export const DEFAULT_SHOP_CATEGORIES = ['KIRYANA', 'SUPERMARKET', 'WHOLESALE', 'GENERAL']

/** "pan shop", "PAN-SHOP" -> "PAN_SHOP" — import/tag inputs normalize karne ke liye */
export function normalizeShopChannel(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_')
}

/** List mein case/underscore-insensitive match (KIRYANA == kiryana == Pan Shop/PAN_SHOP nahi) */
export function matchShopCategory(list: string[], raw: unknown): string | null {
  const norm = normalizeShopChannel(raw)
  if (!norm) return null
  return list.find((c) => normalizeShopChannel(c) === norm) ?? null
}

async function readShopCategoriesRow(tenantId: string): Promise<AppSetting | null> {
  return db.appSetting.findUnique({
    where: { key_distributorId: { key: SHOP_CATEGORIES_KEY, distributorId: tenantId } },
  })
}

/** Tenant ki shop categories — setting row na ho to defaults (KIRYANA/SUPERMARKET/WHOLESALE/GENERAL). Seed nahi karta (read-only paths). */
export async function readShopCategories(tenantId: string): Promise<string[]> {
  const row = await readShopCategoriesRow(tenantId)
  if (!row) return [...DEFAULT_SHOP_CATEGORIES]
  try {
    const parsed = JSON.parse(row.value)
    if (Array.isArray(parsed)) {
      const clean = parsed.map((c) => String(c).trim()).filter(Boolean)
      return clean.length > 0 ? clean : [...DEFAULT_SHOP_CATEGORIES]
    }
  } catch { /* corrupt value — defaults */ }
  return [...DEFAULT_SHOP_CATEGORIES]
}

/** List ko save karo (sort: seed defaults pehle, phir A→Z). client pass karo to transaction ke andar chalega. */
export async function writeShopCategories(tenantId: string, categories: string[], client: DbClient = db) {
  const defaults = new Set(DEFAULT_SHOP_CATEGORIES)
  const ordered = [...categories.filter((c) => defaults.has(c)), ...categories.filter((c) => !defaults.has(c)).sort((a, b) => a.localeCompare(b))]
  const value = JSON.stringify(ordered)
  await client.appSetting.upsert({
    where: { key_distributorId: { key: SHOP_CATEGORIES_KEY, distributorId: tenantId } },
    update: { value },
    create: { key: SHOP_CATEGORIES_KEY, value, distributorId: tenantId },
  })
}

/** GET first-run seed — row hi nahi to 4 default categories bana do (idempotent, products jaisa) */
export async function seedShopCategoriesIfAbsent(tenantId: string): Promise<void> {
  const row = await readShopCategoriesRow(tenantId)
  if (!row) await writeShopCategories(tenantId, [...DEFAULT_SHOP_CATEGORIES])
}

/** Write paths (tag/import/approve) ke liye: tenant list validate kar ke canonical naam wapas — na mile to GENERAL */
export async function resolveShopChannel(tenantId: string, raw: unknown): Promise<string> {
  const list = await readShopCategories(tenantId)
  return matchShopCategory(list, raw) ?? 'GENERAL'
}
