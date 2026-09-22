'use client'

/**
 * Shop Ledger print docs (Udhaar Khata) — A4, .cbl-doc print classes reuse:
 *  1. ShopLedgerStatementDoc — single shop full khata history (running balance)
 *  2. LedgerSummaryDoc       — all shops outstanding summary (multi-page safe)
 */

import { PrintFrame } from './cbl-print'
import type { LedgerRowDTO, LedgerEntryDTO, LedgerOutletDTO, LedgersData } from '@/lib/dms-types'

const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dash = '-'
const printed = () =>
  new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

const ROWS_PER_PAGE = 20
function paginate<T>(rows: T[]): T[][] {
  const pages: T[][] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE))
  return pages.length ? pages : [[]]
}

// ================= 1) Single shop statement =================
export function ShopLedgerStatementDoc({ outlet, distributorName, entries, balance, onClose }: {
  outlet: LedgerOutletDTO
  distributorName: string
  entries: LedgerEntryDTO[] // newest-first from API — statement chronological print hota hai
  balance: number
  onClose: () => void
}) {
  const chrono = [...entries].reverse()
  const pages = paginate(chrono)
  const totalDebit = chrono.reduce((s, e) => s + e.debit, 0)
  const totalCredit = chrono.reduce((s, e) => s + e.credit, 0)
  const startDate = chrono.length ? chrono[0].date : new Date().toISOString()
  const endDate = chrono.length ? chrono[chrono.length - 1].date : new Date().toISOString()

  return (
    <PrintFrame title={`Shop Ledger — ${outlet.name}`} onClose={onClose}>
      <div className="cbl-doc">
        {pages.map((rows, pi) => (
          <div key={pi} className="cbl-page bg-white px-7 py-6">
            {/* header */}
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-md border-2 border-emerald-700 bg-emerald-700 text-xl font-black text-white" style={{ fontFamily: 'Arial Black, Arial' }}>
                  {(distributorName || 'DM').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-[17px] font-bold leading-tight">{distributorName || 'Distribution'}</p>
                  <p className="text-[10px] text-slate-600">Shop Ledger — Udhaar Khata</p>
                  <p className="text-[10px] text-slate-600">Printed: {printed()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-bold tracking-wide">SHOP LEDGER STATEMENT</p>
                <p className="text-[11px] font-semibold text-slate-700">{outlet.name}</p>
                <p className="text-[10px] text-slate-500">Code: {outlet.code} • {outlet.city} • {outlet.channel}</p>
                <p className="text-[10px] text-slate-500">Credit Days: {outlet.creditDays}</p>
              </div>
            </div>

            {/* meta box */}
            <table className="mb-3" style={{ borderWidth: 2 }}>
              <tbody>
                <tr>
                  <td style={{ border: 'none', width: '34%' }}><span style={{ fontWeight: 'bold' }}>Period:</span> {new Date(startDate).toLocaleDateString('en-GB')} — {new Date(endDate).toLocaleDateString('en-GB')}</td>
                  <td style={{ border: 'none', width: '16%' }}><span style={{ fontWeight: 'bold' }}>Entries:</span> {chrono.length}</td>
                  <td style={{ border: 'none', width: '26%' }}><span style={{ fontWeight: 'bold' }}>Total Debit (Invoices):</span> Rs {fmt2(totalDebit)}</td>
                  <td style={{ border: 'none' }}><span style={{ fontWeight: 'bold' }}>Total Credit (Cash):</span> Rs {fmt2(totalCredit)}</td>
                </tr>
              </tbody>
            </table>

            {/* entries table */}
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 74 }}>Date</th>
                  <th style={{ width: 88 }}>Ref #</th>
                  <th style={{ width: 74 }}>Type</th>
                  <th style={{ textAlign: 'left' }}>Description</th>
                  <th style={{ width: 82 }}>Debit (Rs)</th>
                  <th style={{ width: 82 }}>Credit (Rs)</th>
                  <th style={{ width: 86 }}>Balance (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={8} className="ctr" style={{ padding: '18px 0', color: '#64748b' }}>No entries in this period</td></tr>
                )}
                {rows.map((e, i) => (
                  <tr key={e.id}>
                    <td className="ctr">{pi * ROWS_PER_PAGE + i + 1}</td>
                    <td className="ctr" style={{ whiteSpace: 'nowrap' }}>{new Date(e.date).toLocaleDateString('en-GB')}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{e.refNo ?? dash}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{e.refType}</td>
                    <td style={{ fontSize: 9.5 }}>{e.note ?? e.refType}</td>
                    <td className="num">{e.debit > 0 ? fmt2(e.debit) : dash}</td>
                    <td className="num">{e.credit > 0 ? fmt2(e.credit) : dash}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(e.balance)}</td>
                  </tr>
                ))}
                {pi === pages.length - 1 && rows.length > 0 && (
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    <td colSpan={5} className="ctr" style={{ fontWeight: 'bold', fontSize: 10 }}>TOTALS</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(totalDebit)}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(totalCredit)}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(balance)}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {pi === pages.length - 1 && (
              <>
                {/* closing balance box */}
                <table style={{ marginTop: 12, borderWidth: 2, width: 'auto', marginLeft: 'auto', tableLayout: 'auto' }}>
                  <tbody>
                    <tr>
                      <td style={{ border: 'none', paddingRight: 18, fontSize: 11 }}>
                        {balance > 0.01 ? 'OUTSTANDING UDHAAR (SHOP WILL PAY):' : balance < -0.01 ? 'ADVANCE / CREDIT BALANCE:' : 'BALANCE:'}
                      </td>
                      <td style={{ border: 'none', fontWeight: 'bold', fontSize: 13, textAlign: 'right' }}>Rs {fmt2(Math.abs(balance))}</td>
                    </tr>
                  </tbody>
                </table>
                {balance > 0.01 && (
                  <p style={{ fontSize: 9, color: '#475569', textAlign: 'right', marginTop: 3 }}>
                    (Is shop ne hum se stock udhaar par liya hai — ye raqam shop se leni hai)
                  </p>
                )}

                {/* signatures */}
                <div style={{ marginTop: 42, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  {['Prepared By', 'Verified By', 'Shop Keeper (Receiver)'].map((s) => (
                    <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ borderTop: '1px dotted #334155', paddingTop: 4, fontSize: 10, fontWeight: 'bold' }}>{s}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* page footer */}
            <div style={{ marginTop: 14, borderTop: '1px solid #94a3b8', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b' }}>
              <span>{outlet.name} ({outlet.code}) — Shop Ledger Statement</span>
              <span>Page {pi + 1} of {pages.length}</span>
            </div>
          </div>
        ))}
      </div>
    </PrintFrame>
  )
}

// ================= 2) All shops summary =================
const SUMMARY_ROWS_PER_PAGE = 24

export function LedgerSummaryDoc({ data, onClose }: { data: LedgersData; onClose: () => void }) {
  const rows = data.ledgers
  const pages: LedgerRowDTO[][] = []
  for (let i = 0; i < rows.length; i += SUMMARY_ROWS_PER_PAGE) pages.push(rows.slice(i, i + SUMMARY_ROWS_PER_PAGE))
  const safePages = pages.length ? pages : [[]]

  return (
    <PrintFrame title="Shops Ledger Summary" onClose={onClose}>
      <div className="cbl-doc">
        {safePages.map((rows, pi) => (
          <div key={pi} className="cbl-page bg-white px-7 py-6">
            {/* header */}
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-md border-2 border-emerald-700 bg-emerald-700 text-lg font-black text-white" style={{ fontFamily: 'Arial Black, Arial' }}>
                  {(rows[0]?.distributorName || 'DM').slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-[17px] font-bold leading-tight">{rows[0]?.distributorName || 'Distribution'}</p>
                  <p className="text-[10px] text-slate-600">Shops Ledger Summary — Udhaar Khata (All Shops)</p>
                  <p className="text-[10px] text-slate-600">Printed: {printed()}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-bold tracking-wide">OUTSTANDING SUMMARY</p>
                <p className="text-[10px] text-slate-500">Total Shops: {data.totals.totalShops} • With Udhaar: {data.totals.shopsWithUdhaar}</p>
                <p className="text-[10px] text-slate-500">Total Outstanding: Rs {fmt2(data.totals.outstanding)}</p>
              </div>
            </div>

            {/* summary table */}
            <table>
              <thead>
                <tr>
                  <th style={{ width: 26 }}>#</th>
                  <th style={{ width: 78 }}>Code</th>
                  <th style={{ textAlign: 'left' }}>Shop / Outlet</th>
                  <th style={{ width: 84 }}>City</th>
                  <th style={{ width: 76 }}>Channel</th>
                  <th style={{ width: 42 }}>Ent.</th>
                  <th style={{ width: 88 }}>Debit (Rs)</th>
                  <th style={{ width: 88 }}>Credit (Rs)</th>
                  <th style={{ width: 92 }}>Balance (Rs)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={9} className="ctr" style={{ padding: '18px 0', color: '#64748b' }}>No shops found</td></tr>
                )}
                {rows.map((l, i) => (
                  <tr key={l.outletId}>
                    <td className="ctr">{pi * SUMMARY_ROWS_PER_PAGE + i + 1}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{l.code}</td>
                    <td style={{ fontSize: 9.5 }}>{l.name}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{l.city}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{l.channel}</td>
                    <td className="ctr">{l.entries}</td>
                    <td className="num">{l.debit > 0 ? fmt2(l.debit) : dash}</td>
                    <td className="num">{l.credit > 0 ? fmt2(l.credit) : dash}</td>
                    <td className="num" style={{ fontWeight: 'bold', color: l.balance > 0.01 ? '#b91c1c' : '#0f172a' }}>{fmt2(l.balance)}</td>
                  </tr>
                ))}
                {pi === safePages.length - 1 && rows.length > 0 && (
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    <td colSpan={6} className="ctr" style={{ fontWeight: 'bold', fontSize: 10 }}>TOTALS</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(rows.reduce((s, l) => s + l.debit, 0))}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(rows.reduce((s, l) => s + l.credit, 0))}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(rows.reduce((s, l) => s + l.balance, 0))}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {pi === safePages.length - 1 && (
              <div style={{ marginTop: 34, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                {['Prepared By', 'Verified By', 'Approved By'].map((s) => (
                  <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ borderTop: '1px dotted #334155', paddingTop: 4, fontSize: 10, fontWeight: 'bold' }}>{s}</div>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 14, borderTop: '1px solid #94a3b8', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b' }}>
              <span>Shops Ledger Summary — Udhaar Khata</span>
              <span>Page {pi + 1} of {safePages.length}</span>
            </div>
          </div>
        ))}
      </div>
    </PrintFrame>
  )
}
