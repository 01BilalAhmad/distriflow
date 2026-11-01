// Task 132 — SHOP IMPORT + OPENING BALANCE (purana software ka balance migrate karne ke liye)
//
// Distributor apna purana software (MOJO/manual khata) chhor ke DistriFlow par aata hai
// to us ki shops ke sath UNKA PURANA UDHAAR bhi aata hai. Ye helper create-import
// (/api/outlets/import), update-import (/api/outlets/update-import) aur client-side
// preview parser (outlets-view.tsx) — teeno shared use karte hain, taake Excel cell
// ka parsing EK hi jagah ho aur server/client kabhi disagree na karein.
//
// Design rules:
//  - Amount cells forgiving: "12,000" / "Rs 12,000" / "5000/-" / "-500" / "(500)" / 12000
//  - Khali amount = 0 (opening balance optional hai)
//  - Date cells: Excel serial (45992) / Date / "2025-01-15" / "15/01/2025" (day-first,
//    Pakistani convention) / "15-01-2025" / "15.01.2025" / 2-digit year (15/01/25)
//  - Sab kuch PURE functions — DBtouch nahi, unit-test friendly

const r2 = (n: number) => Math.round(n * 100) / 100

export interface ParseOk<T> { ok: true; value: T }
export interface ParseErr { ok: false; reason: string }

/**
 * Excel/CSV amount cell ko number mein badlo.
 * Accept: 12000 | "12,000" | "Rs 12,000" | "Rs. 12000/-" | "5000/-" | "-500" | "(500)" | "12.50"
 * Khali/null/whitespace = 0 (opening balance optional). Ghalat text par { ok: false }.
 */
export function parseAmountCell(raw: unknown): ParseOk<number> | ParseErr {
  if (raw == null) return { ok: true, value: 0 }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, reason: 'Amount number nahi hai' }
    return { ok: true, value: r2(raw) }
  }
  const original = String(raw).trim()
  if (!original) return { ok: true, value: 0 }
  let s = original
  // currency prefixes / Pakistani "/-" suffix
  s = s.replace(/^rs\.?\s*/i, '').replace(/^pkr\.?\s*/i, '').replace(/\/-\s*$/, '').replace(/-\s*\/\s*$/, '')
  s = s.replace(/,/g, '').replace(/\s+/g, '')
  let neg = false
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1) } // accounting negative
  if (s.startsWith('-')) { neg = true; s = s.slice(1) }
  else if (s.startsWith('+')) s = s.slice(1)
  if (!/^\d+(\.\d+)?$/.test(s)) {
    return { ok: false, reason: `"${original}" amount nahi hai — sirf number likhein (jaise 12500, ya advance ke liye -500)` }
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return { ok: false, reason: `"${original}" bohat bara number hai` }
  return { ok: true, value: r2(neg ? -n : n) }
}

// Excel serial date epoch — 1900 date system, leap-year bug ki wajah se 1899-12-30 se count hota hai
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)

function mkUtcDate(y: number, mo: number, d: number): ParseOk<Date> | ParseErr {
  if (mo < 1 || mo > 12) return { ok: false, reason: `Mahina ${mo} ghalat hai — 1 se 12 tak` }
  if (d < 1 || d > 31) return { ok: false, reason: `Din ${d} ghalat hai — mahine mein itna din nahi hota` }
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { ok: false, reason: `${d}/${mo}/${y} valid date nahi hai (jaise 30/02)` }
  }
  if (y < 2000 || y > 2100) return { ok: false, reason: `Saal ${y} 2000-2100 ke bahar hai — poora saal likhein` }
  return { ok: true, value: dt }
}

/**
 * Excel/CSV date cell ko Date mein badlo (UTC midnight — ledger aging isi se 30/60/90
 * buckets banati hai). Accept: Date instance | Excel serial number | "2025-01-15" |
 * "2025/01/15" | "15/01/2025" | "15-01-2025" | "15.01.2025" | "15/01/25".
 * Khali/null = null (caller aaj ki date use kare).
 */
export function parseDateCell(raw: unknown): ParseOk<Date | null> | ParseErr {
  if (raw == null || raw === '') return { ok: true, value: null }
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, reason: 'Date cell ghalat hai' }
    return { ok: true, value: raw }
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial — real-world sheet dates 2000-2170 ke darmiyan hoti hain
    if (raw < 36526 || raw > 62091) return { ok: false, reason: `"${raw}" date serial nahi lagti (2000-2070 ke bahar)` }
    return { ok: true, value: new Date(EXCEL_EPOCH_UTC + Math.round(raw) * 86400000) }
  }
  const s = String(raw).trim()
  if (!s) return { ok: true, value: null }
  // ISO-first: 2025-01-15 (ya 2025/01/15)
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/)
  if (m) return mkUtcDate(Number(m[1]), Number(m[2]), Number(m[3]))
  // Day-first: 15/01/2025 ya 15-01-2025 ya 15.01.2025 (2-digit year bhi chalta hai)
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/)
  if (m) {
    let yr = Number(m[3])
    if (yr < 100) yr += yr < 70 ? 2000 : 1900
    return mkUtcDate(yr, Number(m[2]), Number(m[1]))
  }
  return { ok: false, reason: `"${s}" date nahi hai — YYYY-MM-DD ya DD/MM/YYYY likhein` }
}

/** Opening balance ledger note — positive = shop ka udhaar, negative = shop ke haq mein advance */
export function openingNote(amount: number, via: 'import' | 'update-import'): string {
  return amount > 0
    ? `Opening balance (${via}) — purane software se`
    : `Opening balance — shop ke haq mein advance (${via})`
}
