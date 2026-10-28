import { describe, it, expect } from 'vitest'
import {
  ledgerDelta,
  creditStatus,
  oldestUnpaid,
  agingBucket,
} from './dms-credit'

/**
 * Task 98 — credit khata math tests. Ye functions har ledger posting,
 * credit-limit warning aur aging report par chalte hain — yahan pin kiya
 * gaya hai: DEBIT/CREDIT sign convention, Finexa creditStatus tiers
 * (0 = no limit, 80% = NEAR, > = OVER), FIFO aging allocation aur buckets.
 */

describe('ledgerDelta — DEBIT/CREDIT sign convention', () => {
  it('DEBIT udhaar barhata hai (+)', () => {
    expect(ledgerDelta('DEBIT', 1000)).toBe(1000)
  })

  it('CREDIT kam karta hai (−)', () => {
    expect(ledgerDelta('CREDIT', 1000)).toBe(-1000)
  })

  it('rounding 2 decimals (r2)', () => {
    expect(ledgerDelta('DEBIT', 100.456)).toBe(100.46)
    expect(ledgerDelta('CREDIT', 50.123)).toBe(-50.12)
  })
})

describe('creditStatus — Finexa convention', () => {
  it('limit 0 = NONE (no limit, koi warning nahi)', () => {
    expect(creditStatus(50000, 0)).toEqual({ status: 'NONE', pct: 0, overBy: 0 })
    expect(creditStatus(50000, -100)).toEqual({ status: 'NONE', pct: 0, overBy: 0 })
  })

  it('OK — 80% se neeche', () => {
    expect(creditStatus(4000, 10000)).toEqual({ status: 'OK', pct: 40, overBy: 0 })
  })

  it('NEAR — 80%+ par (boundary: 80.0 exactly)', () => {
    expect(creditStatus(8000, 10000)).toEqual({ status: 'NEAR', pct: 80, overBy: 0 })
    expect(creditStatus(9500, 10000).status).toBe('NEAR')
  })

  it('OVER — limit cross, overBy kitna extra', () => {
    const s = creditStatus(12000, 10000)
    expect(s.status).toBe('OVER')
    expect(s.overBy).toBe(2000)
    expect(s.pct).toBe(120)
  })

  it('OVER boundary: 100.1% par OVER hi rehta hai', () => {
    expect(creditStatus(10001, 10000).status).toBe('OVER')
  })
})

describe('oldestUnpaid — FIFO aging', () => {
  const day = (n: number) => new Date(Date.UTC(2025, 0, 10 + n)) // Jan 10 + n days
  const now = new Date(Date.UTC(2025, 0, 40)) // Jan 40 = Feb 9

  it('sab clear — CLEAR, days null', () => {
    const r = oldestUnpaid(
      [
        { date: day(0), type: 'DEBIT', amount: 1000 },
        { date: day(2), type: 'CREDIT', amount: 1000 },
      ],
      now,
    )
    expect(r).toEqual({ date: null, days: null, remaining: 0 })
  })

  it('koi debit hi nahi — CLEAR', () => {
    expect(oldestUnpaid([{ date: day(0), type: 'CREDIT', amount: 500 }], now)).toEqual({
      date: null,
      days: null,
      remaining: 0,
    })
  })

  it('partial credit — oldest debit ka bacha hua hissa dikhta hai', () => {
    const r = oldestUnpaid(
      [
        { date: day(0), type: 'DEBIT', amount: 1000 },
        { date: day(5), type: 'CREDIT', amount: 400 },
      ],
      now,
    )
    expect(r.remaining).toBe(600)
    expect(r.days).toBe(30) // Jan 10 → Feb 9
  })

  it('credits oldest debit pehle khate hain — FIFO order', () => {
    // Debit1 (purana) 1000, Debit2 (naya) 500; Credit 1200 → Debit1 full clear,
    // Debit2 se 300 bacha. Oldest unpaid ab Debit2 hai.
    const r = oldestUnpaid(
      [
        { date: day(0), type: 'DEBIT', amount: 1000 },
        { date: day(10), type: 'DEBIT', amount: 500 },
        { date: day(5), type: 'CREDIT', amount: 1200 },
      ],
      now,
    )
    expect(r.date).toBe(day(10).toISOString())
    expect(r.remaining).toBe(300)
    expect(r.days).toBe(20) // Jan 20 → Feb 9
  })

  it('entries order se independent hai (sort internally)', () => {
    const a = oldestUnpaid(
      [
        { date: day(10), type: 'DEBIT', amount: 500 },
        { date: day(0), type: 'DEBIT', amount: 1000 },
        { date: day(5), type: 'CREDIT', amount: 1200 },
      ],
      now,
    )
    const b = oldestUnpaid(
      [
        { date: day(0), type: 'DEBIT', amount: 1000 },
        { date: day(5), type: 'CREDIT', amount: 1200 },
        { date: day(10), type: 'DEBIT', amount: 500 },
      ],
      now,
    )
    expect(a).toEqual(b)
  })

  it('credit debits se zyada ho — queue poori khali (advance → CLEAR)', () => {
    const r = oldestUnpaid(
      [
        { date: day(0), type: 'DEBIT', amount: 500 },
        { date: day(1), type: 'CREDIT', amount: 900 },
      ],
      now,
    )
    expect(r.days).toBeNull()
    expect(r.remaining).toBe(0)
  })
})

describe('agingBucket — report buckets', () => {
  it('null = CLEAR', () => {
    expect(agingBucket(null)).toBe('CLEAR')
  })
  it('0-7 bucket (inclusive 7)', () => {
    expect(agingBucket(0)).toBe('0-7')
    expect(agingBucket(7)).toBe('0-7')
  })
  it('8-15 bucket', () => {
    expect(agingBucket(8)).toBe('8-15')
    expect(agingBucket(15)).toBe('8-15')
  })
  it('16-30 bucket', () => {
    expect(agingBucket(16)).toBe('16-30')
    expect(agingBucket(30)).toBe('16-30')
  })
  it('30+ bucket', () => {
    expect(agingBucket(31)).toBe('30+')
    expect(agingBucket(120)).toBe('30+')
  })
})
