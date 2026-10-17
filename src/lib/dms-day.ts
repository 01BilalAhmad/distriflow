/**
 * Task 82: DAY/TIME helpers — PURE (client + server dono use kar sakte, no db import).
 * Din hamesha Asia/Karachi hisaab se — booker app foreign-timezone device par bhi
 * sahi route dikhaye (browser local time nahi).
 */

/** Karachi date string YYYY-MM-DD (en-CA calendar order deta hai) */
export function karachiDateStr(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(d)
}

/** Aaj ka day code — MON | TUE | WED | THU | FRI | SAT | SUN (Karachi timezone) */
export function karachiDayCode(d: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', weekday: 'short' }).format(d).toUpperCase()
}

/** Aaj ke Karachi din ke UTC bounds — orderDate/route filters isi se */
export function karachiDayBounds(d: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(`${karachiDateStr(d)}T00:00:00+05:00`)
  const end = new Date(start.getTime() + 24 * 3600 * 1000)
  return { start, end }
}

/** visitDays "MON,WED" | '' (empty = har roz) — din match karta hai? */
export function dayMatches(visitDays: string | null | undefined, code: string): boolean {
  const days = (visitDays ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  return days.length === 0 || days.includes(code)
}

/** Kya ye outlet aaj booker ki ROUTE mein hai? (assigned + din match) */
export function outletInTodayRoute(outlet: { salesmanId: string | null; visitDays: string | null }, salesmanId: string, dayCode: string): boolean {
  return outlet.salesmanId === salesmanId && dayMatches(outlet.visitDays, dayCode)
}

/** Kya ye timestamp aaj (Karachi) ka hai? — client-side "sirf aaj ka data" filters isi se */
export function isSameKarachiDay(a: Date | string, b: Date = new Date()): boolean {
  return karachiDateStr(new Date(a)) === karachiDateStr(b)
}
