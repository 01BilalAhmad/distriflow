'use client'

/**
 * Company Statement of Account — A4 print doc (payables ledger).
 * .cbl-doc/.cbl-page generic print classes reuse hote hain (globals.css).
 */

import { PrintFrame } from './cbl-print'
import type { CompanyLedgerDTO, CompanyLedgerEntryDTO } from '@/lib/dms-types'

const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const dash = '-'

const TYPE_LABEL: Record<string, string> = {
  PURCHASE: 'Purchase',
  PAYMENT: 'Payment',
  DEBIT_NOTE: 'Debit Note',
  CREDIT_NOTE: 'Credit Note',
  ADJUSTMENT: 'Adjustment',
}

const TYPE_FOR_DEBIT: Record<string, string> = {
  PAYMENT: 'Payment (We Paid)',
  DEBIT_NOTE: 'Debit Note (Return/Claim)',
  ADJUSTMENT: 'Adjustment (Payable Down)',
}
const TYPE_FOR_CREDIT: Record<string, string> = {
  CREDIT_NOTE: 'Credit Note (Extra Charge)',
  ADJUSTMENT: 'Adjustment (Payable Up)',
}

const ROWS_PER_PAGE = 20

function paginate(rows: CompanyLedgerEntryDTO[]): CompanyLedgerEntryDTO[][] {
  const pages: CompanyLedgerEntryDTO[][] = []
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) pages.push(rows.slice(i, i + ROWS_PER_PAGE))
  return pages.length ? pages : [[]]
}

export function CompanyStatementDoc({ data, onClose }: { data: CompanyLedgerDTO; onClose: () => void }) {
  const pages = paginate(data.entries)
  const startDate = data.entries.length ? data.entries[0].date : new Date().toISOString()
  const endDate = data.entries.length ? data.entries[data.entries.length - 1].date : new Date().toISOString()
  const payable = data.totals.balance

  return (
    <PrintFrame title={`Statement of Account — ${data.company.name}`} onClose={onClose}>
      <div className="cbl-doc">
        {pages.map((rows, pi) => (
          <div key={pi} className="cbl-page bg-white px-7 py-6">
            {/* header */}
            <div className="mb-3 flex items-start justify-between">
              <div className="flex items-center gap-3">
                {data.company.logo ? (
                  <img src={data.company.logo} alt="logo" className="h-16 w-16 rounded-md border border-slate-300 object-contain" />
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-md border-2 border-emerald-700 bg-emerald-700 text-2xl font-black text-white" style={{ fontFamily: 'Arial Black, Arial' }}>
                    {(data.company.shortCode ?? data.company.name).slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  <p className="text-[17px] font-bold leading-tight">{data.company.name}</p>
                  {data.company.address && <p className="text-[10px] text-slate-600 max-w-[280px]">{data.company.address}</p>}
                  {data.company.phone && <p className="text-[10px] text-slate-600">Ph: {data.company.phone}</p>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-[15px] font-bold tracking-wide">STATEMENT OF ACCOUNT</p>
                <p className="text-[10px] text-slate-500">Supplier / Company Payables Ledger</p>
                <p className="text-[10px] text-slate-500">Printed: {new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}</p>
              </div>
            </div>

            {/* meta box */}
            <table className="mb-3" style={{ borderWidth: 2 }}>
              <tbody>
                <tr>
                  <td style={{ border: 'none', width: '34%' }}><span style={{ fontWeight: 'bold' }}>Period:</span> {new Date(startDate).toLocaleDateString('en-GB')} — {new Date(endDate).toLocaleDateString('en-GB')}</td>
                  <td style={{ border: 'none', width: '22%' }}><span style={{ fontWeight: 'bold' }}>Entries:</span> {data.entries.length}</td>
                  <td style={{ border: 'none', width: '22%' }}><span style={{ fontWeight: 'bold' }}>Total Purchases:</span> Rs {fmt2(data.totals.credit)}</td>
                  <td style={{ border: 'none' }}><span style={{ fontWeight: 'bold' }}>Total Paid/Adjusted:</span> Rs {fmt2(data.totals.debit)}</td>
                </tr>
              </tbody>
            </table>

            {/* entries table */}
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}>#</th>
                  <th style={{ width: 72 }}>Date</th>
                  <th style={{ width: 86 }}>Type</th>
                  <th style={{ width: 78 }}>Ref #</th>
                  <th style={{ textAlign: 'left' }}>Description</th>
                  <th style={{ width: 80 }}>Debit (Rs)</th>
                  <th style={{ width: 80 }}>Credit (Rs)</th>
                  <th style={{ width: 84 }}>Balance (Rs)</th>
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
                    <td className="ctr" style={{ fontSize: 9 }}>{TYPE_LABEL[e.type] ?? e.type}</td>
                    <td className="ctr" style={{ fontSize: 9 }}>{e.refNo ?? dash}</td>
                    <td style={{ fontSize: 9.5 }}>{e.description}{e.invoiceNo && e.type !== 'PURCHASE' ? ` (${e.invoiceNo})` : ''}</td>
                    <td className="num">{e.debit > 0 ? fmt2(e.debit) : dash}</td>
                    <td className="num">{e.credit > 0 ? fmt2(e.credit) : dash}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(e.balance)}</td>
                  </tr>
                ))}
                {pi === pages.length - 1 && rows.length > 0 && (
                  <tr style={{ backgroundColor: '#f1f5f9' }}>
                    <td colSpan={5} className="ctr" style={{ fontWeight: 'bold', fontSize: 10 }}>TOTALS</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(data.totals.debit)}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(data.totals.credit)}</td>
                    <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(payable)}</td>
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
                        {payable > 0.01 ? 'BALANCE PAYABLE TO COMPANY:' : payable < -0.01 ? 'ADVANCE / CREDIT BALANCE:' : 'BALANCE:'}
                      </td>
                      <td style={{ border: 'none', fontWeight: 'bold', fontSize: 13, textAlign: 'right' }}>Rs {fmt2(Math.abs(payable))}</td>
                    </tr>
                  </tbody>
                </table>
                {payable > 0.01 && (
                  <p style={{ fontSize: 9, color: '#475569', textAlign: 'right', marginTop: 3 }}>
                    (Hum ne is company se stock purchase kiya hai — ye raqam humein unko denee hai)
                  </p>
                )}

                {/* signatures */}
                <div style={{ marginTop: 42, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  {['Prepared By', 'Verified By', 'Company Representative'].map((s) => (
                    <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ borderTop: '1px dotted #334155', paddingTop: 4, fontSize: 10, fontWeight: 'bold' }}>{s}</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* page footer */}
            <div style={{ marginTop: 14, borderTop: '1px solid #94a3b8', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b' }}>
              <span>{data.company.name} — Statement of Account</span>
              <span>Page {pi + 1} of {pages.length}</span>
            </div>
          </div>
        ))}
      </div>
    </PrintFrame>
  )
}

export { TYPE_FOR_DEBIT, TYPE_FOR_CREDIT }
