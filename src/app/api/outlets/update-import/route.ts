import { db } from '@/lib/db'
import { jsonError, megaBlocked } from '@/lib/dms-scope'
import { requireUser } from '@/lib/api-auth'

// Task 103-c — BULK SHOPS UPDATE IMPORT: MOJOODA shops par NTN / CNIC / Owner / Phone
// mass update (Excel/CSV se). Create-import (/api/outlets/import) duplicate naam SKIP
// karta hai — is liye purani shops ke tax details bharne ka alag update rasta zaroori tha.
// Rules:
// - MATCH: pehle Shop Code — "OUT-1015" ya sirf "1015" dono chalte hain (Outlet.code,
//   tenant ke andar EXACT match); na mile/waapis khali ho to exact naam (case-insensitive).
//   Dono na mile => skipped "Shop nahi mili".
// - SIRF NON-EMPTY cells update hote hain — khali cell = us field par koi tabdeeli nahi.
// - NTN diya => shop FILER ban jati hai (single-add jaisa derive); NTN khali => filer
//   status waisa hi rehta hai (accidental Filer flip band).
// - Naam, balance, booker, channel, visit days, address — KUCH nahi chherey jaate.
// - Validation pehle: phone 10-13 digits, CNIC 13 digits, NTN 7-13 digits (warna row skip).
// - Response BulkImportDialog-compatible: { imported: updatedCount, skipped, warnings }.

const digitsOf = (s: string) => s.replace(/\D/g, '')

export async function POST(req: Request) {
  try {
    const auth = await requireUser(req)
    if ('error' in auth) return auth.error
    const me = auth.user
    const mb = megaBlocked(me.role)
    if (mb) return mb
    if (me.role !== 'DISTRIBUTOR') return jsonError('Sirf Distributor apni shops update kar sakta hai', 403)
    if (!me.profile) return jsonError('Distributor profile nahi mila', 404)
    const tenantId = me.profile.id

    const body = await req.json()
    const { rows } = body as { rows?: Record<string, unknown>[] }
    if (!Array.isArray(rows) || rows.length === 0) return jsonError('Import rows khali hain')
    if (rows.length > 500) return jsonError('Ek dafa mein max 500 shops update ho sakti hain')

    const skipped: { row: number; name: string; reason: string }[] = []
    const warnings: { row: number; name: string; reason: string }[] = []
    const updates: { id: string; data: { ownerName?: string; phone?: string; ntn?: string; cnic?: string; filerStatus?: string }; label: string }[] = []

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 1
      const raw = rows[i] ?? {}
      const get = (k: string) => {
        const v = raw[k]
        if (v == null) return ''
        return String(v).trim()
      }

      const code = get('code')
      const name = get('name')
      const ownerName = get('ownerName')
      const phone = get('phone')
      const ntn = get('ntn')
      const cnic = get('cnic')
      const label = name || code || '(khali line)'

      if (!code && !name) {
        skipped.push({ row: rowNum, name: label, reason: 'Shop Code aur naam dono khali hain' })
        continue
      }
      if (!ownerName && !phone && !ntn && !cnic) {
        skipped.push({ row: rowNum, name: label, reason: 'Owner/Phone/NTN/CNIC sab khali — update karne ke liye kuch nahi' })
        continue
      }
      if (phone && (digitsOf(phone).length < 10 || digitsOf(phone).length > 13)) {
        skipped.push({ row: rowNum, name: label, reason: `Phone ghalat: "${phone}" (10-13 digits hon)` })
        continue
      }
      if (cnic && digitsOf(cnic).length !== 13) {
        skipped.push({ row: rowNum, name: label, reason: `CNIC 13 digits nahi: "${cnic}" (00000-0000000-0)` })
        continue
      }
      if (ntn && (digitsOf(ntn).length < 7 || digitsOf(ntn).length > 13)) {
        skipped.push({ row: rowNum, name: label, reason: `NTN ghalat: "${ntn}" (7-13 digits)` })
        continue
      }

      // Match: Shop Code pehle — "OUT-1015" ya sirf "1015" (EXACT, tenant scope);
      // warna exact naam case-insensitive
      let outlet: { id: string; code: string; name: string } | null = null
      if (code) {
        const m = code.toUpperCase().replace(/\s/g, '').match(/^(?:OUT)?-?(\d+)$/)
        if (m) {
          outlet = await db.outlet.findFirst({
            where: { distributorId: tenantId, code: { equals: `OUT-${m[1]}`, mode: 'insensitive' } },
            select: { id: true, code: true, name: true },
          })
        }
      }
      if (!outlet && name) {
        outlet = await db.outlet.findFirst({
          where: { distributorId: tenantId, name: { equals: name, mode: 'insensitive' } },
          select: { id: true, code: true, name: true },
        })
      }
      if (!outlet) {
        skipped.push({ row: rowNum, name: label, reason: 'Shop nahi mili (code/naam match nahi hua — Shops page se code check karein)' })
        continue
      }

      const data: { ownerName?: string; phone?: string; ntn?: string; cnic?: string; filerStatus?: string } = {}
      if (ownerName) data.ownerName = ownerName
      if (phone) data.phone = phone
      if (cnic) data.cnic = cnic
      if (ntn) {
        data.ntn = ntn
        data.filerStatus = 'FILER' // single-add jaisa derive — NTN wali shop Filer
      }

      if (!code && name && outlet.code) {
        warnings.push({ row: rowNum, name: outlet.name, reason: `Naam se match hua (code ${outlet.code}) — agli dafa Shop Code likhein to match 100% pakka hoga` })
      }
      updates.push({ id: outlet.id, data, label: outlet.name })
    }

    let updated = 0
    await db.$transaction(async (tx) => {
      for (const u of updates) {
        await tx.outlet.update({ where: { id: u.id }, data: u.data })
        updated++
      }
    })

    return Response.json({ imported: updated, skipped, warnings })
  } catch (e) {
    console.error(e)
    return jsonError('Bulk shops update failed', 500)
  }
}
