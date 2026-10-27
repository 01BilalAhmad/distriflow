import { describe, it, expect } from 'vitest'
import { roundDownTo, agingBucket, oldestUnpaidDays, filterSortShops } from './dms-recovery-ui'
import type { RecoveryShopDTO } from './dms-types'

describe('roundDownTo — wasooli quick chips (round DOWN, kabhi over nahi)', () => {
  it('paise wale amount ko 100 par down round karta hai', () => {
    expect(roundDownTo(206308.36, 100)).toBe(206300)
    expect(roundDownTo(4978.92, 100)).toBe(4900)
  })

  it('1000 step par down round karta hai', () => {
    expect(roundDownTo(206308.36, 1000)).toBe(206000)
    expect(roundDownTo(109307.83, 1000)).toBe(109000)
  })

  it('exact multiple par change nahi karta', () => {
    expect(roundDownTo(5000, 100)).toBe(5000)
    expect(roundDownTo(5000, 1000)).toBe(5000)
  })

  it('step se chota amount -> 0 (chip disable hona chahiye)', () => {
    expect(roundDownTo(97.5, 100)).toBe(0)
    expect(roundDownTo(0.99, 100)).toBe(0)
  })

  it('invalid inputs par 0 — kabhi negative/NaN nahi', () => {
    expect(roundDownTo(0, 100)).toBe(0)
    expect(roundDownTo(-500, 100)).toBe(0)
    expect(roundDownTo(NaN, 100)).toBe(0)
    expect(roundDownTo(1000, 0)).toBe(0)
  })
})

describe('agingBucket — udhaar umar buckets', () => {
  it('30 se kam = fresh (naya)', () => {
    expect(agingBucket(0).tone).toBe('fresh')
    expect(agingBucket(15).tone).toBe('fresh')
    expect(agingBucket(29).tone).toBe('fresh')
  })

  it('30-59 = warn, 60-89 = hot, 90+ = critical', () => {
    expect(agingBucket(30).tone).toBe('warn')
    expect(agingBucket(59).tone).toBe('warn')
    expect(agingBucket(60).tone).toBe('hot')
    expect(agingBucket(89).tone).toBe('hot')
    expect(agingBucket(90).tone).toBe('critical')
    expect(agingBucket(365).tone).toBe('critical')
  })

  it('labels business-friendly hain', () => {
    expect(agingBucket(45).label).toBe('30+ din')
    expect(agingBucket(75).label).toBe('60+ din')
    expect(agingBucket(120).label).toBe('90+ din')
    expect(agingBucket(0).label).toBe('Naya')
  })

  it('negative/garbage input crash nahi karta', () => {
    expect(agingBucket(-5).tone).toBe('fresh')
    expect(agingBucket(NaN).tone).toBe('fresh')
  })
})

describe('oldestUnpaidDays — FIFO waterfall aging', () => {
  const d = (offsetDays: number, base = new Date('2026-10-27T12:00:00Z')) =>
    new Date(base.getTime() - offsetDays * 86400000)

  it('unpaid invoice ki umar dekhta hai', () => {
    const now = d(0)
    const entries = [
      { date: d(95), type: 'DEBIT', amount: 10000 }, // purana udhaar
      { date: d(10), type: 'DEBIT', amount: 5000 },
    ]
    expect(oldestUnpaidDays(entries, now)).toBe(95)
  })

  it('partial payment par oldest outstanding date rehti hai', () => {
    const now = d(0)
    const entries = [
      { date: d(95), type: 'DEBIT', amount: 10000 },
      { date: d(20), type: 'CREDIT', amount: 4000 }, // partial — 6000 abhi bhi 95 din purana
    ]
    expect(oldestUnpaidDays(entries, now)).toBe(95)
  })

  it('full payment ke baad naya debit -> aging reset ho jata hai', () => {
    const now = d(0)
    const entries = [
      { date: d(95), type: 'DEBIT', amount: 10000 },
      { date: d(40), type: 'CREDIT', amount: 10000 }, // poora clear — 40 din pehle
      { date: d(10), type: 'DEBIT', amount: 3000 }, // naya udhaar — 10 din ka
    ]
    expect(oldestUnpaidDays(entries, now)).toBe(10)
  })

  it('advance (credit > debit) par koi aging nahi', () => {
    const now = d(0)
    const entries = [
      { date: d(50), type: 'DEBIT', amount: 5000 },
      { date: d(30), type: 'CREDIT', amount: 8000 }, // advance ban gaya
    ]
    expect(oldestUnpaidDays(entries, now)).toBe(0)
  })

  it('empty ledger -> 0', () => {
    expect(oldestUnpaidDays([], d(0))).toBe(0)
  })

  it('out-of-order dates bhi theek handle hote hain (sort internal)', () => {
    const now = d(0)
    const entries = [
      { date: d(10), type: 'DEBIT', amount: 2000 },
      { date: d(90), type: 'DEBIT', amount: 8000 },
    ]
    expect(oldestUnpaidDays(entries, now)).toBe(90)
  })
})

describe('filterSortShops — route sheet search + sort', () => {
  const mk = (name: string, code: string, city: string, balance: number, age = 0): RecoveryShopDTO & { udhaarAgeDays: number } => ({
    outletId: code, name, code, city, channel: 'GS', balance, visitDays: '', udhaarAgeDays: age,
  })
  const shops = [
    mk('AL-MAKKAH SWEETS', 'OUT-002', 'Lahore', 109307.83, 35),
    mk('Mega Mart', 'OUT-003', 'KhanPur', 61363.21, 95),
    mk('Spot Sale', 'OUT-001', 'Lahore', 206308.36, 5),
    mk('Irfan K/s', 'OUT-004', 'Lahore', 4978.92, 65),
  ]

  it('default amount-desc: bara udhaar pehle', () => {
    const out = filterSortShops(shops, '', 'amount-desc')
    expect(out.map((s) => s.name)).toEqual(['Spot Sale', 'AL-MAKKAH SWEETS', 'Mega Mart', 'Irfan K/s'])
  })

  it('name-asc alphabetical', () => {
    const out = filterSortShops(shops, '', 'name-asc')
    expect(out[0].name).toBe('AL-MAKKAH SWEETS')
    expect(out[3].name).toBe('Spot Sale')
  })

  it('age-desc: purana udhaar pehle, tie par bara amount pehle', () => {
    const out = filterSortShops(shops, '', 'age-desc')
    expect(out.map((s) => s.name)[0]).toBe('Mega Mart') // 95 din
    expect(out.map((s) => s.name)[1]).toBe('Irfan K/s') // 65 din
  })

  it('query se name/city/code filter hota hai', () => {
    expect(filterSortShops(shops, 'makka', 'amount-desc').map((s) => s.name)).toEqual(['AL-MAKKAH SWEETS'])
    expect(filterSortShops(shops, 'khanpur', 'amount-desc').map((s) => s.name)).toEqual(['Mega Mart'])
    expect(filterSortShops(shops, 'OUT-001', 'amount-desc').map((s) => s.name)).toEqual(['Spot Sale'])
  })

  it('koi match nahi -> empty array (crash nahi)', () => {
    expect(filterSortShops(shops, 'zzz-not-there', 'amount-desc')).toEqual([])
  })

  it('original array mutate nahi karta', () => {
    const before = [...shops].map((s) => s.name)
    filterSortShops(shops, '', 'name-asc')
    expect(shops.map((s) => s.name)).toEqual(before)
  })
})
