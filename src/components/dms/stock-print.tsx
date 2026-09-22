'use client'

/**
 * Stock Report print doc (Task 21-i) — Physical Stock Count Sheet, A4.
 * Har warehouse apne page(s) par; products alphabetical "trteeb" mein;
 * System qty Ctns/Boxes/Pcs (bill jaisa hi column order) + khali
 * Physical Count (Ctn/Box/Pcs) columns haath se ginti likhne ke liye
 * + Remarks column. Last page par totals + Counted/Verified signatures.
 */

import { PrintFrame } from './cbl-print'
import { splitPcs } from './unit-qty'
import type { WarehouseDTO, StockRowDTO } from '@/lib/dms-types'

const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtInt = (v: number) => Math.round(v).toLocaleString('en-US')
const printed = () =>
  new Date().toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
const dash = '—'

const ROWS_PER_PAGE = 18

type PageModel = {
  wh: WarehouseDTO
  rowsAlpha: StockRowDTO[]
  chunk: StockRowDTO[]
  pi: number
  pages: number
}

function buildPages(warehouses: WarehouseDTO[]): PageModel[] {
  const out: PageModel[] = []
  for (const wh of warehouses) {
    if (wh.rows.length === 0) continue
    const rowsAlpha = [...wh.rows].sort((a, b) => a.productName.localeCompare(b.productName))
    const pages = Math.max(1, Math.ceil(rowsAlpha.length / ROWS_PER_PAGE))
    for (let pi = 0; pi < pages; pi++) {
      out.push({ wh, rowsAlpha, chunk: rowsAlpha.slice(pi * ROWS_PER_PAGE, (pi + 1) * ROWS_PER_PAGE), pi, pages })
    }
  }
  return out
}

