import { describe, expect, it } from 'vitest'
import { maintenanceMessage, resolveMaintenance } from './maintenance-core'

/**
 * Task 127 — maintenance gate unit tests (pure core, DB-free).
 * Cover: no flags, global-only, user-only, both active (soonest wins),
 * expired flags, MEGA_ADMIN bypass, message shape.
 */

const FUTURE = new Date(Date.now() + 60 * 60 * 1000) // +1h
const SOONER = new Date(Date.now() + 10 * 60 * 1000) // +10m
const PAST = new Date(Date.now() - 60 * 1000) // -1m

describe('resolveMaintenance', () => {
  it('no flags → null (allow)', () => {
    expect(resolveMaintenance({ role: 'DISTRIBUTOR' }, null)).toBeNull()
    expect(resolveMaintenance({ role: 'SALESMAN', maintenanceUntil: null }, null)).toBeNull()
  })

  it('global active → blocked with global note', () => {
    const s = resolveMaintenance({ role: 'DISTRIBUTOR' }, { until: FUTURE, note: 'DB migration' })
    expect(s).not.toBeNull()
    expect(s!.active).toBe(true)
    expect(s!.note).toBe('DB migration')
    expect(s!.until!.getTime()).toBe(FUTURE.getTime())
  })

  it('user-only active → blocked with user note', () => {
    const s = resolveMaintenance({ role: 'DISTRIBUTOR', maintenanceUntil: FUTURE, maintenanceNote: 'Payment review' }, null)
    expect(s).not.toBeNull()
    expect(s!.note).toBe('Payment review')
  })

  it('both active → soonest until wins (user pe wapis aa sakta hai)', () => {
    const s = resolveMaintenance(
      { role: 'DISTRIBUTOR', maintenanceUntil: SOONER, maintenanceNote: 'short pause' },
      { until: FUTURE, note: 'global' },
    )
    expect(s!.until!.getTime()).toBe(SOONER.getTime())
    expect(s!.note).toBe('short pause')
  })

  it('expired flags → allow (global expired, user expired)', () => {
    expect(resolveMaintenance({ role: 'DISTRIBUTOR' }, { until: PAST, note: 'old' })).toBeNull()
    expect(resolveMaintenance({ role: 'DISTRIBUTOR', maintenanceUntil: PAST }, null)).toBeNull()
  })

  it('MEGA_ADMIN kabhi block nahi hota — global active ho tab bhi', () => {
    expect(resolveMaintenance({ role: 'MEGA_ADMIN' }, { until: FUTURE, note: 'x' })).toBeNull()
    expect(resolveMaintenance({ role: 'MEGA_ADMIN', maintenanceUntil: FUTURE }, { until: FUTURE })).toBeNull()
  })

  it('garbage/unparsable until → treat as inactive', () => {
    expect(resolveMaintenance({ role: 'DISTRIBUTOR', maintenanceUntil: 'not-a-date' }, null)).toBeNull()
  })
})

describe('maintenanceMessage', () => {
  it('until + note dono include hote hain, data-safe line ke sath', () => {
    const msg = maintenanceMessage({ active: true, until: FUTURE, note: 'Upgrading DB' })
    expect(msg).toContain('under scheduled maintenance until')
    expect(msg).toContain('Upgrading DB')
    expect(msg).toContain('PKT')
    expect(msg).toContain('stored on your device')
  })

  it('note ke baghair clean message', () => {
    const msg = maintenanceMessage({ active: true, until: null, note: null })
    expect(msg).toContain('System is under maintenance')
    expect(msg).not.toContain('undefined')
    expect(msg).not.toContain('null')
  })
})
