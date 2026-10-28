import { Prisma, PrismaClient } from '@prisma/client'
import { db } from '@/lib/db'

// ============================================================
// Task 100 — UNIQUE 4-DIGIT SHOP CODE ("code4")
// Har shop ka apna chhota code ("1001".."9999") — wasooli list,
// route sheet print aur OB recovery report par asaan reference.
//  • Sequential: max existing + 1 (min 1001) — gaps par koi masla nahi
//  • Collision-safe: unique constraint par P2002 aaye to retry (concurrent
//    creates — web + booker app + bulk import ek sath chalein to bhi safe)
//  • Legacy: code4 null reh sakta hai — pehli list load par lazy backfill
//    (ensureCode4Backfill) sab purani shops ko code de deta hai
// ============================================================

export const CODE4_MIN = 1001
export const CODE4_MAX = 9999

/** number -> 4-digit string ("1001") */
export function padCode4(n: number): string {
  return String(Math.trunc(n)).padStart(4, '0')
}

/** "1010" -> 1010 | null (khali/galat code par) */
export function parseCode4(code: string | null | undefined): number | null {
  if (!code || !/^\d{4}$/.test(code)) return null
  const n = parseInt(code, 10)
  return Number.isFinite(n) ? n : null
}

type DbLike = Prisma.TransactionClient | PrismaClient

/**
 * Ab tak ka sab se bara 4-digit code (numeric). Tx ya db dono chalein —
 * batch/import apne transaction ke andar ek hi call se start le kar
 * local counter bump karta hai (har row par query nahi).
 */
export async function currentMaxCode4(tx: DbLike): Promise<number> {
  const agg = await tx.outlet.aggregate({ _max: { code4: true } })
  return parseCode4(agg._max.code4) ?? CODE4_MIN - 1
}

// ---------- Lazy production backfill (legacy outlets — code4 null) ----------

let backfillPromise: Promise<void> | null = null

/**
 * Pehli list load par sab legacy shops ko unique code4 assign (once per
 * server instance; pehle se assigned ho to sirf 1 sasta findMany lagta hai).
 * Serverless instances ek sath chalen to bhi P2002-retry se codes unique rehte hain.
 */
export function ensureCode4Backfill(): Promise<void> {
  if (!backfillPromise) {
    backfillPromise = runCode4Backfill().catch((e) => {
      console.error('[code4] lazy backfill failed — agli request par dobara', e)
      backfillPromise = null
    })
  }
  return backfillPromise
}

async function runCode4Backfill(): Promise<void> {
  const pending = await db.outlet.findMany({
    where: { code4: null },
    select: { id: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: 2000,
  })
  if (pending.length === 0) return
  let next = (await currentMaxCode4(db)) + 1
  for (const o of pending) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (next > CODE4_MAX) {
        console.error('[code4] range exhaust (1001-9999) — baqi shops ka backfill adhoora')
        return
      }
      const candidate = padCode4(next)
      next += 1
      try {
        await db.outlet.update({ where: { id: o.id }, data: { code4: candidate } })
        break
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
  }
}