export function StockReportDoc({ warehouses, companyLabel, onClose }: {
  warehouses: WarehouseDTO[]
  /** company filter label — set ho to header mein "Company: X" print hota hai */
  companyLabel?: string
  onClose: () => void
}) {
  const pages = buildPages(warehouses)
  const distributorName = pages[0]?.wh.distributorName || warehouses[0]?.distributorName || 'Distribution'

  return (
    <PrintFrame title="Stock Report — Physical Count Sheet" onClose={onClose} pdfName={companyLabel ? `stock-report-${companyLabel}` : 'stock-report-physical-count'}>
      <div className="cbl-doc">
        {pages.length === 0 && (
          <div className="cbl-page bg-white px-7 py-6">
            <p style={{ padding: '24px 0', textAlign: 'center', color: '#64748b' }}>Kisi warehouse mein stock nahi — report khali hai</p>
          </div>
        )}
        {pages.map(({ wh, rowsAlpha, chunk, pi, pages: nPages }) => {
          // totals RENDERED rows se — company filter par warehouse ke API totals (sab products) galat hote
          const totalPcs = rowsAlpha.reduce((s, r) => s + r.totalQty, 0)
          const totalValue = rowsAlpha.reduce((s, r) => s + r.value, 0)
          const isLast = pi === nPages - 1
          return (
            <div key={`${wh.id}-${pi}`} className="cbl-page bg-white px-7 py-6">
              {/* header */}
              <div className="mb-3 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 items-center justify-center rounded-md border-2 border-emerald-700 bg-emerald-700 text-lg font-black text-white" style={{ fontFamily: 'Arial Black, Arial' }}>
                    {(distributorName || 'DM').slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <p className="text-[17px] font-bold leading-tight">{distributorName}</p>
                    <p className="text-[10px] text-slate-600">Stock Report — Physical Stock Count Sheet</p>
                    <p className="text-[10px] text-slate-600">Printed: {printed()}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-[15px] font-bold tracking-wide">STOCK REPORT</p>
                  {companyLabel && <p className="text-[11px] font-bold text-emerald-800">Company: {companyLabel}</p>}
                  <p className="text-[11px] font-semibold text-slate-700">{wh.name} {wh.isPrimary ? '(PRIMARY)' : ''}</p>
                  <p className="text-[10px] text-slate-500">{wh.city} • Page {pi + 1} of {nPages}</p>
                </div>
              </div>

              {/* meta box (sirf pehle page par) */}
              {pi === 0 && (
                <>
                  <table className="mb-1" style={{ borderWidth: 2 }}>
                    <tbody>
                      <tr>
                        <td style={{ border: 'none', width: '34%' }}><span style={{ fontWeight: 'bold' }}>Products:</span> {rowsAlpha.length}{companyLabel ? ` (${companyLabel})` : ''}</td>
                        <td style={{ border: 'none', width: '24%' }}><span style={{ fontWeight: 'bold' }}>System Stock:</span> {fmtInt(totalPcs)} pcs</td>
                        <td style={{ border: 'none' }}><span style={{ fontWeight: 'bold' }}>Stock Value:</span> Rs {fmt2(totalValue)}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p style={{ fontSize: 8.5, color: '#64748b', marginBottom: 8, fontStyle: 'italic' }}>
                    (Physical Count ke khali Ctn / Box / Pcs columns mein asli ginti likhein — system se compare karke farq Remarks mein note karein)
                  </p>
                </>
              )}

              {/* count table */}
              <table>
                <colgroup>
                  <col style={{ width: 24 }} />
                  <col style={{ width: 198 }} />
                  <col style={{ width: 92 }} />
                  <col style={{ width: 38 }} />
                  <col style={{ width: 40 }} />
                  <col style={{ width: 36 }} />
                  <col style={{ width: 70 }} />
                  <col style={{ width: 34 }} />
                  <col style={{ width: 34 }} />
                  <col style={{ width: 34 }} />
                  <col />
                </colgroup>
                <thead>
                  <tr>
                    <th rowSpan={2}>#</th>
                    <th rowSpan={2}>Product</th>
                    <th rowSpan={2}>Pack</th>
                    <th colSpan={3}>System Stock</th>
                    <th rowSpan={2}>Value (Rs)</th>
                    <th colSpan={3}>Physical Count</th>
                    <th rowSpan={2}>Remarks</th>
                  </tr>
                  <tr>
                    <th style={{ padding: '1px 2px' }}>Ctns</th>
                    <th style={{ padding: '1px 2px' }}>Boxes</th>
                    <th style={{ padding: '1px 2px' }}>Pcs</th>
                    <th style={{ padding: '1px 2px' }}>Ctn</th>
                    <th style={{ padding: '1px 2px' }}>Box</th>
                    <th style={{ padding: '1px 2px' }}>Pcs</th>
                  </tr>
                </thead>
                <tbody>
                  {chunk.map((r, i) => {
                    const s = splitPcs(r.totalQty, r.unitsPerCarton, r.pcsPerBox)
                    return (
                      <tr key={r.productId}>
                        <td className="ctr">{pi * ROWS_PER_PAGE + i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 'bold', fontSize: 10 }}>{r.productName}</div>
                          <div style={{ fontSize: 8.5, color: '#475569' }}>{r.sku} • {r.brand}</div>
                          {r.nearExpiryQty > 0 && (
                            <div style={{ fontSize: 8, color: '#b91c1c', fontWeight: 'bold' }}>Near expiry: {fmtInt(r.nearExpiryQty)} pcs</div>
                          )}
                        </td>
                        <td className="ctr" style={{ fontSize: 8.5 }}>{`1 Ctn = ${r.boxesPerCarton > 0 && r.pcsPerBox > 0 ? `${r.boxesPerCarton} Box = ` : ''}${r.unitsPerCarton} Pcs`}</td>
                        <td className="ctr">{s.ctn > 0 ? s.ctn : dash}</td>
                        <td className="ctr">{s.box > 0 ? s.box : dash}</td>
                        <td className="ctr">{s.pcs > 0 ? s.pcs : dash}</td>
                        <td className="num" style={{ fontSize: 9.5 }}>{fmt2(r.value)}</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                        <td>&nbsp;</td>
                      </tr>
                    )
                  })}
                  {isLast && chunk.length > 0 && (
                    <tr style={{ backgroundColor: '#f1f5f9' }}>
                      <td colSpan={3} className="ctr" style={{ fontWeight: 'bold', fontSize: 10 }}>TOTAL — {rowsAlpha.length} PRODUCTS</td>
                      <td colSpan={3} className="num" style={{ fontWeight: 'bold' }}>{fmtInt(totalPcs)} pcs</td>
                      <td className="num" style={{ fontWeight: 'bold' }}>{fmt2(totalValue)}</td>
                      <td colSpan={3} className="ctr">{dash}</td>
                      <td>&nbsp;</td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* signatures (aakhri page par) */}
              {isLast && (
                <div style={{ marginTop: 44, display: 'flex', justifyContent: 'space-between', gap: 24 }}>
                  {['Counted By', 'Verified By', 'Approved By'].map((s) => (
                    <div key={s} style={{ flex: 1, textAlign: 'center' }}>
                      <div style={{ borderTop: '1px dotted #334155', paddingTop: 4, fontSize: 10, fontWeight: 'bold' }}>{s}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* page footer */}
              <div style={{ marginTop: 14, borderTop: '1px solid #94a3b8', paddingTop: 4, display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#64748b' }}>
                <span>{wh.name} ({wh.city}) — Stock Report / Physical Count Sheet</span>
                <span>Page {pi + 1} of {nPages}</span>
              </div>
            </div>
          )
        })}
      </div>
    </PrintFrame>
  )
}
