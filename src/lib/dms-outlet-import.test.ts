import { describe, expect, it } from 'vitest'
import { openingNote, parseAmountCell, parseDateCell } from './dms-outlet-import'

// Task 132 — opening balance import ke pure parsers ka contract test.
// Excel/CSV se aane wale real-world cells: "12,000", "Rs 5000/-", "(500)", serial dates...
describe('parseAmountCell', () => {
  it('plain numbers + numeric cells', () => {
    expect(parseAmountCell(12000)).toEqual({ ok: true, value: 12000 })
    expect(parseAmountCell('12500')).toEqual({ ok: true, value: 12500 })
    expect(parseAmountCell('12.5')).toEqual({ ok: true, value: 12.5 })
    expect(parseAmountCell(1234.567)).toEqual({ ok: true, value: 1234.57 }) // r2
  })

  it('thousand separators + currency prefixes + Pakistani /- suffix', () => {
    expect(parseAmountCell('12,000')).toEqual({ ok: true, value: 12000 })
    expect(parseAmountCell('Rs 12,000')).toEqual({ ok: true, value: 12000 })
    expect(parseAmountCell('Rs. 12500')).toEqual({ ok: true, value: 12500 })
    expect(parseAmountCell('PKR 5,000/-')).toEqual({ ok: true, value: 5000 })
    expect(parseAmountCell('5000/-')).toEqual({ ok: true, value: 5000 })
    expect(parseAmountCell(' 7,500.50 ')).toEqual({ ok: true, value: 7500.5 })
  })

  it('negatives — minus aur accounting parentheses dono (shop ke haq mein advance)', () => {
    expect(parseAmountCell('-500')).toEqual({ ok: true, value: -500 })
    expect(parseAmountCell('(500)')).toEqual({ ok: true, value: -500 })
    expect(parseAmountCell('-1,250.75')).toEqual({ ok: true, value: -1250.75 })
    expect(parseAmountCell('+300')).toEqual({ ok: true, value: 300 })
  })

  it('khali cells = 0 (opening balance optional hai)', () => {
    expect(parseAmountCell(null)).toEqual({ ok: true, value: 0 })
    expect(parseAmountCell(undefined)).toEqual({ ok: true, value: 0 })
    expect(parseAmountCell('')).toEqual({ ok: true, value: 0 })
    expect(parseAmountCell('   ')).toEqual({ ok: true, value: 0 })
  })

  it('ghalat text par clear reason', () => {
    const bad = parseAmountCell('abc')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('abc')
    expect(parseAmountCell('12x00').ok).toBe(false)
    expect(parseAmountCell('12.5.5').ok).toBe(false)
    expect(parseAmountCell('NaN').ok).toBe(false)
  })
})

describe('parseDateCell', () => {
  it('Excel serial numbers (sheet se aate hain, cellDates off)', () => {
    // Excel serial 44927 = 2023-01-01 (1900 system, epoch 1899-12-30)
    const r = parseDateCell(44927)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value && r.value.toISOString()).toBe('2023-01-01T00:00:00.000Z')
    const r2 = parseDateCell(45992) // 2025-12-01 (45292=2024-01-01 + 366(leap) + 334)
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.value && r2.value.toISOString()).toBe('2025-12-01T00:00:00.000Z')
    expect(parseDateCell(100).ok).toBe(false) // 1900 — bahar range
  })

  it('Date instance pass-through', () => {
    const d = new Date('2025-03-10T00:00:00.000Z')
    expect(parseDateCell(d)).toEqual({ ok: true, value: d })
    expect(parseDateCell(new Date('nonsense')).ok).toBe(false)
  })

  it('ISO YYYY-MM-DD (month/day dono order)', () => {
    const r = parseDateCell('2025-01-15')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value && r.value.toISOString()).toBe('2025-01-15T00:00:00.000Z')
    const r2 = parseDateCell('2025/3/5')
    expect(r2.ok).toBe(true)
    if (r2.ok) expect(r2.value && r2.value.toISOString()).toBe('2025-03-05T00:00:00.000Z')
  })

  it('day-first DD/MM/YYYY — Pakistani convention', () => {
    const r = parseDateCell('15/01/2025')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value && r.value.toISOString()).toBe('2025-01-15T00:00:00.000Z')
    expect(parseDateCell('15-01-2025')).toEqual(parseDateCell('15/01/2025'))
    expect(parseDateCell('15.01.2025')).toEqual(parseDateCell('15/01/2025'))
    // 01/02/2025 = 1 Feb (day-first), 2 Jan NAHI
    const feb = parseDateCell('01/02/2025')
    expect(feb.ok).toBe(true)
    if (feb.ok) expect(feb.value && feb.value.toISOString()).toBe('2025-02-01T00:00:00.000Z')
    // 2-digit year
    const short = parseDateCell('15/01/25')
    expect(short.ok).toBe(true)
    if (short.ok) expect(short.value && short.value.toISOString()).toBe('2025-01-15T00:00:00.000Z')
  })

  it('khali = null (caller aaj use kare)', () => {
    expect(parseDateCell(null)).toEqual({ ok: true, value: null })
    expect(parseDateCell('')).toEqual({ ok: true, value: null })
    expect(parseDateCell('  ')).toEqual({ ok: true, value: null })
  })

  it('invalid dates reject — 30/02, mahina 13, garbage', () => {
    expect(parseDateCell('30/02/2025').ok).toBe(false)
    expect(parseDateCell('15/13/2025').ok).toBe(false)
    expect(parseDateCell('abc').ok).toBe(false)
    expect(parseDateCell('2025-02-30').ok).toBe(false)
    const bad = parseDateCell('kuch bhi')
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('YYYY-MM-DD')
  })
})

describe('openingNote', () => {
  it('udhaar vs advance dono directions labeled', () => {
    expect(openingNote(5000, 'import')).toContain('Opening balance')
    expect(openingNote(5000, 'import')).toContain('import')
    expect(openingNote(-500, 'update-import')).toContain('haq mein')
    expect(openingNote(-500, 'update-import')).toContain('update-import')
  })
})
