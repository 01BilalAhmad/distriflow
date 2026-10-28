/**
 * Task 100 — CODE4 BACKFILL (one-time, re-runnable safe)
 *
 * Har shop ko unique 4-digit code deta hai ("1001".."9999"):
 *  1. code4 = null wali sab outlets (createdAt + id order mein)
 *  2. Start = max existing code4 + 1 (warna 1001)
 *  3. Sequential assign — P2002 (rare race) par code bump kar k retry
 *
 * NOTE: app ke andar ye backfill LAZY bhi hota hai (src/lib/dms-code4.ts —
 * ensureCode4Backfill, pehli recovery/outlets list load par). Ye script sirf
 * manual/one-shot ke liye hai — chalana zaroori nahi.
 *
 * Run:  DATABASE_URL="postgresql://..." npx tsx prisma/backfill-code4.ts
 * (pehle `npx prisma db push` chuka ho — code4 column mojood hona chahiye)
 *
 * Self-contained rakha gaya hai (koi @/ alias import nahi) taake tsx/node
 * dono se bina build ke chale.
 */
import { Prisma, PrismaClient } from '@prisma/client'

const CODE4_MIN = 1001
const CODE4_MAX = 9999
const pad = (n: number) => String(Math.trunc(n)).padStart(4, '0')
const parse = (c: string | null) => (c && /^\d{4}$/.test(c) ? parseInt(c, 10) : null)

const db = new PrismaClient()

async function main() {
  const pending = await db.outlet.findMany({
    where: { code4: null },
    select: { id: true, code: true, name: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })

  if (pending.length === 0) {
    console.log('CODE4 backfill: sab shops ka code4 already assigned — kuch nahi karna')
    return
  }

  const maxAgg = await db.outlet.aggregate({ _max: { code4: true } })
  let next = (parse(maxAgg._max.code4) ?? CODE4_MIN - 1) + 1
  const taken = new Set<string>()
  let done = 0
  const start = next

  for (const o of pending) {
    let code4 = ''
    // 9999 tak guard — range exhaust ho to clear error (aadi haalat mein shops < 1000)
    for (let attempt = 0; attempt < 50; attempt++) {
      if (next > CODE4_MAX) throw new Error(`CODE4 range (1001-${CODE4_MAX}) exhaust ho gayi — ${pending.length - done} shops baqi hain`)
      const candidate = pad(next)
      next += 1
      if (taken.has(candidate)) continue
      try {
        await db.outlet.update({ where: { id: o.id }, data: { code4: candidate } })
        code4 = candidate
        break
      } catch (e) {
        // P2002 unique violation (race) — agla code try karo
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue
        throw e
      }
    }
    if (!code4) throw new Error(`Shop ${o.code} (${o.name}) ko code4 assign nahi hua`)
    taken.add(code4)
    done += 1
    if (done % 200 === 0) console.log(`  ... ${done}/${pending.length} assigned`)
  }

  console.log(`CODE4 backfill mukammal: ${done} shops — codes ${pad(start)} se ${pad(start + done - 1)} tak`)
}

main()
  .catch((e) => { console.error('CODE4 backfill failed:', e); process.exit(1) })
  .finally(() => db.$disconnect())
