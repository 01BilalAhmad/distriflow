'use client'

/**
 * CBL-style print documents — same-to-same design as the uploaded samples:
 *  1. CblLoadFormDoc  — Load Form: product load sheet + customers sheet + signatures (3 pages)
 *  2. CblInvoiceDoc   — CASH MEMO / INVOICE: distributor header, Urdu tagline,
 *                       GST-style item table, Promotions Applied, totals box, 3 signature boxes
 * PrintFrame = on-screen A4 preview overlay with Print + Export PDF (browser print-to-PDF).
 */

import { createPortal } from 'react-dom'
import { Fragment, useEffect, useRef, useState } from 'react'
import { RemoveScroll } from 'react-remove-scroll'
import { Button } from '@/components/ui/button'
import { Printer, Download, FileDown, Loader2, X } from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { fmtQty } from '@/components/dms/unit-qty'
import type { SummaryDetailDTO, SummaryOrderDTO } from '@/lib/dms-types'

// ---------- formatting helpers ----------
const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtI = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
// Bara amount (>= 100k) print cell mein 2 decimals ke sath column overflow/overlap karta hai —
// wahan sirf whole number (commas ke sath) print karte hain, totals box poori precision rakhta hai.
// (Task 34: threshold 1M se 100k kiya — 327,680.00 jaisi values bhi ab cell mein fit hoti hain)
const fmtCell = (v: number, dec: 0 | 2) => (dec === 2 && Math.abs(v) >= 100_000 ? fmtI(v) : dec === 2 ? fmt2(v) : fmtI(v))
const dash = <td className="dash">-</td>
// fit = column ki delivered px capacity (chars mein). Value is se lambi ho to cell font
// 7.4px kar dete hain — amount KABHI column se bahir nahi jati (Task 34).
const Num = ({ v, dec = 0, compact = false, fit }: { v: number | null | undefined; dec?: 0 | 2; compact?: boolean; fit?: number }) => {
  if (v === null || v === undefined || v === 0) return dash
  const s = compact ? fmtCell(v, dec) : dec === 2 ? fmt2(v) : fmtI(v)
  return <td className="num" style={fit && s.length > fit ? { fontSize: 7.4 } : undefined}>{s}</td>
}
const iso = (d: string | Date) => new Date(d).toISOString().slice(0, 10)
const printDate = () => {
  const d = new Date()
  const date = d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase()
  return `${date} ${time}`
}
const dayDate = (d: string | Date) => {
  const dt = new Date(d)
  const day = dt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const wd = dt.toLocaleDateString('en-US', { weekday: 'long' })
  return `${day}/${wd}`
}
const ORDER_STATUS: Record<string, string> = {
  CONFIRMED: 'Confirmed', PROCESSING: 'Open', DELIVERED: 'Delivered',
  PARTIALLY_DELIVERED: 'Partial', CANCELLED: 'Cancelled',
}

// ---------- print frame (preview overlay) ----------
const PRINT_OPEN_EVT = 'cbl-print-open'

/**
 * PDF libs (html2canvas-pro + jsPDF) — module-level cache taake:
 *  1. Preview khulte hi background preload ho sake (slow mobile network par
 *     user ke tap karne tak chunks load ho chuke hote hain)
 *  2. doDownloadPdf wahi promise reuse kare — double import nahi
 *  3. Fail hone par cache reset — agla tap retry kar sakta hai
 */
let pdfLibs: Promise<{ h: typeof import('html2canvas-pro').default; j: typeof import('jspdf') }> | null = null
function loadPdfLibs() {
  if (!pdfLibs) {
    pdfLibs = Promise.all([import('html2canvas-pro'), import('jspdf')])
      .then(([h, j]) => ({ h: h.default, j }))
      .catch((e) => { pdfLibs = null; throw e })
  }
  return pdfLibs
}

/**
 * PrintFrame ek plain portal hai (Radix DismissableLayer stack ka hissa nahi) —
 * is liye jab print preview khula hota hai, background Radix Dialog ke liye
 * har click/Escape "outside interact" ban jata hai aur wo khud bhi band ho jati.
 * Ye props DialogContent par spread karein: preview khula ho to dialog dismiss nahi hogi.
 */
export const keepDialogBehind = {
  onInteractOutside: (e: { preventDefault: () => void }) => {
    if (document.body.classList.contains('has-cbl-print')) e.preventDefault()
  },
  onEscapeKeyDown: (e: { preventDefault: () => void }) => {
    if (document.body.classList.contains('has-cbl-print')) e.preventDefault()
  },
}

