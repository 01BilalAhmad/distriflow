/**
 * Task 127 — MAINTENANCE MODE (pure logic — DB-free, unit-testable).
 *
 * Do levels:
 *   GLOBAL   — SystemFlag par (backend deploy/migration ke waqt, SAB distributors down)
 *   PER-USER — User.maintenanceUntil (ek distributor temporarily pause, note ke sath)
 *
 * MEGA_ADMIN KABHI block nahi hota — seller ka apna panel hamesha chalta rehta hai
 * (user requirement: "website down ka matlab sirf distributor accounts, mega admin
 * wali website chalti rahay").
 *
 * Gate lagne ki jagah:
 *   requireUser()   — har business API (existing sessions bhi turant block)
 *   /api/auth/login — naya login bhi band
 *   /api/auth/session — 503 + maintenance payload (shell maintenance screen dikhata hai)
 *
 * Mobile app (device-first): order phone pe local save hoti rehti hai — maintenance
 * khatam hote hi sync ho jati hai. Data loss ZERO.
 */

export interface MaintenanceState {
  active: boolean
  until: Date | null
  note: string | null
}

/** Gate input — sirf wo fields jo DB user par mojood hain */
export interface MaintenanceSubject {
  role: string
  maintenanceUntil?: Date | string | null
  maintenanceNote?: string | null
}

export interface GlobalFlag {
  until: Date | string | null
  note?: string | null
}

const PKT_FMT = new Intl.DateTimeFormat('en-PK', {
  timeZone: 'Asia/Karachi',
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
})

export function fmtPKT(d: Date | string): string {
  return PKT_FMT.format(new Date(d))
}

function toActive(until: Date | string | null | undefined): boolean {
  if (!until) return false
  const t = new Date(until).getTime()
  return Number.isFinite(t) && t > Date.now()
}

/**
 * Resolve block state — null = band nahi (request allow).
 * Global aur per-user mein se jo pehle khatam hoga wahi "effective window" hai
 * (dono active hon to kam-se-strict wala dikhta hai — user jaldi wapis aa sakta hai).
 */
export function resolveMaintenance(subject: MaintenanceSubject, global: GlobalFlag | null): MaintenanceState | null {
  if (subject.role === 'MEGA_ADMIN') return null

  const globalActive = toActive(global?.until ?? null)
  const userActive = toActive(subject.maintenanceUntil)

  if (!globalActive && !userActive) return null

  const candidates: Array<{ until: Date; note: string | null }> = []
  if (globalActive && global?.until) candidates.push({ until: new Date(global.until), note: global?.note ?? null })
  if (userActive && subject.maintenanceUntil) {
    candidates.push({ until: new Date(subject.maintenanceUntil), note: subject.maintenanceNote ?? null })
  }
  candidates.sort((a, b) => a.until.getTime() - b.until.getTime())
  const soonest = candidates[0]
  return { active: true, until: soonest.until, note: soonest.note }
}

/** Professional English (Task 105 standard — app-facing strings English hain) */
export function maintenanceMessage(state: MaintenanceState): string {
  const base = state.until
    ? `System is under scheduled maintenance until ${fmtPKT(state.until)} (PKT)`
    : 'System is under maintenance'
  const tail =
    '. Your data is safe — orders booked on the app are stored on your device and will sync automatically once maintenance ends.'
  return state.note ? `${base} — ${state.note}${tail}` : `${base}${tail}`
}

/** 503 response jo login/session/requireUser sab jagah consistent shape deta hai */
export function maintenanceResponse(state: MaintenanceState): Response {
  return Response.json(
    {
      error: maintenanceMessage(state),
      maintenance: {
        until: state.until ? state.until.toISOString() : null,
        note: state.note,
      },
    },
    { status: 503 },
  )
}
