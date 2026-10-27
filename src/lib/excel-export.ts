/**
 * Excel export helpers (SheetJS) — shop ledger statements + all-shops summary.
 * Client-side only: XLSX.writeFile browser download trigger karta hai.
 */
import * as XLSX from 'xlsx'
import type { LedgerRowDTO, LedgerEntryDTO, LedgerOutletDTO, RecoveryRowDTO } from './dms-types'

const r2 = (v: number) => Math.round(v * 100) / 100

const stamp = () => new Date().toISOString().slice(0, 10)
const dDMY = (iso: string) => new Date(iso).toLocaleDateString('en-GB')
const nowStr = () =>
  new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

/** Money columns par #,##0.00 number format lagao (col indexes aoa ke hisaab se) */
function fmtMoneyCols(ws: XLSX.WorkSheet, colIdx: number[], startRow: number) {
  const range = XLSX.utils.decode_range(ws['!ref'] ?? 'A1')
  for (let R = startRow; R <= range.e.r; R++) {
    for (const C of colIdx) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C })
      const cell = ws[addr] as XLSX.CellObject | undefined
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'
    }
  }
}

function download(wb: XLSX.WorkBook, filename: string) {
  XLSX.writeFile(wb, filename)
}

// ---------- 1) Single shop khata history ----------
export function exportShopLedgerExcel(
  outlet: LedgerOutletDTO,
  distributorName: string,
  entries: LedgerEntryDTO[],
  balance: number,
) {
  const chrono = [...entries].reverse() // API newest-first → statement chronological
  const totalDebit = r2(chrono.reduce((s, e) => s + e.debit, 0))
  const totalCredit = r2(chrono.reduce((s, e) => s + e.credit, 0))

  const aoa: (string | number)[][] = []
  aoa.push([distributorName || 'Distribution'])
  aoa.push(['SHOP LEDGER STATEMENT (Udhaar Khata)'])
  aoa.push([
    `Shop: ${outlet.name}`,
    `Code: ${outlet.code}`,
    `City: ${outlet.city}`,
    `Channel: ${outlet.channel}`,
    `Credit Days: ${outlet.creditDays}`,
  ])
  aoa.push([`Printed: ${nowStr()}`, `Entries: ${chrono.length}`])
  aoa.push([])
  aoa.push(['#', 'Date', 'Ref #', 'Type', 'Description', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)'])

  chrono.forEach((e, i) => {
    aoa.push([
      i + 1,
      dDMY(e.date),
      e.refNo,
      e.refType,
      e.note ?? e.refType,
      e.debit > 0 ? r2(e.debit) : '',
      e.credit > 0 ? r2(e.credit) : '',
      r2(e.balance),
    ])
  })
  aoa.push(['', 'TOTALS', '', '', '', totalDebit, totalCredit, r2(balance)])
  aoa.push([])
  aoa.push([
    balance > 0.01 ? `OUTSTANDING UDHAAR: Rs ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : balance < -0.01 ? `ADVANCE: Rs ${Math.abs(balance).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : 'BALANCE: CLEAR',
    '', '', '', '', '', '', '',
  ])
  aoa.push(['Prepared By: ____________________', 'Checked By: ____________________', 'Shop Keeper (Receiver): ____________________'])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 15 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 7 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 7 } },
  ]
  fmtMoneyCols(ws, [5, 6, 7], 6)
  ws['!autofilter'] = { ref: `A6:H${6 + chrono.length + 1}` }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Ledger')
  download(wb, `shop-ledger-${outlet.code}-${stamp()}.xlsx`)
}

// ---------- 2) All shops summary ----------
export function exportShopSummaryExcel(rows: LedgerRowDTO[], totals: { outstanding: number; shopsWithUdhaar: number; totalShops: number }) {
  const aoa: (string | number)[][] = []
  aoa.push(['SHOPS LEDGER SUMMARY — Udhaar Khata (All Shops)'])
  aoa.push([`Printed: ${nowStr()}`, `Total Shops: ${totals.totalShops}`, `Shops with Udhaar: ${totals.shopsWithUdhaar}`, `Total Outstanding: Rs ${totals.outstanding.toLocaleString('en-US', { minimumFractionDigits: 2 })}`])
  aoa.push([])
  aoa.push(['#', 'Shop Code', 'Shop / Outlet', 'City', 'Channel', 'Distributor', 'Entries', 'Debit (Invoices)', 'Credit (Cash)', 'Balance (Udhaar)'])

  rows.forEach((l, i) => {
    aoa.push([
      i + 1,
      l.code,
      l.name,
      l.city,
      l.channel,
      l.distributorName,
      l.entries,
      r2(l.debit),
      r2(l.credit),
      r2(l.balance),
    ])
  })
  aoa.push(['', 'TOTALS', '', '', '', '', '', r2(rows.reduce((s, l) => s + l.debit, 0)), r2(rows.reduce((s, l) => s + l.credit, 0)), r2(rows.reduce((s, l) => s + l.balance, 0))])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 30 }, { wch: 14 }, { wch: 15 }, { wch: 26 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 17 }]
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 9 } }]
  fmtMoneyCols(ws, [7, 8, 9], 4)
  ws['!autofilter'] = { ref: `A4:J${4 + rows.length + 1}` }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Summary')
  download(wb, `shops-ledger-summary-${stamp()}.xlsx`)
}