export function PrintFrame({ title, onClose, pdfName, children }: {
  title: string
  onClose: () => void
  /** filename (bina .pdf) direct download ke liye — default title se slug banta hai */
  pdfName?: string
  children: React.ReactNode
}) {
  const idRef = useRef(0)
  if (idRef.current === 0) idRef.current = Math.random()
  const rootRef = useRef<HTMLElement | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)

  // sirf EK preview ek waqt mein — naya khule to purana band + Escape se band
  useEffect(() => {
    document.body.classList.add('has-cbl-print')
    const onOther = (e: Event) => {
      if ((e as CustomEvent).detail !== idRef.current) onClose()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.dispatchEvent(new CustomEvent(PRINT_OPEN_EVT, { detail: idRef.current }))
    window.addEventListener(PRINT_OPEN_EVT, onOther)
    window.addEventListener('keydown', onKey)
    // PDF chunks background preload (mobile/slow network) — tap se pehle ready
    const warm = setTimeout(() => { loadPdfLibs().catch(() => {}) }, 600)
    return () => {
      document.body.classList.remove('has-cbl-print')
      window.removeEventListener(PRINT_OPEN_EVT, onOther)
      window.removeEventListener('keydown', onKey)
      clearTimeout(warm)
    }
  }, [onClose])

  function doPrint() { window.print() }
  function doExport() {
    toast({ title: 'Export PDF', description: "Print dialog khulega — destination mein 'Save as PDF' select karein" })
    setTimeout(() => window.print(), 350)
  }

  /** Direct PDF download — print dialog ke bina (in-app webviews / mobile jahan window.print() block hota hai) */
  async function doDownloadPdf() {
    const root = rootRef.current
    if (!root || pdfBusy) return
    const pages = [...root.querySelectorAll('.cbl-page')] as HTMLElement[]
    if (pages.length === 0) {
      toast({ title: 'PDF export failed', description: 'Koi printable page nahi mila', variant: 'destructive' })
      return
    }
    setPdfBusy(true)
    toast({ title: 'PDF ban rahi hai...', description: `${pages.length} page(s) capture ho rahe hain — thora wait karein` })
    try {
      const { h: html2canvas, j: { jsPDF } } = await loadPdfLibs()
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' })
      for (let i = 0; i < pages.length; i++) {
        const canvas = await html2canvas(pages[i], {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
          logging: false,
          onclone: (doc) => {
            doc.querySelectorAll('.cbl-page').forEach((el) => { (el as HTMLElement).style.boxShadow = 'none' })
            // invoice link styling (green underline) sirf screen preview ke liye — PDF plain black rakhta hai
            doc.querySelectorAll('.cbl-inv-link').forEach((el) => { el.classList.remove('cbl-inv-link') })
          },
        })
        const img = canvas.toDataURL('image/jpeg', 0.92)
        let iw = 210 // A4 width mm
        let ih = (canvas.height * iw) / canvas.width
        if (ih > 297) { ih = 297; iw = (canvas.width * ih) / canvas.height }
        if (i > 0) pdf.addPage()
        pdf.addImage(img, 'JPEG', (210 - iw) / 2, 0, iw, ih)
      }
      const name = (pdfName ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'document'
      pdf.save(`${name}.pdf`)
      toast({ title: 'PDF download ho gayi ✓', description: `${pages.length} page(s) — seedhi file mili hai, print dialog nahi laga` })
    } catch (e) {
      console.error('PDF download failed:', e)
      toast({ title: 'PDF export failed', description: e instanceof Error ? e.message : 'Unknown error', variant: 'destructive' })
    } finally { setPdfBusy(false) }
  }

  return createPortal(
    <RemoveScroll
      ref={rootRef}
      allowPinchZoom
      className="cbl-print-root pointer-events-auto fixed inset-0 z-[100] overflow-auto bg-slate-900/70 p-4 sm:p-6"
    >
      <div className="cbl-no-print mx-auto mb-4 flex max-w-[860px] flex-wrap items-center justify-between gap-2 sticky top-0 z-10 rounded-lg border border-slate-200 bg-white px-4 py-2.5 shadow-lg">
        <p className="text-sm font-bold text-slate-800">{title} <span className="font-normal text-slate-400">— A4 Print Preview</span></p>
        <div className="flex gap-2">
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={doPrint}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
          <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700" onClick={doExport}>
            <Download className="h-4 w-4 mr-1.5" /> Print to PDF
          </Button>
          <Button size="sm" variant="outline" className="border-violet-300 text-violet-700 hover:bg-violet-50" onClick={doDownloadPdf} disabled={pdfBusy}>
            {pdfBusy ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <FileDown className="h-4 w-4 mr-1.5" />} Download PDF
          </Button>
          <Button size="sm" variant="outline" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>
      </div>
      {/* A4 pages FIXED 794px (globals.css .cbl-page) — chhote screen par overlay scroll karta hai,
          lekin document ka layout kabhi squeeze nahi hota -> PDF/print hamesha preview jaisa */}
      <div className="mx-auto w-[794px] shadow-2xl">{children}</div>
      <div className="cbl-no-print h-8" />
    </RemoveScroll>,
    document.body,
  )
}

// ============================================================
// 1) LOAD FORM — 3 pages (products load + customers sheet + signatures)
// ============================================================
export function CblLoadFormDoc({ detail, onInvoiceClick }: { detail: SummaryDetailDTO; onInvoiceClick?: (o: SummaryOrderDTO) => void }) {
  const settled = detail.status === 'SETTLED'

  // group products by brand (CBL: BISCUITS etc.)
  const groups: { brand: string; rows: typeof detail.products }[] = []
  for (const p of detail.products) {
    const g = groups.find((x) => x.brand === p.brand)
    if (g) g.rows.push(p)
    else groups.push({ brand: p.brand || 'OTHERS', rows: [p] })
  }

  const totIssued = detail.products.reduce((s, p) => s + p.qty, 0) // PIECES — bill wale units
  const totFree = detail.products.reduce((s, p) => s + p.freeQty, 0)
  // Task 32b fix: 'Total Issued' (Units/Box/Cartons) section ab PACK BREAKDOWN hai —
  // kul van load (bill + free) ko toda jata hai: poore cartons + poore boxes + khule pcs.
  // Pehle 'Units' cell mein poora pcs count dobara likha jata tha — is liye har row mein
  // 'Issued Units' ka duplicate nazar aata tha (user: "1 ctn 1 pc aana chahiye").
  // Misal: 73 pcs @ 72/ctn => Units 1, Box 0, Cartons 1 (1 carton + 1 khula pc).
  const packParts = (p: typeof detail.products[number]) => {
    const upc = Math.max(1, p.unitsPerCarton)
    const tu = p.qty + p.freeQty
    const ctn = Math.floor(tu / upc)
    const rem = tu % upc
    const box = p.pcsPerBox > 0 ? Math.floor(rem / p.pcsPerBox) : 0
    const loose = p.pcsPerBox > 0 ? rem % p.pcsPerBox : rem
    return { ctn, box, loose }
  }
  const packTotals = detail.products.reduce(
    (a, p) => {
      const x = packParts(p)
      return { ctn: a.ctn + x.ctn, box: a.box + x.box, loose: a.loose + x.loose }
    },
    { ctn: 0, box: 0, loose: 0 },
  )
  const totAmount = detail.orders.reduce((s, o) => s + o.total, 0)
  const custUnits = detail.orders.map((o) => ({
    issued: o.items.reduce((s, it) => s + it.qty, 0), // PIECES
    free: o.items.reduce((s, it) => s + it.freeQty, 0),
  }))
  const custIssuedTotal = custUnits.reduce((s, x) => s + x.issued, 0)
  const custFreeTotal = custUnits.reduce((s, x) => s + x.free, 0)

  return (
    <div className="cbl-doc">
      {/* ---------------- PAGE 1: product load sheet ---------------- */}
      <div className="cbl-page bg-white px-7 py-6">
        <div className="mb-4 flex items-start">
          {/* brand block logo */}
          <div className="flex h-16 w-16 items-center justify-center rounded-md border-2 border-red-600 bg-red-600 text-4xl font-black text-white" style={{ fontFamily: 'Arial Black, Arial' }}>
            {detail.distributorName.charAt(0).toUpperCase()}
          </div>
        </div>

        <h1 className="mb-4 text-center text-[19px] font-bold tracking-tight">
          Load Form [ {detail.summaryNo} ] - {settled ? 'Settled' : 'Open'}
        </h1>

        {/* header info box */}
        <table className="mb-4" style={{ borderWidth: 2 }}>
          <tbody>
            <tr>
              <td style={{ border: 'none', width: '52%' }}>
                <table><tbody>
                  <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 10 }}>Deliveryman:</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{detail.salesmanName} RW [ {detail.salesmanId.slice(-6).toUpperCase()} ]</td></tr>
                  <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 10 }}>PJP Name:</td><td style={{ border: 'none' }}>{detail.warehouseName} Route, Planned PJP</td></tr>
                  <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 10 }}>Order Booker:</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{detail.salesmanName} [ {detail.salesmanId.slice(-6).toUpperCase()} ]</td></tr>
                </tbody></table>
              </td>
              <td style={{ border: 'none' }}>
                <table><tbody>
                  <tr><td style={{ border: 'none', width: 90, fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap', paddingRight: 10 }}>For Date:</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{iso(detail.deliveryDate)}</td></tr>
                  <tr><td style={{ border: 'none', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap', paddingRight: 10 }}>PJP Date:</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{iso(detail.orderDate)}</td></tr>
                  <tr><td style={{ border: 'none', fontWeight: 'bold', textAlign: 'right', whiteSpace: 'nowrap', paddingRight: 10 }}>Print Date:</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{printDate()}</td></tr>
                </tbody></table>
              </td>
            </tr>
          </tbody>
        </table>

        <table style={{ fontSize: 10.5 }}>
          <colgroup>
            <col style={{ width: '30%' }} /><col style={{ width: '10%' }} /><col style={{ width: '7%' }} /><col style={{ width: '7%' }} />
            <col style={{ width: '6.5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '6.5%' }} />
            <col style={{ width: '6.5%' }} /><col style={{ width: '6.5%' }} /><col style={{ width: '6.5%' }} />
            <col style={{ width: '7%' }} />
          </colgroup>
          <thead>
            <tr>
              <th rowSpan={2} style={{ textAlign: 'left' }}>SKU</th>
              <th rowSpan={2}>SKU Manufacturer Code</th>
              <th rowSpan={2}>Issued Units</th>
              <th rowSpan={2}>Issued Free Units</th>
              <th colSpan={3} style={{ backgroundColor: '#f0f0f0' }}>Total Issued</th>
              <th colSpan={3} style={{ backgroundColor: '#f0f0f0' }}>Total Returned</th>
              <th rowSpan={2} style={{ width: '7%' }}>Sale</th>
            </tr>
            <tr>
              <th>Units</th><th>Box</th><th>Cartons</th>
              <th>Units</th><th>Box</th><th>Cartons</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <Fragment key={`g-${g.brand}`}>
                <tr>
                  <td colSpan={11} className="font-bold" style={{ textAlign: 'left', backgroundColor: '#fff' }}>{g.brand.toUpperCase()}</td>
                </tr>
                {g.rows.map((p) => {
                  // qty = bill wale PIECES (invoice par yahi lagte hain), freeQty = scheme free.
                  // Total Issued section = PACK BREAKDOWN (carton/box/loose pcs) — pcs total NAHI
                  const units = p.qty
                  const free = p.freeQty
                  const { ctn: ctnPart, box: boxPart, loose: loosePart } = packParts(p)
                  return (
                    <tr key={p.productId} className="cbl-break-avoid">
                      <td style={{ textAlign: 'left' }}>{p.name} [ {p.sku} ]</td>
                      <td className="ctr">{p.sku}</td>
                      <Num v={units} />
                      <Num v={free} />
                      <Num v={loosePart} />
                      <Num v={boxPart} /><Num v={ctnPart} />
                      {dash}{dash}{dash}
                      <Num v={units} />
                    </tr>
                  )
                })}
              </Fragment>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td colSpan={2} style={{ textAlign: 'right' }}>Total</td>
              <Num v={totIssued} />
              <Num v={totFree} />
              <Num v={packTotals.loose} />
              <Num v={packTotals.box} /><Num v={packTotals.ctn} />
              {dash}{dash}{dash}
              <Num v={totIssued} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- PAGE 2: customers sheet ---------------- */}
      <div className="cbl-page bg-white px-7 py-6">
        <table style={{ fontSize: 10.5 }}>
          <colgroup>
            <col style={{ width: '4%' }} /><col style={{ width: '11%' }} /><col style={{ width: '24%' }} /><col style={{ width: '9%' }} />
            <col style={{ width: '7%' }} /><col style={{ width: '7%' }} /><col style={{ width: '6%' }} />
            <col style={{ width: '7%' }} /><col style={{ width: '9%' }} /><col style={{ width: '7%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>S. No#</th>
              <th>Invoice Number</th>
              <th style={{ textAlign: 'left' }}>Store Name / Owner Name</th>
              <th>Order Booker</th>
              <th>Status</th>
              <th>Issued Units</th>
              <th>Issued Free Units</th>
              <th>Total Issued Units</th>
              <th>( Returned - Extra ) Units</th>
              <th>Sales</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {detail.orders.map((o, i) => (
              <tr key={o.id} className="cbl-break-avoid">
                <td className="ctr">{i + 1}</td>
                <td className="ctr">
                  {/* Invoice number clickable (screen preview) — click = sirf yehi invoice A4 preview khulti hai,
                      load form preview apne aap band (PrintFrame single-preview event). Print/PDF mein plain text. */}
                  <span
                    className={onInvoiceClick ? 'cbl-inv-link' : undefined}
                    title={onInvoiceClick ? 'Click = sirf yehi invoice khulegi' : undefined}
                    onClick={onInvoiceClick ? () => onInvoiceClick(o) : undefined}
                  >{o.orderNo}</span>
                </td>
                <td style={{ textAlign: 'left' }}>
                  {(o.outletName + (o.address ? ` - ${o.address}` : '')).toUpperCase()} / {o.ownerName ?? o.outletName}
                </td>
                <td style={{ textAlign: 'center' }}>{detail.salesmanName}[OB]</td>
                <td className="ctr">{ORDER_STATUS[o.status] ?? o.status}</td>
                <Num v={custUnits[i].issued} />
                <Num v={custUnits[i].free} />
                <Num v={custUnits[i].issued + custUnits[i].free} />
                {dash}
                <Num v={custUnits[i].issued} />
                <Num v={o.total} />
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td colSpan={5} style={{ textAlign: 'right' }}>Total</td>
              <Num v={custIssuedTotal} />
              <Num v={custFreeTotal} />
              <Num v={custIssuedTotal + custFreeTotal} />
              {dash}
              <Num v={custIssuedTotal} />
              <Num v={totAmount} />
            </tr>
          </tbody>
        </table>
      </div>

      {/* ---------------- PAGE 3: signatures ---------------- */}
      <div className="cbl-page bg-white px-7 py-6">
        <div className="mt-40 flex justify-between px-8">
          <div className="w-56 text-center">
            <div style={{ borderBottom: '1px dotted #000' }} className="mb-1.5">&nbsp;</div>
            <p className="text-[12px]">(Deliveryman Signature)</p>
          </div>
          <div className="w-56 text-center">
            <div style={{ borderBottom: '1px dotted #000' }} className="mb-1.5">&nbsp;</div>
            <p className="text-[12px]">(Stock Keeper Signature)</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 2) CASH MEMO / INVOICE — per-shop
// ============================================================
export interface InvoiceItemData {
  id: string
  productName: string
  sku: string
  unitsPerCarton?: number
  boxesPerCarton?: number
  pcsPerBox?: number
  consumerPrice?: number | null
  // Task 37: per-product GST — product ke apne rate se bill print hota hai
  // (purane data par global Tax Settings fallback hota hai)
  gstEnabled?: boolean
  gstRate?: number | null
  qty: number // PIECES (base unit)
  freeQty: number // PIECES
  rate: number // per PIECE
  discount: number
  lineTotal: number
  schemeName?: string | null
}
export interface InvoiceData {
  orderNo: string
  outlet: { name: string; code: string; channel: string; address: string | null; ownerName?: string | null; ntn?: string | null; cnic?: string | null }
  salesmanName: string | null
  distributorName: string
  distributorCity?: string | null
  summaryNo?: string | null
  status: string
  subtotal: number
  schemeDiscount: number
  manualDiscount?: number
  manualDiscType?: string | null
  manualDiscValue?: number | null
  total: number
  /** Task 45: GST + Trade Order totals — grand payable = total − TO + GST + advTax */
  tradeOfferTotal?: number
  gstTotal?: number
  /** Advance Tax — shop ke filer status ke hisab se (booking snapshot, bill par add) */
  advanceTax?: number
  advanceTaxRate?: number | null
  filerStatus?: string | null
  orderDate: string
  items: InvoiceItemData[]
}

export function CblInvoiceDoc({ inv, gst }: { inv: InvoiceData; gst?: { enabled: boolean; rate: number } }) {
  // Task 37: PER-PRODUCT GST — har item apne product ke rate se split hota hai (product form se
  // set hota hai). Global Tax Settings (gst prop) sirf purane data ka fallback hai jab item par
  // gst fields na hon. gstEnabled=false wale rows par GST columns dash print hote hain.
  const gstOn = gst ? gst.enabled : true // settings na mile to default ON (18%)
  const gstRate = gst?.rate ?? 18
  const GFALL = gstOn ? gstRate / 100 : 0
  const rows = inv.items.map((it) => {
    const upc = it.unitsPerCarton ?? 0
    const ppb = it.pcsPerBox && it.pcsPerBox > 0 ? it.pcsPerBox : 0
    const cpp = it.consumerPrice ?? 0 // retail PER PIECE (incl GST)
    const gross = it.qty * it.rate
    const hasRp = cpp > 0
    // per-row GST fraction — product ka apna rate, warna global fallback
    const G = it.gstEnabled === false ? 0 : (it.gstRate != null && Number.isFinite(Number(it.gstRate)) ? Number(it.gstRate) / 100 : GFALL)
    const K = G / (1 + G)
    // qty PIECES hai — CTN / Box / Units breakdown
    const ctn = upc > 0 ? Math.floor(it.qty / upc) : 0
    const rem = upc > 0 ? it.qty % upc : 0
    const box = ppb > 0 ? Math.floor(rem / ppb) : 0
    const pcs = ppb > 0 ? rem % ppb : rem
    // RP value = qty (pcs) × retail PER PIECE — pehle qty × retail-per-CARTON ho raha tha
    // jo Task 17 (qty carton -> pieces) ke baad unitsPerCarton se DOUBLE multiply karta tha
    // -> 9-10 digit values print columns mein overlap karti thin
    const rpIncl = hasRp ? it.qty * cpp : null
    const rpExcl = hasRp ? rpIncl! / (1 + G) : null
    const gstRp = hasRp && G > 0 ? rpIncl! - rpExcl! : null
    // "GST @ X% per Box" = ek box ke retail ka G/(1+G) hissa (box level na ho to per carton)
    const gstBox = hasRp && G > 0 ? cpp * (ppb > 0 ? ppb : upc) * K : null
    return {
      it,
      upc,
      gross,
      ctn, box, pcs,
      G,
      rpIncl, rpExcl, gstRp, gstBox,
    }
  })
  // Task 37: bill-level visibility — koi EK bhi row par GST ho to GST columns aayenge.
  // Sab GST-wale rows ka ek hi rate ho to headers "@ X%" dikhate hain; mixed rates par generic.
  const gstRows = rows.filter((r) => r.G > 0)
  const anyGst = gstRows.length > 0
  const rateLabel = (pct: number) => String(Math.round(pct * 100) / 100)
  const rateSet = new Set(gstRows.map((r) => rateLabel(r.G * 100)))
  const singleRate = rateSet.size === 1 ? [...rateSet][0] : null
  const S = {
    ctn: rows.reduce((s, r) => s + r.ctn, 0),
    box: rows.reduce((s, r) => s + r.box, 0),
    pcs: rows.reduce((s, r) => s + r.pcs, 0),
    // Task 33: bill par free units visible — Load Form ke 'Issued Free Units' ka invoice counterpart.
    // Pehle bill par free ka koi asar nahi hota tha, is liye pata nahi chalta tha kis bill par scheme free lagi.
    free: rows.reduce((s, r) => s + r.it.freeQty, 0),
    grossExcl: rows.reduce((s, r) => s + r.gross, 0),
    rpExcl: rows.reduce((s, r) => s + (r.rpExcl ?? 0), 0),
    gstRp: rows.reduce((s, r) => s + (r.gstRp ?? 0), 0),
    rpIncl: rows.reduce((s, r) => s + (r.rpIncl ?? 0), 0),
    gstBox: rows.reduce((s, r) => s + (r.gstBox ?? 0), 0),
    gross: rows.reduce((s, r) => s + r.gross, 0),
    discount: rows.reduce((s, r) => s + r.it.discount, 0),
    manual: inv.manualDiscount ?? 0,
    net: rows.reduce((s, r) => s + r.it.lineTotal, 0),
  }
  // Task 34: DATA-AWARE column widths — "jitni bari amount, column wysy wysy adjust ho".
  // Pehle static % colgroup thi: baray amounts (337,680.00) apne column se bahir nikal jate the
  // (.num nowrap + table-layout fixed = overflow visible). Neeche WATER-FILLING: har column
  // apna content-need pakka leta hai, bachi jagah value-length ke hisab se banti hai. Har
  // invoice apne data ke hisab se apni widths leta hai. Amount >= 100k cell mein decimals
  // drop (fmtCell), aur phir bhi fit na ho to Num ka fit prop us cell ka font 7.4px kar deta hai.
  const numStr = (v: number | null | undefined, dec: 0 | 2 = 0, compact = false): string =>
    v === null || v === undefined || v === 0 ? '-' : compact ? fmtCell(v, dec) : dec === 2 ? fmt2(v) : fmtI(v)
  const colSpecs: { key?: string; hw: number; vl: number; min: number; d: number; need: number }[] = []
  // Arial bold @8.6px real glyph widths (approx): digits/lowercase 4.8, caps/symbols 6.2, seps 2.4 —
  // pehle uniform per-char model tha jo "CTN" jaise CAPS headers ko underestimate karta tha
  const textW = (s: string) =>
    [...s].reduce((a, ch) => a + (/[.,:]/.test(ch) ? 2.4 : /[0-9a-z/-]/.test(ch) ? 4.8 : 6.2), 0)
  const addCol = (vals: string[], header: string, key?: string, min = 20) => {
    const hw = header.split(' ').reduce((a, w) => Math.max(a, textW(w)), 0) // header ka sab se lambe WORD ka width
    const vl = vals.reduce((a, s) => Math.max(a, textW(s)), 0) // sab se lambi RENDERED value (no-wrap)
    const need = Math.max(min, Math.max(hw, vl) + 11) // + padding 8 + border 2 + margin 1
    const raw = Math.max(hw, vl) * 1.15 + 12 // data-bhook demand (slack share ke liye)
    colSpecs.push({ key, hw, vl, min, d: Math.max(need, raw), need })
  }
  addCol([], 'Item / Product Name', undefined, 76) // name wrap hota hai — flat min
  addCol([...rows.map((r) => numStr(r.ctn)), numStr(S.ctn)], 'CTN', 'ctn')
  addCol([...rows.map((r) => numStr(r.box)), numStr(S.box)], 'Box', 'box')
  addCol([...rows.map((r) => numStr(r.pcs)), numStr(S.pcs)], 'Pcs', 'pcs')
  addCol([...rows.map((r) => numStr(r.it.freeQty)), numStr(S.free)], 'Free', 'free')
  addCol(rows.map((r) => numStr(r.it.rate, 2)), 'Rate/ Unit Excl: GST', 'rate')
  addCol([...rows.map((r) => numStr(r.gross, 2, true)), numStr(S.grossExcl, 2, true)], 'Total Value Excl: GST', 'totval')
  addCol([...rows.map((r) => numStr(r.rpExcl, 2, true)), numStr(S.rpExcl, 2, true)], 'RP Value Excl: Gst', 'rpexcl')
  if (anyGst) {
    addCol([...rows.map((r) => numStr(r.gstRp, 2, true)), numStr(S.gstRp, 2, true)], `GST on RP Value${singleRate ? ` @ ${singleRate}%` : ''}`, 'gstrp')
    addCol([...rows.map((r) => numStr(r.rpIncl, 2, true)), numStr(S.rpIncl, 2, true)], 'RP Value Incl: GST', 'rpincl')
    addCol([...rows.map((r) => numStr(r.gstBox, 2, true)), numStr(S.gstBox, 2, true)], singleRate ? `GST @ ${singleRate}% per Box` : 'GST per Box', 'gstbox')
  }
  addCol([...rows.map((r) => numStr(r.gross, 2, true)), numStr(S.gross, 2, true)], 'Gross Amount Incl: GST', 'gross')
  addCol(['-'], 'Advance Tax', 'adv') // items table mein Advance Tax hamesha dash hota hai
  addCol([...rows.map((r) => numStr(r.it.discount, 2, true)), numStr(S.discount, 2, true)], 'Total Discount', 'disc')
  addCol([...rows.map((r) => numStr(r.it.lineTotal, 2, true)), numStr(S.net, 2, true)], 'Net Amount', 'net')
  addCol(rows.map((r) => numStr(r.it.consumerPrice, 2)), 'Retail Price', 'retail')
  // WATER-FILLING: har column apna CONTENT need pakka leta hai (glyph-measured), bachi hui
  // jagah (730 - Σneed) data-bhooke columns ko milti hai (lambi value = zyada hissa).
  // Is se na header mid-word tootta hai ("CT N") na amount column se bahir nikalti hai.
  const TABLE_W = 730 // .cbl-page 794px - px-8 (2 x 32)
  const needs = colSpecs.map((c) => c.need)
  const slack = Math.max(0, TABLE_W - needs.reduce((a, b) => a + b, 0))
  const extra = colSpecs.map((c) => Math.max(0, c.d - c.need))
  const sumExtra = extra.reduce((a, b) => a + b, 0) || 1
  const colPx = colSpecs.map((_, i) => needs[i] + (slack * extra[i]) / sumExtra)
  const colW = colPx.map((px) => `${((px / TABLE_W) * 100).toFixed(3)}%`)
  const fitOf = (key?: string) => {
    const i = colSpecs.findIndex((x) => x.key === key)
    if (i < 0) return undefined
    return Math.floor((colPx[i] - 10) / 4.8) // 8px td padding + 2 border, ~4.8px/digit bold
  }
  // promotions applied (unique scheme name -> amount)
  const promos = new Map<string, number>()
  for (const r of rows) {
    if (r.it.discount > 0) {
      const key = r.it.schemeName ?? 'Trade Discount'
      promos.set(key, (promos.get(key) ?? 0) + r.it.discount)
    }
  }
  const promoList = [...promos.entries()]
  const letters = 'abcdefghijklmnopqrstuvwxyz'
  const totalDiscount = S.discount + S.manual
  const advTax = inv.advanceTax ?? 0
  const advRate = inv.advanceTaxRate
  // Task 45: GST (trade value par — booking snapshot) + Trade Offer (per-SKU, discount ke ilawa)
  const gstTrade = inv.gstTotal ?? 0
  const toTotal = inv.tradeOfferTotal ?? 0
  const totalPayable = Math.round((inv.total - toTotal + gstTrade + advTax) * 100) / 100
  const hasTaxChain = toTotal > 0 || gstTrade > 0 || advTax > 0

  return (
    <div className="cbl-doc">
      <div className="cbl-page bg-white px-8 py-7">
        {/* header: distributor (left) + invoice meta (right) */}
        <div className="flex justify-between">
          <div style={{ width: '58%' }}>
            <p className="text-[17px] font-bold underline">{inv.distributorName} ({inv.distributorCity ?? ''}) - (MSD)</p>
            <p className="mt-1 text-[11px] font-bold">{inv.distributorName.toUpperCase()} {inv.distributorCity?.toUpperCase()} MAIN MARKET</p>
            <table style={{ border: 'none', marginTop: 4 }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 70, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8, paddingTop: 3 }}>M/S :</td><td style={{ border: 'none', paddingTop: 3 }}>{inv.outlet.name.toUpperCase()} [ {inv.outlet.code} ]</td></tr>
                <tr><td style={{ border: 'none', width: 70, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Owner :</td><td style={{ border: 'none' }}>{inv.outlet.ownerName?.trim() ? inv.outlet.ownerName : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 70, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Address:</td><td style={{ border: 'none' }}>{inv.outlet.address?.toUpperCase() ?? '—'}</td></tr>
                {/* Shop ka NTN + CNIC ab right side (CASH MEMO ke neeche) — har shop ka apna, outlets detail se */}
              </tbody>
            </table>
          </div>
          <div style={{ width: '40%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 90, whiteSpace: 'nowrap', paddingRight: 8 }}>Invoice No # :</td><td style={{ border: 'none', fontWeight: 'bold' }}>{inv.orderNo}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Date/Day :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(inv.orderDate)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Route :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{inv.salesmanName ?? '—'}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[17px] font-bold">CASH MEMO / INVOICE</p>
            <table style={{ border: 'none', marginTop: 3 }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 90, whiteSpace: 'nowrap', paddingRight: 8 }}>N.T.N No :</td><td style={{ border: 'none' }}>{inv.outlet.ntn?.trim() ? inv.outlet.ntn.toUpperCase() : '—'}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>C.N.I.C No :</td><td style={{ border: 'none' }}>{inv.outlet.cnic?.trim() ? inv.outlet.cnic : '—'}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Urdu tagline */}
        <p dir="rtl" className="mt-2 mb-2 text-[12.5px]" style={{ fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" }}>
          خوشخبری! اب نئے سنیک پیکس، بہترین ٹریڈ مارجن اور اضافی بسکٹس کے ساتھ۔
        </p>

        {/* items table — CTN → Box → Pcs pehle (user order), GST columns settings ke hisab se */}
        <table style={{ fontSize: 8.6 }}>
          <colgroup>
            {/* Task 34: widths har invoice ke data se compute hoti hain (colW) — static % nahi */}
            {colW.map((w, i) => (
              <col key={`c${i}`} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Item / Product Name</th>
              <th>CTN</th><th>Box</th><th>Pcs</th>
              <th>Free</th>
              <th>{anyGst ? 'Rate/ Unit Excl: GST' : 'Rate/ Unit'}</th>
              <th>{anyGst ? 'Total Value Excl: GST' : 'Total Value'}</th>
              <th>RP Value{anyGst ? ' Excl: Gst' : ''}</th>
              {anyGst && <th>GST on RP Value{singleRate ? ` @ ${singleRate}%` : ''}</th>}
              {anyGst && <th>RP Value Incl: GST</th>}
              {anyGst && <th>{singleRate ? `GST @ ${singleRate}% per Box` : 'GST per Box'}</th>}
              <th>{anyGst ? 'Gross Amount Incl: GST' : 'Gross Amount'}</th>
              <th>Advance Tax</th>
              <th>Total Discount</th>
              <th>Net Amount</th>
              <th>Retail Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.it.id} className="cbl-break-avoid">
                <td style={{ textAlign: 'left' }}>{r.it.sku} {r.it.productName}</td>
                <Num v={r.ctn} />
                <Num v={r.box} />
                <Num v={r.pcs} />
                <Num v={r.it.freeQty} />
                <Num v={r.it.rate} dec={2} fit={fitOf('rate')} />
                <Num v={r.gross} dec={2} compact fit={fitOf('totval')} />
                <Num v={r.rpExcl} dec={2} compact fit={fitOf('rpexcl')} />
                {anyGst && <Num v={r.gstRp} dec={2} compact fit={fitOf('gstrp')} />}
                {anyGst && <Num v={r.rpIncl} dec={2} compact fit={fitOf('rpincl')} />}
                {anyGst && <Num v={r.gstBox} dec={2} compact fit={fitOf('gstbox')} />}
                <Num v={r.gross} dec={2} compact fit={fitOf('gross')} />
                {dash}
                <Num v={r.it.discount} dec={2} compact fit={fitOf('disc')} />
                <Num v={r.it.lineTotal} dec={2} compact fit={fitOf('net')} />
                <Num v={r.it.consumerPrice} dec={2} fit={fitOf('retail')} />
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td style={{ textAlign: 'left' }}>Total ({rows.length} items)</td>
              <Num v={S.ctn} />
              <Num v={S.box} />
              <Num v={S.pcs} />
              <Num v={S.free} />
              {dash}
              <Num v={S.grossExcl} dec={2} compact fit={fitOf('totval')} />
              <Num v={S.rpExcl} dec={2} compact fit={fitOf('rpexcl')} />
              {anyGst && <Num v={S.gstRp} dec={2} compact fit={fitOf('gstrp')} />}
              {anyGst && <Num v={S.rpIncl} dec={2} compact fit={fitOf('rpincl')} />}
              {anyGst && <Num v={S.gstBox} dec={2} compact fit={fitOf('gstbox')} />}
              <Num v={S.gross} dec={2} compact fit={fitOf('gross')} />
              {dash}
              <Num v={S.discount} dec={2} compact fit={fitOf('disc')} />
              <Num v={S.net} dec={2} compact fit={fitOf('net')} />
              {dash}
            </tr>
          </tbody>
        </table>

        {/* Task 33: free wale bills ek nazar mein pehchane jaayein — notice line sirf free > 0 par */}
        {S.free > 0 && (
          <p className="mt-1.5 text-[10.5px] font-bold">
            FREE SCHEME APPLIED — {fmtI(S.free)} Free Pcs on this bill
          </p>
        )}

        {/* bottom: promotions (left) + totals (right) */}
        <div className="mt-4 flex justify-between">
          <div style={{ width: '47%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <thead>
                <tr><th colSpan={2}>Promotions Applied</th></tr>
                <tr><td style={{ fontWeight: 'bold' }}>Discount Summary</td><td style={{ fontWeight: 'bold' }} className="ctr">Amount</td></tr>
              </thead>
              <tbody>
                {promoList.length === 0 && S.manual === 0 ? (
                  <tr><td>(a) No Promotion</td><td className="num">0.00</td></tr>
                ) : (
                  <>
                    {promoList.map(([name, amt], i) => (
                      <tr key={name}><td>({letters[i]}) {name}</td><td className="num">{fmt2(amt)}</td></tr>
                    ))}
                    {S.manual > 0 && (
                      <tr>
                        <td>({letters[promoList.length]}) Manual Discount{inv.manualDiscType === 'PERCENT' && inv.manualDiscValue ? ` (${inv.manualDiscValue}%)` : ''}</td>
                        <td className="num">{fmt2(S.manual)}</td>
                      </tr>
                    )}
                  </>
                )}
                <tr style={{ fontWeight: 'bold' }}><td style={{ textAlign: 'right' }}>Total Discount</td><td className="num">{fmt2(totalDiscount)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '31%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <tbody>
                <tr><td style={{ textAlign: 'center' }}>{anyGst ? 'Gross Amount Exl GST:' : 'Gross Amount:'}</td><td className="num" style={{ width: 90 }}>{fmt2(S.grossExcl)}</td></tr>
                {anyGst && <tr><td style={{ textAlign: 'center' }}>{singleRate ? `${singleRate}% ` : ''}GST:</td><td className="num">{fmt2(S.gstRp)}</td></tr>}
                {anyGst && <tr><td style={{ textAlign: 'center' }}>Total Amount With GST:</td><td className="num">{fmt2(S.grossExcl + S.gstRp)}</td></tr>}
                <tr><td style={{ textAlign: 'right', fontWeight: 'bold' }}>Total Discount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(totalDiscount)}</td></tr>
                {toTotal > 0 && <tr><td style={{ textAlign: 'right' }}>Trade Offer:</td><td className="num">- {fmt2(toTotal)}</td></tr>}
                {gstTrade > 0 && <tr><td style={{ textAlign: 'right' }}>GST (Trade Value):</td><td className="num">+ {fmt2(gstTrade)}</td></tr>}
                <tr>
                  <td style={{ textAlign: 'right' }}>
                    Advance Tax {advRate != null ? `@ ${advRate}%` : ''}
                    {inv.filerStatus ? ` (${inv.filerStatus === 'FILER' ? 'Filer' : 'Non-Filer'})` : ''}:
                  </td>
                  <td className="num">{advTax > 0 ? `+ ${fmt2(advTax)}` : '0.00'}</td>
                </tr>
                <tr><td style={{ textAlign: 'right', fontWeight: 'bold' }}>Total Invoice Amount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmtI(hasTaxChain ? totalPayable : inv.total)}</td></tr>
              </tbody>
            </table>
          </div>
        </div>

        {inv.summaryNo && (
          <p className="mt-3 text-[9px] font-bold" style={{ marginLeft: 24 }}>Load Form # {inv.summaryNo}</p>
        )}

        {/* signature boxes */}
        <div className="mt-6 flex justify-between px-4">
          {[`${inv.salesmanName ?? '—'}|Checked By Order Booker`, `${inv.salesmanName ?? '—'}|Delivered By`, '|Shop Keeper'].map((s, i) => {
            const [name, role] = s.split('|')
            return (
              <div key={i} className="w-44 text-center cbl-break-avoid">
                <p className="mb-1 text-[11px]">{name}</p>
                <div style={{ border: '1.5px solid #000' }} className="px-3 py-1.5 text-[11px] font-bold">{role}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ============================================================
// 3) BULK INVOICES — ek summary ki sab invoices, har ek apne A4
//    page par (.cbl-stack print CSS page-break handle karta hai)
// ============================================================
export function CblInvoicesDoc({ invoices, gst }: { invoices: InvoiceData[]; gst?: { enabled: boolean; rate: number } }) {
  return (
    <div className="cbl-stack">
      {invoices.map((inv) => (
        <CblInvoiceDoc key={inv.orderNo} inv={inv} gst={gst} />
      ))}
    </div>
  )
}

// ============================================================
// 4) SETTLEMENT SHEET — post hone ke baad ka poora hisaab:
//    shop-wise cash/udhaar muqabla + item-wise return detail
//    (SummaryDetailDTO: orders[].returns + settlements join)
// ============================================================
const RETURN_TYPE_LABELS: Record<string, string> = {
  UNSOLD: 'Unsold (shop ne wapas kiya)',
  DAMAGED: 'Damaged',
  EXPIRED: 'Expired',
}
const SETTLE_TYPE_LABELS: Record<string, string> = {
  CASH: 'Cash', PARTIAL: 'Partial', CREDIT: 'Udhaar',
}

export function CblSettlementDoc({ detail }: { detail: SummaryDetailDTO }) {
  // settlements ko orderId se join karo — posted amounts (cash/return/udhaar)
  const st = new Map(detail.settlements.map((s) => [s.orderId, s]))
  const rows = detail.orders.map((o, i) => {
    const s = st.get(o.id)
    const bill = s?.billAmount ?? o.total
    const ret = s?.returnAmount ?? (o.returns ?? []).reduce((a, r) => a + r.totalValue, 0)
    const tax = s?.advanceTax ?? o.advanceTax ?? 0
    const cash = s?.cashAmount ?? 0
    const credit = s?.creditAmount ?? 0
    return {
      i, o, bill, ret, tax, cash, credit,
      net: Math.round((bill - ret + tax) * 100) / 100,
      type: s?.status ?? 'CASH',
    }
  })

  const T = {
    bills: rows.reduce((a, r) => a + r.bill, 0),
    ret: rows.reduce((a, r) => a + r.ret, 0),
    tax: rows.reduce((a, r) => a + r.tax, 0),
    net: rows.reduce((a, r) => a + r.net, 0),
    cash: rows.reduce((a, r) => a + r.cash, 0),
    credit: rows.reduce((a, r) => a + r.credit, 0),
  }
  const returnRows = rows.filter((r) => (r.o.returns ?? []).length > 0)

  return (
    <div className="cbl-doc">
      {/* flex-col + min-height A4 — signatures page ke BOTTOM pin hote hain (warna chhoti
          settlement mein aadha page khali rehta tha aur signatures beech mein float karti theen) */}
      <div className="cbl-page bg-white px-8 py-7 flex flex-col">
        {/* header: distributor (left) + settlement meta (right) */}
        <div className="flex justify-between">
          <div style={{ width: '58%' }}>
            <p className="text-[17px] font-bold underline">{detail.distributorName} - (MSD)</p>
            <table style={{ border: 'none', marginTop: 4 }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 105, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Deliveryman:</td><td style={{ border: 'none' }}>{detail.salesmanName}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Warehouse:</td><td style={{ border: 'none' }}>{detail.warehouseName}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Settled By:</td><td style={{ border: 'none' }}>{detail.settledByName ?? '—'}{detail.settledAt ? ` — ${new Date(detail.settledAt).toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })}` : ''}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '40%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 105, whiteSpace: 'nowrap', paddingRight: 8 }}>Settlement # :</td><td style={{ border: 'none', fontWeight: 'bold' }}>{detail.summaryNo}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Delivery Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(detail.deliveryDate)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Bills :</td><td style={{ border: 'none' }}>{detail.orders.length} invoices</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Print Date :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{printDate()}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[16px] font-bold">DELIVERY SETTLEMENT SHEET</p>
            <p className="text-[10px] font-bold" style={{ letterSpacing: 0.5 }}>CASH &amp; RETURN STATEMENT (POSTED)</p>
          </div>
        </div>

        {/* SECTION A: shop-wise muqabla */}
        <p className="mb-1 mt-3 text-[11px] font-bold uppercase" style={{ letterSpacing: 0.5 }}>A) Shop Wise Collection &amp; Return Muqabla</p>
        <table style={{ fontSize: 9 }}>
          <colgroup>
            {/* Type col 8% — "Udhaar" label 4% mein "Udha/ar" break ho raha tha */}
            <col style={{ width: '5%' }} /><col style={{ width: '10%' }} /><col style={{ width: '19%' }} />
            <col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '8%' }} />
            <col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '7%' }} /><col style={{ width: '8%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>S.No#</th>
              <th>Invoice #</th>
              <th style={{ textAlign: 'left' }}>Shop Name</th>
              <th>Bill Amount</th>
              <th>Stock Return</th>
              <th>Adv Tax</th>
              <th>Net Payable</th>
              <th>Cash Received</th>
              <th>Udhaar</th>
              <th>Type</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.o.id} className="cbl-break-avoid">
                <td className="ctr">{r.i + 1}</td>
                <td className="ctr">{r.o.orderNo}</td>
                <td style={{ textAlign: 'left' }}>{r.o.outletName.toUpperCase()} [ {r.o.outletCode} ]</td>
                <Num v={r.bill} dec={2} />
                <Num v={r.ret} dec={2} />
                <Num v={r.tax} dec={2} />
                <Num v={r.net} dec={2} />
                <Num v={r.cash} dec={2} />
                <Num v={r.credit} dec={2} />
                <td className="ctr" style={{ fontSize: 7.5, whiteSpace: 'nowrap' }}>{SETTLE_TYPE_LABELS[r.type] ?? r.type}</td>
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td colSpan={3} style={{ textAlign: 'right' }}>Total ({rows.length} shops)</td>
              <Num v={T.bills} dec={2} />
              <Num v={T.ret} dec={2} />
              <Num v={T.tax} dec={2} />
              <Num v={T.net} dec={2} />
              <Num v={T.cash} dec={2} />
              <Num v={T.credit} dec={2} />
              {dash}
            </tr>
          </tbody>
        </table>

        {/* SECTION B: item-wise return detail */}
        <p className="mb-1 mt-4 text-[11px] font-bold uppercase" style={{ letterSpacing: 0.5 }}>B) Return Detail (Item Wise)</p>
        {returnRows.length === 0 ? (
          <table style={{ fontSize: 9.5 }}><tbody>
            <tr><td style={{ textAlign: 'left' }}>Koi stock return nahi hui — poora bill cash/udhaar adjust hua.</td></tr>
          </tbody></table>
        ) : (
          returnRows.map((r) => (r.o.returns ?? []).map((ret) => (
            <table key={`${r.o.id}-${ret.returnNo}`} className="mt-1.5" style={{ fontSize: 9 }}>
              <colgroup>
                <col style={{ width: '48%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th colSpan={4} style={{ textAlign: 'left', backgroundColor: '#f7f7f7' }}>
                    {ret.returnNo} — {r.o.outletName.toUpperCase()} [ {r.o.outletCode} ] • {RETURN_TYPE_LABELS[ret.reason ?? ret.type] ?? ret.type} • {new Date(ret.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </th>
                </tr>
                <tr>
                  <th style={{ textAlign: 'left' }}>Product</th>
                  <th>Return Qty</th>
                  <th>Rate</th>
                  <th>Return Value</th>
                </tr>
              </thead>
              <tbody>
                {ret.items.map((it, ii) => (
                  <tr key={ii} className="cbl-break-avoid">
                    <td style={{ textAlign: 'left' }}>{it.productName}</td>
                    <td className="ctr" style={{ whiteSpace: 'nowrap' }}>{fmtQty(it.qty, it.unitsPerCarton ?? 1, it.pcsPerBox ?? 0)}</td>
                    <Num v={it.rate} dec={2} />
                    <Num v={it.value} dec={2} />
                  </tr>
                ))}
                <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
                  <td colSpan={3} style={{ textAlign: 'right' }}>Return Total ({ret.items.reduce((a, x) => a + x.qty, 0)} pcs)</td>
                  <Num v={ret.totalValue} dec={2} />
                </tr>
              </tbody>
            </table>
          )))
        )}

        {/* SECTION C: cash summary + signatures */}
        <div className="mt-4 flex justify-between">
          <div style={{ width: '58%' }}>
            <table style={{ fontSize: 9.5 }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold' }}>Note:</td><td style={{ border: 'none', textAlign: 'left' }}>Ye settlement post hone ke baad ka record hai — shop ledgers mein cash credit aur return adjust ho chuka hai.{T.net < 0 && ` Is summary mein stock return (Rs ${fmt2(T.ret)}) bill (Rs ${fmt2(T.bills)}) se zyada tha, is liye net Rs ${fmt2(Math.abs(T.net))} shop ko wapas karne hain (excess return).`}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '38%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <tbody>
                <tr><td style={{ textAlign: 'center' }}>Total Bill Amount:</td><td className="num" style={{ width: 95 }}>{fmt2(T.bills)}</td></tr>
                <tr><td style={{ textAlign: 'center' }}>Less: Stock Returns:</td><td className="num">- {fmt2(T.ret)}</td></tr>
                {T.tax > 0 && <tr><td style={{ textAlign: 'center' }}>Add: Advance Tax:</td><td className="num">+ {fmt2(T.tax)}</td></tr>}
                <tr style={{ fontWeight: 'bold' }}><td style={{ textAlign: 'center' }}>Net Payable:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(T.net)}</td></tr>
                <tr><td style={{ textAlign: 'center', fontWeight: 'bold' }}>Cash Jama Karwaya:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(T.cash)}</td></tr>
                {/* Udhaar negative = return bill se zyada — "-4.56 bakaya udhaar" reader ko galat lagta
                    hai, is liye positive "Shop Ko Wapasi" label ke sath dikhate hain */}
                {T.credit < 0
                  ? <tr><td style={{ textAlign: 'center' }}>Shop Ko Wapasi (Excess Return):</td><td className="num">{fmt2(Math.abs(T.credit))}</td></tr>
                  : <tr><td style={{ textAlign: 'center' }}>Udhaar (Baqi):</td><td className="num">{fmt2(T.credit)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {/* signatures: Admin + Delivery Man — mt-auto se A4 page ke bottom par pin */}
        <div className="mt-auto flex justify-between px-6 pt-10">
          {[
            `${detail.salesmanName ?? '—'}|Delivery Man Signature`,
            `${detail.settledByName ?? 'Admin'}|Admin Signature`,
          ].map((s, i) => {
            const [name, role] = s.split('|')
            return (
              <div key={i} className="w-48 text-center cbl-break-avoid">
                <p className="mb-1 text-[11px]">{name}</p>
                <div style={{ border: '1.5px solid #000' }} className="px-3 py-1.5 text-[11px] font-bold">{role}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
