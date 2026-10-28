import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { matchShopCategory, readShopCategories } from '@/lib/dms-settings'
import { padCode4, CODE4_MAX } from '@/lib/dms-code4'

// Task 30 — BULK SHOPS IMPORT: Excel/CSV se ek sath saari shops import.
// Rules:
// - name required; duplicate naam (tenant ke andar, case-insensitive) SKIP
// - salesman column optional — naam/email se match; na mile to outlet phir bhi import (warning)
// - channel/filerStatus/visitDays normalize (single-add jaisa hi)
// - code generation single-add wale formula se (count-based), collision par +5 bump

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const

/** "mon,wed,,xyz" -> "MON,WED" (invalid/empty codes drop) */
function sanitizeVisitDays(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const days = raw.split(',').map((d) => d.trim().toUpperCase()).filter((d) => (DAY_CODES as readonly string[]).includes(d))
  return Array.from(new Set(days)).join(',')
}

export async function POST(req: Request) {
  try {
    // Task 95: identity cookie se (pehle body.userId se distributorTenant hota tha — IDOR band)
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor apna catalog manage kar sakta hai', 403)
    if (!me.profile) return jsonError('Distributor profile nahi mila', 404)
    const tenantId = me.profile.id

    const body = await req.json()
    const { rows } = body as { userId?: string; rows?: Record<string, unknown>[] } // userId legacy — IGNORE
    if (!Array.isArray(rows) || rows.length === 0) return jsonError('Import rows khali hain')
    if (rows.length > 500) return jsonError('Ek dafa mein max 500 shops import ho sakti hain')

    // Tenant ke bookers (salesman column match ke liye)
    const profile = await db.distributorProfile.findUnique({ where: { id: tenantId } })
    const salesmen = await db.user.findMany({
      where: { role: 'SALESMAN', parentId: profile?.userId ?? '' },
      select: { id: true, name: true, email: true },
    })

    // Dup-check (tenant scope) + GLOBAL code pool (Outlet.code @unique — cross-tenant bhi collide nahi hona chahiye)
    const existing = await db.outlet.findMany({
      where: { distributorId: tenantId },
      select: { name: true, code: true },
    })
    // Task 92: channel validation ab tenant ki shop-categories list se (case/underscore-insensitive,
    // "Kiryana"/"kiryana"/"KIRYANA" sab match) — list mein nahi to GENERAL fallback
    const shopCats = await readShopCategories(tenantId)
    const allCodes = await db.outlet.findMany({ select: { code: true } })
    const seenNames = new Set(existing.map((o) => o.name.trim().toLowerCase()))
    const usedCodes = new Set(allCodes.map((o) => o.code))
    const baseCount = existing.length

    // Task 100: 4-digit code4 pool — batch ke andar local counter se bump (har row par query nahi)
    const usedCode4 = new Set(
      (await db.outlet.findMany({ where: { code4: { not: null } }, select: { code4: true } })).map((o) => o.code4 as string),
    )
    let nextCode4 = 1001
    const takeCode4 = (): string => {
      while (nextCode4 <= CODE4_MAX) {
        const c = padCode4(nextCode4)
        nextCode4 += 1
        if (!usedCode4.has(c)) { usedCode4.add(c); return c }
      }
      throw new Error(`CODE4 range (1001-${CODE4_MAX}) exhaust ho gayi — 4-digit code batch mein assign nahi ho saka`)
    }

    const skipped: { row: number; name: string; reason: string }[] = []
    const warnings: { row: number; name: string; reason: string }[] = []
    const toCreate: {
      code: string; code4: string; name: string; ownerName: string | null; phone: string | null; address: string | null
      city: string; channel: string; creditDays: number; ntn: string | null; cnic: string | null
      filerStatus: string; visitDays: string; salesmanId: string | null; distributorId: string
    }[] = []

    for (let i = 0; i < rows.length; i++) {
      const raw = rows[i] ?? {}
      const rowNum = i + 1
      const get = (k: string) => {
        const v = raw[k]
        if (v == null) return ''
        return String(v).trim()
      }

      const name = get('name')
      if (!name) {
        skipped.push({ row: rowNum, name: '(bina naam wali line)', reason: 'Shop ka naam nahi likha gaya' })
        continue
      }
      if (seenNames.has(name.toLowerCase())) {
        skipped.push({ row: rowNum, name, reason: 'Ye shop pehle se maujood hai (duplicate naam)' })
        continue
      }
      seenNames.add(name.toLowerCase())

      // Salesman match — naam ya email; na mile to bhi import hogi, sirf warning
      let salesmanId: string | null = null
      const smRaw = get('salesman')
      if (smRaw) {
        const sm = salesmen.find((s) => s.name.toLowerCase() === smRaw.toLowerCase() || s.email.toLowerCase() === smRaw.toLowerCase())
        if (sm) salesmanId = sm.id
        else warnings.push({ row: rowNum, name, reason: `Salesman "${smRaw}" nahi mila — shop bina booker ke import hui` })
      }

      // Channel normalize (Kiryana -> KIRYANA; list mein na mile to GENERAL)
      const channel = matchShopCategory(shopCats, get('channel')) ?? 'GENERAL'

      const ntn = get('ntn')
      const fsRaw = get('filerStatus').toUpperCase()
      const filerStatus = fsRaw === 'FILER' || fsRaw === 'NON_FILER' ? fsRaw : (ntn ? 'FILER' : 'NON_FILER')

      // Unique code — single-add formula + collision bump
      let code = `OUT-${1005 + (baseCount + toCreate.length + 1) * 5}`
      while (usedCodes.has(code)) code = `OUT-${parseInt(code.slice(4), 10) + 5}`
      usedCodes.add(code)

      toCreate.push({
        code,
        code4: takeCode4(),
        name,
        ownerName: get('ownerName') || null,
        phone: get('phone') || null,
        address: get('address') || null,
        city: get('city') || 'Lahore',
        channel,
        creditDays: Math.max(0, Math.floor(Number(get('creditDays')) || 7)),
        ntn: ntn || null,
        cnic: get('cnic') || null,
        filerStatus,
        visitDays: sanitizeVisitDays(get('visitDays')),
        salesmanId,
        distributorId: tenantId,
      })
    }

    const created: { id: string; code: string; code4: string; name: string }[] = []
    await db.$transaction(async (tx) => {
      for (const o of toCreate) {
        const rec = await tx.outlet.create({ data: o })
        created.push({ id: rec.id, code: rec.code, code4: rec.code4 ?? '', name: rec.name })
      }
    })

    return Response.json({ imported: created.length, skipped, warnings, created })
  } catch (e) {
    console.error(e)
    return jsonError('Bulk shops import failed', 500)
  }
}
