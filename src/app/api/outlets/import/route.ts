import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'
import { matchShopCategory, readShopCategories } from '@/lib/dms-settings'
import { padCode4, CODE4_MAX } from '@/lib/dms-code4'
import { postLedgerEntry } from '@/lib/dms-credit'
import { openingNote, parseAmountCell, parseDateCell } from '@/lib/dms-outlet-import'
import { audit } from '@/lib/audit'

// Task 30 — BULK SHOPS IMPORT: Excel/CSV se ek sath saari shops import.
// Rules:
// - name required; duplicate naam (tenant ke andar, case-insensitive) SKIP
// - salesman column optional — naam/email se match; na mile to outlet phir bhi import (warning)
// - channel/filerStatus/visitDays normalize (single-add jaisa hi)
// - code generation single-add wale formula se (count-based), collision par +5 bump
// Task 132 — PURANA SOFTWARE MIGRATION: distributor apna local software chhor ke aaye to
// shops ke sath PURANA BALANCE bhi usi sheet se import ho jaye:
// - openingBalance column (optional): "12,500" / "Rs 12,500/-" / "-500" (shop ke haq mein advance)
//   Non-zero par OutletLedger mein DEBIT/CREDIT OPENING entry post hoti hai (postLedgerEntry se —
//   Outlet.balance + ledger list/detail + aging sab isi se consistent rehte hain).
// - openingDate column (optional): balance kis date ka tha (YYYY-MM-DD ya DD/MM/YYYY) —
//   Aging 30/60/90 isi date se bucket banata hai; khali = aaj. Future date reject.
// - creditLimit column (optional): shop ki udhaar had (Rs, 0 = no limit)

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
      creditLimit: number; openingBalance: number; openingDate: Date | null
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

      // Task 132: opening balance + date + credit limit — ghalat cell par POORI row skip
      // (aadhi-imported shop se zyada saaf skip behtar hai; user ko wajah dikhti hai)
      const ob = parseAmountCell(raw['openingBalance'])
      if (!ob.ok) {
        skipped.push({ row: rowNum, name, reason: `Opening Balance: ${ob.reason}` })
        continue
      }
      const od = parseDateCell(raw['openingDate'])
      if (!od.ok) {
        skipped.push({ row: rowNum, name, reason: `Opening Date: ${od.reason}` })
        continue
      }
      if (od.value && od.value.getTime() > Date.now() + 86400000) {
        skipped.push({ row: rowNum, name, reason: 'Opening Date future mein nahi ho sakti — purani date likhein (ya khali chhorein)' })
        continue
      }
      const cl = parseAmountCell(raw['creditLimit'])
      if (!cl.ok) {
        skipped.push({ row: rowNum, name, reason: `Credit Limit: ${cl.reason}` })
        continue
      }

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
        creditLimit: Math.max(0, cl.value),
        openingBalance: ob.value,
        openingDate: od.value,
      })
    }

    const created: { id: string; code: string; code4: string; name: string }[] = []
    let openingPosted = 0
    let openingTotal = 0
    await db.$transaction(async (tx) => {
      for (const o of toCreate) {
        const { openingBalance, openingDate, ...data } = o
        const rec = await tx.outlet.create({ data })
        // Task 132: purana balance real ledger entry banta hai — sirf Outlet.balance set
        // karna ledger list/detail/aging mein kahin nahi dikhta (Task 98 mechanism)
        if (openingBalance !== 0) {
          await postLedgerEntry(tx, {
            outletId: rec.id,
            type: openingBalance > 0 ? 'DEBIT' : 'CREDIT',
            amount: Math.abs(openingBalance),
            refType: 'OPENING',
            refNo: rec.code,
            note: openingNote(openingBalance, 'import'),
            ...(openingDate ? { date: openingDate } : {}),
          })
          openingPosted++
          openingTotal += Math.abs(openingBalance)
        }
        created.push({ id: rec.id, code: rec.code, code4: rec.code4 ?? '', name: rec.name })
      }
    })

    // Task 132: rich labeled audit — generic API_POST ke sath human-readable row
    await audit(
      { id: me.id, name: me.name, role: me.role, tenantId },
      'SHOP_IMPORT',
      {
        req,
        entity: 'Outlet',
        entityId: `${created.length} shops`,
        detail: `${created.length} shops import • ${skipped.length} skip • ${openingPosted} opening balances Rs ${openingTotal.toFixed(0)} • ${warnings.length} warnings`,
      },
    )

    return Response.json({ imported: created.length, skipped, warnings, created, openingPosted, openingTotal: Math.round(openingTotal * 100) / 100 })
  } catch (e) {
    console.error(e)
    return jsonError('Bulk shops import failed', 500)
  }
}
