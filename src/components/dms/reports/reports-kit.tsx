'use client'

// ============================================================
// Task 66 — REPORTS KIT (shared client components)
// Har report tab isi kit se banta hai:
//   • FilterBar  — date presets + custom range + booker/company selects
//   • KpiRow     — summary cards
//   • DataTable  — generic table + totals row (right-aligned money cols)
//   • ExportButtons — Task 69: Excel (.xlsx) + PDF + CSV + Print — ek hi jagah 4 exports
//   • downloadCSV / downloadExcel / downloadPDF / printReport — export + print
// Sab reports ek jaisi dikhein — styling yahan centralized hai.
// ============================================================

import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { Download, Printer, RefreshCw, FileSpreadsheet, FileDown } from 'lucide-react'

export interface DateRange { from: string; to: string } // yyyy-mm-dd

export function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export function defaultRange(): DateRange {
  const now = new Date()
  return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(now) }
}
export type Preset = 'today' | '7d' | '30d' | 'thisMonth' | 'lastMonth'
export const PRESETS: { key: Preset; label: string }[] = [
  { key: 'today', label: 'Aaj' },
  { key: '7d', label: '7 Din' },
  { key: '30d', label: '30 Din' },
  { key: 'thisMonth', label: 'Is Month' },
  { key: 'lastMonth', label: 'Pichla Month' },
]
export function presetRange(p: Preset): DateRange {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  switch (p) {
    case 'today': return { from: isoDay(end), to: isoDay(end) }
    case '7d': { const s = new Date(end); s.setDate(s.getDate() - 6); return { from: isoDay(s), to: isoDay(end) } }
    case '30d': { const s = new Date(end); s.setDate(s.getDate() - 29); return { from: isoDay(s), to: isoDay(end) } }
    case 'thisMonth': return { from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)), to: isoDay(end) }
    case 'lastMonth': return { from: isoDay(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: isoDay(new Date(now.getFullYear(), now.getMonth(), 0)) }
  }
}

export function fmtMoney(n: number | null | undefined): string {
  const v = Math.round((Number(n) || 0) * 100) / 100
  const hasCents = Math.abs(v % 1) > 0.001
  return v.toLocaleString('en-PK', { minimumFractionDigits: hasCents ? 2 : 0, maximumFractionDigits: 2 })
}
export function fmtQty(n: number | null | undefined): string {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v % 1 === 0 ? String(v) : v.toFixed(1)
}
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: '2-digit' })
}
export function rangeLabel(r: DateRange): string {
  const f = (s: string) => new Date(s + 'T00:00:00').toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' })
  return f(r.from) + ' — ' + f(r.to)
}

// ---------------- Filter Bar ----------------
export interface Option { id: string; label: string }

