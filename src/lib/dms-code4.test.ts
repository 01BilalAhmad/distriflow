import { describe, it, expect } from 'vitest'
import { padCode4, parseCode4, CODE4_MIN, CODE4_MAX } from './dms-code4'

// Task 100 — unique 4-digit shop code helpers

describe('padCode4', () => {
  it('4-digit string banata hai', () => {
    expect(padCode4(1)).toBe('0001')
    expect(padCode4(1001)).toBe('1001')
    expect(padCode4(9999)).toBe('9999')
  })

  it('pehle se 4-digit number ko waisa hi rakhta hai', () => {
    expect(padCode4(1234)).toBe('1234')
  })
})

describe('parseCode4', () => {
  it('sahi 4-digit code parse karta hai', () => {
    expect(parseCode4('1001')).toBe(1001)
    expect(parseCode4('0001')).toBe(1)
  })

  it('galat/khali code par null deta hai', () => {
    expect(parseCode4(null)).toBeNull()
    expect(parseCode4('')).toBeNull()
    expect(parseCode4('123')).toBeNull() // 3 digit
    expect(parseCode4('12345')).toBeNull() // 5 digit
    expect(parseCode4('12a4')).toBeNull()
  })
})

describe('code4 range', () => {
  it('1001 se 9999 tak — 8999 slots', () => {
    expect(CODE4_MIN).toBe(1001)
    expect(CODE4_MAX).toBe(9999)
  })
})