// ---------- 3) Multi-shop full ledgers (ek workbook, har shop apni sheet) ----------
export function exportAllShopsFullExcel(rows: LedgerRowDTO[], fetchEntries: (outletId: string) => Promise<{ outlet: LedgerOutletDTO; balance: number; entries: LedgerEntryDTO[] }>) {
  return (async () => {
    const wb = XLSX.utils.book_new()
    const summary: (string | number)[][] = [['#', 'Shop Code', 'Shop', 'Entries', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)']]
    let idx = 0
    for (const row of rows) {
      const detail = await fetchEntries(row.outletId)
      const chrono = [...detail.entries].reverse()
      const sheetName = (row.code || row.name).replace(/[\\/*?:[\]]/g, '').slice(0, 28) || `S${idx + 1}`

      const aoa: (string | number)[][] = []
      aoa.push([`${row.name} — Shop Ledger (Udhaar Khata)`])
      aoa.push([`Code: ${row.code}`, `City: ${row.city}`, `Channel: ${row.channel}`, `Distributor: ${row.distributorName}`])
      aoa.push([])
      aoa.push(['#', 'Date', 'Ref #', 'Type', 'Description', 'Debit (Rs)', 'Credit (Rs)', 'Balance (Rs)'])
      chrono.forEach((e, i) => {
        aoa.push([i + 1, dDMY(e.date), e.refNo, e.refType, e.note ?? e.refType, e.debit > 0 ? r2(e.debit) : '', e.credit > 0 ? r2(e.credit) : '', r2(e.balance)])
      })
      aoa.push(['', 'TOTALS', '', '', '', r2(chrono.reduce((s, e) => s + e.debit, 0)), r2(chrono.reduce((s, e) => s + e.credit, 0)), r2(detail.balance)])

      const ws = XLSX.utils.aoa_to_sheet(aoa)
      ws['!cols'] = [{ wch: 5 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 34 }, { wch: 14 }, { wch: 14 }, { wch: 15 }]
      fmtMoneyCols(ws, [5, 6, 7], 4)
      XLSX.utils.book_append_sheet(wb, ws, sheetName)

      summary.push([idx + 1, row.code, row.name, chrono.length, r2(row.debit), r2(row.credit), r2(row.balance)])
      idx++
    }
    summary.push(['', 'TOTALS', '', r2(summary.slice(1).reduce((s, r) => s + Number(r[3] ?? 0), 0)), r2(rows.reduce((s, l) => s + l.debit, 0)), r2(rows.reduce((s, l) => s + l.credit, 0)), r2(rows.reduce((s, l) => s + l.balance, 0))])
    const wsS = XLSX.utils.aoa_to_sheet(summary)
    wsS['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 30 }, { wch: 9 }, { wch: 15 }, { wch: 15 }, { wch: 16 }]
    fmtMoneyCols(wsS, [4, 5, 6], 1)
    XLSX.utils.book_append_sheet(wb, wsS, 'Summary')
    download(wb, `shops-ledgers-full-${stamp()}.xlsx`)
  })()
}

// ---------- 4) Recovery voucher history (date/booker filter ke baad jo UI par hai) ----------
const RCV_STATUS: Record<string, string> = { PENDING: 'Approval Pending', APPROVED: 'Approved', REJECTED: 'Rejected' }

export function exportRecoveryHistoryExcel(rows: RecoveryRowDTO[], scopeLabel: string) {
  const total = r2(rows.reduce((s, r) => s + r.amount, 0))
  const approved = rows.filter((r) => r.status === 'APPROVED')
  const pending = rows.filter((r) => r.status === 'PENDING')

  const aoa: (string | number)[][] = []
  aoa.push(['RECOVERY VOUCHER HISTORY (Udhaar Wasooli)'])
  aoa.push([`Scope: ${scopeLabel}`, `Printed: ${nowStr()}`, `Entries: ${rows.length}`])
  aoa.push([`Total: Rs ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, `Approved: ${approved.length} (Rs ${r2(approved.reduce((s, r) => s + r.amount, 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })})`, `Pending: ${pending.length} (Rs ${r2(pending.reduce((s, r) => s + r.amount, 0)).toLocaleString('en-US', { minimumFractionDigits: 2 })})`])
  aoa.push([])
  aoa.push(['#', 'Voucher #', 'Date', 'Order Booker', 'Shop', 'Shop Code', 'Method', 'Reference', 'Amount (Rs)', 'Status', 'Posted By', 'Approved By'])

  rows.forEach((r, i) => {
    aoa.push([
      i + 1,
      r.recoveryNo,
      dDMY(r.date),
      r.bookerName,
      r.outletName,
      r.outletCode,
      r.method,
      r.reference ?? '',
      r2(r.amount),
      RCV_STATUS[r.status] ?? r.status,
      r.postedByName ?? '',
      r.approvedByName ?? '',
    ])
  })
  aoa.push(['', 'TOTALS', '', '', '', '', '', '', total, '', '', ''])

  const ws = XLSX.utils.aoa_to_sheet(aoa)
  ws['!cols'] = [{ wch: 4 }, { wch: 12 }, { wch: 11 }, { wch: 18 }, { wch: 28 }, { wch: 11 }, { wch: 9 }, { wch: 14 }, { wch: 13 }, { wch: 15 }, { wch: 14 }, { wch: 14 }]
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
  ]
  fmtMoneyCols(ws, [8], 5)
  ws['!autofilter'] = { ref: `A5:L${5 + rows.length + 1}` }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Recovery History')
  download(wb, `recovery-history-${stamp()}.xlsx`)
}