export function FilterBar(props: {
  range?: DateRange
  setRange?: (r: DateRange) => void
  preset?: Preset | 'custom'
  setPreset?: (p: Preset | 'custom') => void
  booker?: string
  setBooker?: (v: string) => void
  company?: string
  setCompany?: (v: string) => void
  bookers?: Option[]
  companies?: Option[]
  extra?: React.ReactNode
  onRefresh: () => void
  loading?: boolean
}) {
  const { range, setRange, preset, setPreset, booker, setBooker, company, setCompany, bookers, companies, extra, onRefresh, loading } = props
  const sel = 'h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500/30'
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-100 bg-white/80 p-2.5 shadow-sm">
      {range && setRange && setPreset && (
        <>
          <div className="flex flex-wrap items-center gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => { setPreset(p.key); setRange(presetRange(p.key)) }}
                className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                  preset === p.key ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50 hover:text-emerald-700'
                }`}
              >
                {p.label}
              </button>
            ))}
            <button
              onClick={() => setPreset('custom')}
              className={`rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${
                preset === 'custom' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-emerald-50'
              }`}
            >
              Custom
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input type="date" value={range.from} onChange={(e) => { setPreset('custom'); setRange({ ...range, from: e.target.value }) }} className={sel} />
            <span className="text-xs text-slate-400">→</span>
            <input type="date" value={range.to} onChange={(e) => { setPreset('custom'); setRange({ ...range, to: e.target.value }) }} className={sel} />
          </div>
        </>
      )}
      {bookers && setBooker && (
        <select value={booker ?? ''} onChange={(e) => setBooker(e.target.value)} className={sel}>
          <option value="">Sab Order Bookers</option>
          {bookers.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
        </select>
      )}
      {companies && setCompany && (
        <select value={company ?? ''} onChange={(e) => setCompany(e.target.value)} className={sel}>
          <option value="">Sab Companies</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      )}
      {extra}
      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-auto flex h-9 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700 disabled:opacity-50"
      >
        <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
      </button>
    </div>
  )
}

export function useRangeFilter(): { range: DateRange; setRange: (r: DateRange) => void; preset: Preset | 'custom'; setPreset: (p: Preset | 'custom') => void } {
  const [range, setRange] = useState<DateRange>(defaultRange())
  const [preset, setPreset] = useState<Preset | 'custom'>('thisMonth')
  return { range, setRange, preset, setPreset }
}

// ---------------- KPI cards ----------------
export function KpiRow({ items }: { items: { label: string; value: string; sub?: string; tone?: 'emerald' | 'amber' | 'blue' | 'red' | 'slate' }[] }) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-100 bg-emerald-50/60 text-emerald-700',
    amber: 'border-amber-100 bg-amber-50/60 text-amber-700',
    blue: 'border-blue-100 bg-blue-50/60 text-blue-700',
    red: 'border-red-100 bg-red-50/60 text-red-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
      {items.map((k) => (
        <div key={k.label} className={`rounded-xl border p-3 shadow-sm ${tones[k.tone ?? 'slate']}`}>
          <p className="text-[11px] font-medium opacity-80">{k.label}</p>
          <p className="mt-0.5 text-lg font-bold leading-tight">{k.value}</p>
          {k.sub && <p className="mt-0.5 text-[10px] opacity-70">{k.sub}</p>}
        </div>
      ))}
    </div>
  )
}

// ---------------- Table ----------------
export interface Col<T> {
  key: string
  label: string
  render?: (row: T, idx: number) => React.ReactNode
  align?: 'left' | 'right' | 'center'
  money?: boolean
  total?: boolean // totals row mein sum dikhana
  cls?: string
}

export function DataTable<T extends Record<string, unknown>>(props: {
  cols: Col<T>[]
  rows: T[]
  totals?: boolean
  empty?: string
  maxH?: string
}) {
  const { cols, rows, totals = true, empty = 'Data nahi mila — filter badal kar Refresh karein', maxH } = props
  const sumFor = (c: Col<T>): React.ReactNode => {
    if (!c.total) return null
    const s = rows.reduce((t, r) => t + (Number(r[c.key]) || 0), 0)
    return c.money ? fmtMoney(s) : fmtQty(s)
  }
  return (
    <div className={`overflow-auto rounded-xl border border-slate-200 bg-white shadow-sm ${maxH ?? 'max-h-[62vh]'}`}>
      <table className="w-full min-w-max text-xs">
        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur">
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={`whitespace-nowrap border-b border-slate-200 px-2.5 py-2 font-semibold text-slate-600 ${
                c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left'
              }`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={cols.length} className="px-3 py-10 text-center text-slate-400">{empty}</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-slate-100 transition-colors hover:bg-emerald-50/40">
              {cols.map((c) => (
                <td key={c.key} className={`whitespace-nowrap px-2.5 py-1.5 text-slate-700 ${
                  c.align === 'right' ? 'text-right font-medium tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'
                } ${c.cls ?? ''}`}>
                  {c.render ? c.render(r, i) : c.money ? fmtMoney(Number(r[c.key]) || 0) : String(r[c.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totals && rows.length > 0 && (
          <tfoot className="sticky bottom-0 z-10 bg-emerald-50/95 backdrop-blur">
            <tr>
              {cols.map((c) => (
                <td key={c.key} className={`whitespace-nowrap border-t border-emerald-200 px-2.5 py-2 font-bold text-emerald-800 ${
                  c.align === 'right' ? 'text-right tabular-nums' : c.align === 'center' ? 'text-center' : 'text-left'
                }`}>
                  {c.key === cols[0].key ? 'TOTAL' : sumFor(c) ?? ''}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}

// ---------------- CSV export ----------------
export function downloadCSV(filename: string, headers: string[], rows: (string | number)[][]) {
  const esc = (v: string | number) => {
    const s = String(v ?? '')
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const csv = '\uFEFF' + [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ---------------- Excel export (Task 69 — SheetJS .xlsx) ----------------
export interface ExportCol { label: string; align?: 'left' | 'right' | 'center'; money?: boolean }
export interface ExportSection {
  heading: string
  cols: ExportCol[]
  rows: (string | number)[][]
  totalsRow?: (string | number)[]
}
export interface ReportExportOpts {
  title: string
  subtitle?: string
  distributor: string
  period: string
  /** file name without extension — sab formats isi naam se save honge */
  filename: string
  cols: ExportCol[]
  rows: (string | number)[][]
  totalsRow?: (string | number)[]
  sections?: ExportSection[]
  footerNote?: string
  landscape?: boolean
}

const stampStr = () => new Date().toLocaleString('en-PK', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })

export function exportSections(opts: ReportExportOpts): ExportSection[] {
  return opts.sections ?? [{ heading: '', cols: opts.cols, rows: opts.rows, totalsRow: opts.totalsRow }]
}

/** "12,345.50" / 12345.5 dono se number — comma-safe */
function toNum(v: string | number | undefined): number {
  return Number(String(v ?? '').replace(/,/g, '').trim())
}

/** Money col ke cell ko number banayo (Excel sum/formula ke liye), warna string */
function excelCell(v: string | number | undefined, money: boolean): string | number {
  if (money) { const n = toNum(v); return Number.isFinite(n) ? n : 0 }
  return v ?? ''
}

export function downloadExcel(opts: ReportExportOpts) {
  const wb = XLSX.utils.book_new()
  const aoa: (string | number)[][] = [
    [opts.title],
    [opts.distributor],
    [`Period: ${opts.period}${opts.subtitle ? ` • ${opts.subtitle}` : ''}`],
    [`Generated: ${stampStr()} — DistriFlow`],
    [],
  ]
  // per-section: header row ki position + money col indexes — number formats isi range par lagenge
  const ranges: { headerRow: number; lastRow: number; moneyIdx: number[] }[] = []
  for (const s of exportSections(opts)) {
    if (s.heading) { aoa.push([]); aoa.push([s.heading]) }
    const headerRow = aoa.length
    aoa.push(s.cols.map((c) => c.label))
    const moneyIdx = s.cols.map((c, i) => (c.money ? i : -1)).filter((i) => i >= 0)
    for (const r of s.rows) aoa.push(r.map((v, i) => excelCell(v, moneyIdx.includes(i))))
    if (s.totalsRow) aoa.push(s.totalsRow.map((v, i) => excelCell(v, moneyIdx.includes(i))))
    ranges.push({ headerRow, lastRow: aoa.length - 1, moneyIdx })
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // money number format (#,##0.00) — sirf data/totals rows par
  for (const rg of ranges) {
    for (let R = rg.headerRow + 1; R <= rg.lastRow; R++) {
      for (const C of rg.moneyIdx) {
        const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })] as XLSX.CellObject | undefined
        if (cell && typeof cell.v === 'number') cell.z = '#,##0.00'
      }
    }
  }
  // column widths — max content length (cap 44)
  const widths: number[] = []
  for (const row of aoa) row.forEach((v, i) => {
    const l = String(v ?? '').length + 2
    widths[i] = Math.max(widths[i] ?? 8, Math.min(l, 44))
  })
  ws['!cols'] = widths.map((wch) => ({ wch }))
  XLSX.utils.book_append_sheet(wb, ws, 'Report')
  XLSX.writeFile(wb, `${opts.filename}.xlsx`)
}

// ---------------- PDF export (Task 69 — jsPDF + autotable) ----------------
export function downloadPDF(opts: ReportExportOpts) {
  const tables = exportSections(opts)
  const landscape = opts.landscape ?? (opts.cols.length > 9 || tables.some((t) => t.cols.length > 9))
  const doc = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
  const pw = doc.internal.pageSize.getWidth()
  const pdfCell = (v: string | number | undefined, money?: boolean) => {
    if (!money || v === '' || v === undefined || v === null) return String(v ?? '')
    const n = toNum(v)
    return Number.isFinite(n) ? fmtMoney(n) : String(v)
  }

  // header block
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor('#065f46')
  doc.text(opts.title, 14, 15)
  doc.setFontSize(11); doc.setTextColor('#0f172a')
  doc.text(opts.distributor, 14, 21)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor('#64748b')
  doc.text(`Period: ${opts.period}${opts.subtitle ? ` • ${opts.subtitle}` : ''} • Generated: ${stampStr()} — DistriFlow`, 14, 26)
  doc.setDrawColor('#059669'); doc.setLineWidth(0.5); doc.line(14, 28.5, pw - 14, 28.5)

  let startY = 34
  for (const s of tables) {
    if (s.heading) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor('#065f46')
      doc.text(s.heading, 14, startY)
      startY += 5
    }
    autoTable(doc, {
      head: [s.cols.map((c) => c.label)],
      body: s.rows.map((r) => r.map((v, i) => pdfCell(v, s.cols[i]?.money))),
      foot: s.totalsRow ? [s.totalsRow.map((v, i) => pdfCell(v, s.cols[i]?.money))] : undefined,
      startY,
      margin: { left: 14, right: 14, top: 18 },
      styles: { fontSize: 7.5, cellPadding: 1.6, lineColor: '#e5e7eb', lineWidth: 0.1 },
      headStyles: { fillColor: '#ecfdf5', textColor: '#065f46', fontStyle: 'bold', lineColor: '#d1d5db' },
      footStyles: { fillColor: '#ecfdf5', textColor: '#065f46', fontStyle: 'bold', lineColor: '#059669', lineWidth: 0.2 },
      alternateRowStyles: { fillColor: '#f8fafc' },
      columnStyles: Object.fromEntries(s.cols.map((c, i) => [i, { halign: c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left' }])),
    })
    const la = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable
    startY = (la?.finalY ?? startY) + 7
  }
  if (opts.footerNote) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor('#475569')
    doc.text(opts.footerNote, 14, startY + 1, { maxWidth: pw - 28 })
  }
  // har page par footer
  const pages = doc.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    doc.setFontSize(7); doc.setTextColor('#94a3b8')
    doc.text('DistriFlow — FMCG Distribution Management', 14, doc.internal.pageSize.getHeight() - 7)
    doc.text(`Page ${p}/${pages} • Signature: ____________________`, pw - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' })
  }
  doc.save(`${opts.filename}.pdf`)
}

// ---------------- Export buttons (Task 69 — Excel + PDF + CSV + Print) ----------------
const expBtn = 'flex h-9 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors'

export function ExportButtons({ opts, printLabel }: { opts: ReportExportOpts; printLabel?: string }) {
  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => downloadExcel(opts)}
        title="Excel (.xlsx) download karein — numbers proper Excel cells mein honge"
        className={`${expBtn} border border-emerald-600 bg-emerald-600 text-white shadow-sm hover:bg-emerald-700`}
      >
        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
      </button>
      <button
        onClick={() => downloadPDF(opts)}
        title="PDF download karein — header, table aur totals ke sath"
        className={`${expBtn} border border-rose-500 bg-rose-500 text-white shadow-sm hover:bg-rose-600`}
      >
        <FileDown className="h-3.5 w-3.5" /> PDF
      </button>
      <button
        onClick={() => downloadCSV(opts.filename, exportSections(opts)[0].cols.map((c) => c.label), [
          ...exportSections(opts)[0].rows,
          ...(exportSections(opts)[0].totalsRow ? [exportSections(opts)[0].totalsRow as (string | number)[]] : []),
        ])}
        title="CSV download karein"
        className={`${expBtn} border border-slate-200 bg-white text-slate-600 hover:border-emerald-300 hover:text-emerald-700`}
      >
        <Download className="h-3.5 w-3.5" /> CSV
      </button>
      <PrintButton onClick={() => printReport(opts)} label={printLabel} />
    </div>
  )
}

export function CSVButton(props: { onClick: () => void; label?: string }) {
  return (
    <button onClick={props.onClick} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700">
      <Download className="h-3.5 w-3.5" /> {props.label ?? 'CSV'}
    </button>
  )
}

// ---------------- Print (naye window mein — app CSS se azad) ----------------
export function printReport(opts: {
  title: string
  subtitle?: string
  distributor: string
  period: string
  cols: { label: string; align?: 'left' | 'right' | 'center' }[]
  rows: (string | number)[][]
  totalsRow?: (string | number)[]
  sections?: { heading: string; cols: { label: string; align?: 'left' | 'right' | 'center' }[]; rows: (string | number)[][]; totalsRow?: (string | number)[] }[]
  footerNote?: string
}) {
  const w = window.open('', '_blank', 'width=1200,height=800')
  if (!w) { alert('Print window block ho gaya — popup allow karein'); return }
  const th = (c: { label: string; align?: string }) => `<th style="text-align:${c.align === 'right' ? 'right' : c.align === 'center' ? 'center' : 'left'}">${c.label}</th>`
  const tr = (r: (string | number)[], tds: { align?: string }[], bold = false) =>
    `<tr${bold ? ' class="tot"' : ''}>${r.map((v, i) => `<td style="text-align:${tds[i]?.align === 'right' ? 'right' : tds[i]?.align === 'center' ? 'center' : 'left'}">${v ?? ''}</td>`).join('')}</tr>`
  const table = (cols: { label: string; align?: string }[], rows: (string | number)[][], totals?: (string | number)[]) => `
    <table>
      <thead><tr>${cols.map(th).join('')}</tr></thead>
      <tbody>${rows.map((r) => tr(r, cols)).join('')}</tbody>
      ${totals ? `<tfoot>${tr(totals, cols, true)}</tfoot>` : ''}
    </table>`
  const sectionsHtml = opts.sections?.map((s) => `<h3>${s.heading}</h3>${table(s.cols, s.rows, s.totalsRow)}`).join('') ?? ''
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${opts.title} — DistriFlow</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', Arial, sans-serif; margin: 24px; color: #0f172a; }
    .hdr { border-bottom: 3px solid #059669; padding-bottom: 10px; margin-bottom: 14px; }
    .hdr h1 { margin: 0; font-size: 20px; color: #065f46; }
    .hdr .biz { font-size: 15px; font-weight: 700; margin-top: 2px; }
    .hdr .meta { font-size: 11px; color: #64748b; margin-top: 3px; }
    h3 { font-size: 13px; color: #065f46; margin: 18px 0 6px; border-left: 3px solid #10b981; padding-left: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
    th { background: #ecfdf5; color: #065f46; border: 1px solid #d1d5db; padding: 5px 7px; }
    td { border: 1px solid #e5e7eb; padding: 4px 7px; }
    tbody tr:nth-child(even) { background: #f8fafc; }
    .tot td { background: #ecfdf5; font-weight: 700; border-top: 2px solid #059669; }
    .foot { margin-top: 26px; display: flex; justify-content: space-between; font-size: 10px; color: #64748b; }
    .note { margin-top: 10px; font-size: 10.5px; color: #475569; font-style: italic; }
    @page { size: A4 ${opts.cols.length > 9 ? 'landscape' : 'portrait'}; margin: 12mm; }
  </style></head><body>
  <div class="hdr">
    <h1>${opts.title}</h1>
    <div class="biz">${opts.distributor}</div>
    <div class="meta">Period: ${opts.period}${opts.subtitle ? ` • ${opts.subtitle}` : ''} • Generated: ${new Date().toLocaleString('en-PK')} — DistriFlow</div>
  </div>
  ${opts.sections ? sectionsHtml : table(opts.cols, opts.rows, opts.totalsRow)}
  ${opts.footerNote ? `<div class="note">${opts.footerNote}</div>` : ''}
  <div class="foot"><span>DistriFlow — FMCG Distribution Management</span><span>Signature: ____________________</span></div>
  <script>window.onload = () => setTimeout(() => window.print(), 300)</script>
  </body></html>`)
  w.document.close()
}

export function PrintButton(props: { onClick: () => void; label?: string }) {
  return (
    <button onClick={props.onClick} className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-emerald-300 hover:text-emerald-700">
      <Printer className="h-3.5 w-3.5" /> {props.label ?? 'Print'}
    </button>
  )
}

export function SectionCard({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-700">
          <span className="h-4 w-1 rounded-full bg-gradient-to-b from-emerald-500 to-teal-400" /> {title}
        </h3>
        {right}
      </div>
      {children}
    </div>
  )
}

/** Report fetch hook — deps change par auto reload + manual refresh */
export function useReport<T>(fetcher: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)
  useEffect(() => {
    let alive = true
    // setState ko async chain mein rakha hai (react-hooks/set-state-in-effect rule)
    Promise.resolve().then(() => {
      if (!alive) return
      setLoading(true)
      return fetcher()
        .then((d) => { if (alive) setData(d) })
        .catch(() => { if (alive) setData(null) })
        .finally(() => { if (alive) setLoading(false) })
    })
    return () => { alive = false }
  }, [...deps, tick])
  return { data, loading, refresh }
}
