'use client'

/**
 * CBL-style print documents — same-to-same design as the uploaded samples:
 *  1. CblLoadFormDoc  — Load Form: product load sheet + customers sheet (signatures end par) (2 pages)
 *  2. CblInvoiceDoc   — CASH MEMO / INVOICE: distributor header, Urdu disclaimer,
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
import { aggregateSchemePromos, orderGrandPayable } from '@/lib/dms-order-calc'
import type { SummaryDetailDTO, SummaryOrderDTO, SchemeStackRow } from '@/lib/dms-types'

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
// Task 51: money cell — real invoice ke money columns 0 ko bhi "0.00" print karte hain (dash nahi)
const M = ({ v, fit }: { v: number; fit?: number }) => (
  <td className="num" style={fit && fmt2(v).length > fit ? { fontSize: 7.4 } : undefined}>{fmt2(v)}</td>
)
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

export function PrintFrame({ title, onClose, pdfName, landscape, children }: {
  title: string
  onClose: () => void
  /** filename (bina .pdf) direct download ke liye — default title se slug banta hai */
  pdfName?: string
  /** Task 51: landscape A4 option — Task 59 ke baad koi caller use nahi karta (invoice PORTRAIT
   * hai) par machinery intact — future landscape doc ke liye ready (1123px page + @page override) */
  landscape?: boolean
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
    // landscape doc: @page size override — print/PDF landscape par aaye (global @page A4 portrait hai)
    let landStyle: HTMLStyleElement | null = null
    if (landscape) {
      landStyle = document.createElement('style')
      landStyle.id = 'cbl-landscape-page'
      landStyle.textContent = '@page { size: A4 landscape; margin: 8mm; }'
      document.head.appendChild(landStyle)
    }
    return () => {
      document.body.classList.remove('has-cbl-print')
      window.removeEventListener(PRINT_OPEN_EVT, onOther)
      window.removeEventListener('keydown', onKey)
      clearTimeout(warm)
      landStyle?.remove()
    }
  }, [onClose, landscape])

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
      // Task 51: page width se orientation detect — landscape doc (1123px) landscape A4 par
      const land = (pages[0]?.offsetWidth ?? 0) > 900
      const pdf = new jsPDF({ orientation: land ? 'landscape' : 'portrait', unit: 'mm', format: 'a4' })
      const PW = land ? 297 : 210 // A4 width mm
      const PH = land ? 210 : 297
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
        let iw = PW
        let ih = (canvas.height * iw) / canvas.width
        if (ih > PH) { ih = PH; iw = (canvas.width * ih) / canvas.height }
        if (i > 0) pdf.addPage()
        pdf.addImage(img, 'JPEG', (PW - iw) / 2, 0, iw, ih)
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
      {/* A4 pages FIXED width (globals.css .cbl-page = portrait) — chhote screen par overlay
          scroll karta hai, lekin document ka layout kabhi squeeze nahi hota -> PDF/print hamesha
          preview jaisa */}
      <div className={`mx-auto shadow-2xl ${landscape ? 'w-[1123px]' : 'w-[794px]'}`}>{children}</div>
      <div className="cbl-no-print h-8" />
    </RemoveScroll>,
    document.body,
  )
}

// ============================================================
// 1) LOAD FORM — 2 pages (products load + customers sheet, signatures sheet ke end par)
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
  // Task 79: Amount ab FINAL PAYABLE (total − TO + GST + AdvTax) — wahi jo bill par chapta hai.
  // Pehle goods net (o.total) tha — load form/invoice/print par amount match nahi karta tha.
  const totAmount = detail.orders.reduce((s, o) => s + orderGrandPayable(o), 0)
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
                {/* Task 79: Amount = Total Payable (Net − TO + GST + AdvTax) — bill ke Grand Total se EXACT match */}
                <Num v={orderGrandPayable(o)} />
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

        {/* Task 79: signatures AB customer sheet ke END par (pehle PAGE 3 par akale the —
            user: "3rd page py footer alg sy ata hy — customer sheet k end pr ana chahiye").
            cbl-break-avoid = block kabhi 2 pages par split nahi hoga — table lambi ho to
            poora ka poora block table ke sath next page par jata hai (end par hi rehta hai). */}
        <div className="cbl-break-avoid mt-12 flex justify-between px-8">
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
  /** Task 56/57: booking par freeze hua poora scheme stack (rows mein per-scheme
   * amount/freeQtyGiven — Promotions Applied har scheme ki ALAG row print karta hai) */
  schemeStack?: SchemeStackRow[] | null
  // Task 51: booked tax snapshots (real-invoice format ke per-row columns)
  // gstAmt = gstRate% × (rate × qty − discount) — booking par snapshot
  gstAmt?: number
  tradeOfferAmt?: number
  /** Task 52: manual discount ka is line ka hissa (Pass On = discount + manualShare).
   * Legacy lines par absent/0 — print purana behaviour rakhta hai. */
  manualShare?: number
}
export interface InvoiceData {
  orderNo: string
  outlet: { name: string; code: string; channel: string; address: string | null; ownerName?: string | null; phone?: string | null; ntn?: string | null; cnic?: string | null }
  salesmanName: string | null
  distributorName: string
  distributorCity?: string | null
  /** Task 78: distributor ka cell number (settings page se) — bill header par naam ke neeche */
  distributorPhone?: string | null
  /** Task 78b: distributor ka poora address (AppSetting KV, settings page se) — Name → Address → Cell No */
  distributorAddress?: string | null
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
  /** Task 51: summary/delivery se delivery date (real invoice "Delivery Date/Day" line) */
  summaryDeliveryDate?: string | null
  /** Task 51: booked grand payable (= total − TO + GST + Adv) — print ke Net Invoice se match */
  payable?: number
  items: InvoiceItemData[]
}

export function CblInvoiceDoc({ inv }: { inv: InvoiceData; gst?: { enabled: boolean; rate: number } }) {
  // Task 59: REAL-INVOICE FORMAT — PORTRAIT A4 (user: "landscape nai, portrait main ho or
  // sai sy visible bhi ho"). Portrait 794px par 15 columns physically fit nahi — is liye
  // jo columns kabhi data nahi rakhte wo hat gaye: Batch (hamesha dash), Further Sales Tax
  // (hamesha 0.00), Total Sales Tax (Further=0 par Sales Tax ki exact copy). 12 columns:
  // Item | CTN | Box | Units | Free Units | Trade Price | Gross Amount | Pass On | Net Amount
  // | Sales Tax | Advance Tax 236H | Amount Inclusive of All Tax.
  // (Task 51: original landscape real-invoice format — Al-Falah/Mondelez CASH MEMO)
  // Har row BOOKED SNAPSHOT se print hoti hai (rate/discount/lineTotal/gstAmt/tradeOfferAmt —
  // Task 41/45 snapshot principle; yahan koi naya calculation nahi jo booked totals se hat jaye).
  // Advance Tax booked total ka Net-weight pro-rata hai (aakhri row rounding absorb karti hai)
  // → har column ka total neeche summary box ke number ke EXACT barabar hai — upar/neeche hamesha same.
  // Task 52: MANUAL DISCOUNT = PASS ON MERGE — manual booking par lines mein pro-rata (manualShare)
  // merge hota hai, is liye Pass On column = scheme discount + manualShare → top Pass On ka total
  // == Promotions Applied ka Total Discount, Net column ka total == order.total, GST merged net par.
  // LEGACY orders (manualShare 0) par purana behaviour — manual sirf promo box + summary mein.
  const rows = inv.items.map((it) => {
    const upc = it.unitsPerCarton ?? 0
    const ppb = it.pcsPerBox && it.pcsPerBox > 0 ? it.pcsPerBox : 0
    const gross = Math.round(it.qty * it.rate * 100) / 100
    // qty PIECES hai — CTN / Box / Units breakdown
    const ctn = upc > 0 ? Math.floor(it.qty / upc) : 0
    const rem = upc > 0 ? it.qty % upc : 0
    const box = ppb > 0 ? Math.floor(rem / ppb) : 0
    const pcs = ppb > 0 ? rem % ppb : rem
    return {
      it, gross, ctn, box, pcs,
      // Task 52: Pass On = scheme discount + manual share (merged)
      passOn: Math.round((it.discount + (it.manualShare ?? 0)) * 100) / 100,
      gst: Math.round((it.gstAmt ?? 0) * 100) / 100,
      to: Math.round((it.tradeOfferAmt ?? 0) * 100) / 100,
      adv: 0,
    }
  })
  // Advance Tax 236H — booked advanceTax ko per-row Net ke weight par split (last row
  // rounding ka farq kha jati hai) → column total EXACTLY booked advanceTax
  const advTotal = Math.round((inv.advanceTax ?? 0) * 100) / 100
  const netAll = rows.reduce((s, r) => s + r.it.lineTotal, 0)
  let advLeft = advTotal
  rows.forEach((r, i) => {
    if (advTotal <= 0 || netAll <= 0) return
    r.adv = i === rows.length - 1
      ? Math.round(advLeft * 100) / 100
      : Math.round(advTotal * (r.it.lineTotal / netAll) * 100) / 100
    advLeft -= r.adv
  })
  // Amount Inclusive of All Tax = Net − Trade Offer + Total Sales Tax + Advance Tax 236H
  const rows2 = rows.map((r) => ({ ...r, incl: Math.round((r.it.lineTotal - r.to + r.gst + r.adv) * 100) / 100 }))

  // ---- column totals (summary box inhi numbers ko print karta hai) ----
  const S = {
    ctn: rows2.reduce((s, r) => s + r.ctn, 0),
    box: rows2.reduce((s, r) => s + r.box, 0),
    pcs: rows2.reduce((s, r) => s + r.pcs, 0),
    free: rows2.reduce((s, r) => s + r.it.freeQty, 0),
    tp: rows2.reduce((s, r) => s + r.it.rate, 0),
    gross: rows2.reduce((s, r) => s + r.gross, 0),
    passOn: rows2.reduce((s, r) => s + r.passOn, 0),
    net: rows2.reduce((s, r) => s + r.it.lineTotal, 0),
    gst: rows2.reduce((s, r) => s + r.gst, 0),
    adv: advTotal,
    to: rows2.reduce((s, r) => s + r.to, 0),
    incl: rows2.reduce((s, r) => s + r.incl, 0),
  }
  const manual = inv.manualDiscount ?? 0
  // Task 52: manual Pass On mein merged hai ya nahi (legacy orders manualShare 0)
  const manualInside = Math.round(rows2.reduce((s, r) => s + (r.it.manualShare ?? 0), 0) * 100) / 100 > 0
  // Total Discount = Pass On column ka total (naye orders: scheme + manual merged; legacy: + manual alag)
  const totalDiscount = Math.round((S.passOn + (manualInside ? 0 : manual)) * 100) / 100
  // Net Invoice Amount:
  //  - naye orders: Σ Amount Inclusive (manual andar hi merged) = booked payable
  //  - legacy: Σ Amount Inclusive − manual discount (purana chain, snapshot frozen)
  const netInvoice = manualInside ? Math.round(S.incl * 100) / 100 : Math.round((S.incl - manual) * 100) / 100

  // ---- Task 34: DATA-AWARE column widths (water-filling) — Task 59: portrait TABLE_W par ----
  const colSpecs: { key?: string; hw: number; vl: number; min: number; d: number; need: number }[] = []
  const textW = (s: string) =>
    [...s].reduce((a, ch) => a + (/[.,:]/.test(ch) ? 2.4 : /[0-9a-z/-]/.test(ch) ? 4.8 : 6.2), 0)
  const addCol = (vals: string[], header: string, key?: string, min = 20) => {
    const hw = header.split(' ').reduce((a, w) => Math.max(a, textW(w)), 0) // header ka sab se lambe WORD ka width
    const vl = vals.reduce((a, s) => Math.max(a, textW(s)), 0) // sab se lambi RENDERED value (no-wrap)
    const need = Math.max(min, Math.max(hw, vl) + 11) // + padding 8 + border 2 + margin 1
    const raw = Math.max(hw, vl) * 1.15 + 12 // data-bhook demand (slack share ke liye)
    colSpecs.push({ key, hw, vl, min, d: Math.max(need, raw), need })
  }
  addCol([], 'Item / Product Name', undefined, 130) // name wrap hota hai — portrait par bhi readable (Task 59)
  addCol([...rows2.map((r) => (r.ctn ? fmtI(r.ctn) : '-')), S.ctn ? fmtI(S.ctn) : '-'], 'CTN', 'ctn')
  addCol([...rows2.map((r) => (r.box ? fmtI(r.box) : '-')), S.box ? fmtI(S.box) : '-'], 'Box', 'box')
  addCol([...rows2.map((r) => (r.pcs ? fmtI(r.pcs) : '-')), S.pcs ? fmtI(S.pcs) : '-'], 'Units', 'units')
  // Free Units: real bill 0 ko bhi "0" print karta hai (dash nahi)
  addCol([...rows2.map((r) => fmtI(r.it.freeQty)), fmtI(S.free)], 'Free Units', 'free', 22)
  addCol(rows2.map((r) => fmt2(r.it.rate)), 'Trade Price (Excluding Sales Tax)', 'tp')
  addCol([...rows2.map((r) => fmtCell(r.gross, 2)), fmtCell(S.gross, 2)], 'Gross Amount (Excluding Sales Tax)', 'gross')
  addCol([...rows2.map((r) => fmtCell(r.passOn, 2)), fmtCell(S.passOn, 2)], 'Pass On', 'passon')
  addCol([...rows2.map((r) => fmtCell(r.it.lineTotal, 2)), fmtCell(S.net, 2)], 'Net Amount (Excluding Sales Tax)', 'net')
  addCol([...rows2.map((r) => fmt2(r.gst)), fmt2(S.gst)], 'Sales Tax', 'st')
  addCol([...rows2.map((r) => fmt2(r.adv)), fmt2(S.adv)], 'Advance Tax 236H', 'adv')
  addCol([...rows2.map((r) => fmtCell(r.incl, 2)), fmtCell(S.incl, 2)], 'Amount Inclusive of All Tax', 'incl')
  // WATER-FILLING: har column apna CONTENT need pakka leta hai (glyph-measured), bachi hui
  // jagah (TABLE_W − Σneed) data-bhooke columns ko milti hai (lambi value = zyada hissa).
  const TABLE_W = 730 // Task 59: .cbl-page portrait 794px − px-8 (2 x 32)
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

  // Task 57: Promotions Applied — HAR promotion apni ALAG row (ek column mein ek hi
  // promotion, na combine): per-line frozen schemeStack se per-scheme amounts aggregate.
  // Jitni schemes user banata jayega, utni rows auto. Shared engine helper — order
  // detail dialog b ISI se rows banata hai (print == dialog == preview hamesha).
  const promoRows = aggregateSchemePromos(rows2.map((r) => r.it))
  const letters = 'abcdefghijklmnopqrstuvwxyz'

  return (
    <div className="cbl-doc">
      <div className="cbl-page bg-white px-8 py-6">
        {/* header — center: distributor + address line (real invoice jaisa underlined).
            Task 78 FINAL (user: "pehly Name us k nichy Address or fr Cell No") —
            naam ki SIRF 1 line, uske neeche ADDRESS (settings page se, AppSetting KV),
            phir Cell No. 2nd repeated naam line pehle hi hata di gayi hai.
            Address/Phone na seta ho to woh line print hi nahi hoti. */}
        <div className="text-center">
          <p className="text-[17px] font-bold underline">{inv.distributorName} ({inv.distributorCity ?? ''})</p>
          {inv.distributorAddress?.trim() ? (
            <p className="mt-0.5 text-[11px] font-semibold">{inv.distributorAddress.trim()}</p>
          ) : null}
          {inv.distributorPhone?.trim() ? (
            <p className="mt-1 text-[11px] font-bold">Cell No: {inv.distributorPhone.trim()}</p>
          ) : null}
        </div>

        {/* customer block (left) + invoice meta (right) — real invoice jaisi field list */}
        <div className="mt-3 flex justify-between">
          <div style={{ width: '50%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>M/S :</td><td style={{ border: 'none' }}>{inv.outlet.name.toUpperCase()} [ {inv.outlet.code} ]</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Address:</td><td style={{ border: 'none' }}>{inv.outlet.address?.toUpperCase() ?? '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Channel Type:</td><td style={{ border: 'none' }}>{inv.outlet.channel}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Contact No:</td><td style={{ border: 'none' }}>{inv.outlet.phone?.trim() ? inv.outlet.phone : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>NTN No:</td><td style={{ border: 'none' }}>{inv.outlet.ntn?.trim() ? inv.outlet.ntn.toUpperCase() : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>CNIC No:</td><td style={{ border: 'none' }}>{inv.outlet.cnic?.trim() ? inv.outlet.cnic : '—'}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '46%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 150, whiteSpace: 'nowrap', paddingRight: 8 }}>Invoice No # :</td><td style={{ border: 'none', fontWeight: 'bold' }}>{inv.orderNo}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Booking Date/Day :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(inv.orderDate)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Invoice Date/Day :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(inv.orderDate)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Delivery Date/Day :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{inv.summaryDeliveryDate ? dayDate(inv.summaryDeliveryDate) : '—'}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Route :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{inv.salesmanName ?? '—'}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Income Tax Status :</td><td style={{ border: 'none' }}>{inv.filerStatus === 'FILER' ? 'Filer' : inv.filerStatus === 'NON_FILER' ? 'Non-Filer' : '—'}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[16px] font-bold">CASH MEMO / SALES TAX INVOICE</p>
          </div>
        </div>

        {/* Urdu disclaimer — Task 61: maal moky pr check + zati laindain ka zimydari inkar */}
        <p dir="rtl" className="mt-2 mb-2 text-[12.5px] leading-6" style={{ fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" }}>
          مال موقے پر چیک کریں، بعد کی ذمہ داری نہ ہوگی۔ ڈسٹریبیوٹر / آرڈربوکر کے کسی بھی ذاتی لین دین کا ذمہ دار نہیں ہوگا۔ شکریہ
        </p>

        {/* items table — Task 59: portrait 12 columns (khali/duplicate columns hatay) */}
        <table style={{ fontSize: 8.6 }}>
          <colgroup>
            {colW.map((w, i) => (
              <col key={`c${i}`} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Item / Product Name</th>
              <th>CTN</th><th>Box</th><th>Units</th><th>Free Units</th>
              <th>Trade Price (Excluding Sales Tax)</th>
              <th>Gross Amount (Excluding Sales Tax)</th>
              <th>Pass On</th>
              <th>Net Amount (Excluding Sales Tax)</th>
              <th>Sales Tax</th>
              <th>Advance Tax 236H</th>
              <th>Amount Inclusive of All Tax</th>
            </tr>
          </thead>
          <tbody>
            {rows2.map((r) => (
              <tr key={r.it.id} className="cbl-break-avoid">
                <td style={{ textAlign: 'left' }}>{r.it.sku} {r.it.productName}</td>
                <Num v={r.ctn} />
                <Num v={r.box} />
                <Num v={r.pcs} />
                <td className="num">{fmtI(r.it.freeQty)}</td>
                <M v={r.it.rate} fit={fitOf('tp')} />
                <M v={r.gross} fit={fitOf('gross')} />
                <M v={r.passOn} fit={fitOf('passon')} />
                <M v={r.it.lineTotal} fit={fitOf('net')} />
                <M v={r.gst} fit={fitOf('st')} />
                <M v={r.adv} fit={fitOf('adv')} />
                <M v={r.incl} fit={fitOf('incl')} />
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td style={{ textAlign: 'left' }}>Total</td>
              <Num v={S.ctn} />
              <Num v={S.box} />
              <Num v={S.pcs} />
              <td className="num">{fmtI(S.free)}</td>
              <M v={S.tp} fit={fitOf('tp')} />
              <M v={S.gross} fit={fitOf('gross')} />
              <M v={S.passOn} fit={fitOf('passon')} />
              <M v={S.net} fit={fitOf('net')} />
              <M v={S.gst} fit={fitOf('st')} />
              <M v={S.adv} fit={fitOf('adv')} />
              <M v={S.incl} fit={fitOf('incl')} />
            </tr>
          </tbody>
        </table>

        {/* bottom: promotions (left) + totals (right) — har number kisi column ka total hai */}
        <div className="mt-4 flex justify-between">
          <div style={{ width: '46%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <colgroup><col style={{ width: '70%' }} /><col style={{ width: '30%' }} /></colgroup>
              <thead>
                <tr><th colSpan={2} style={{ background: '#000', color: '#fff' }}>Promotions Applied</th></tr>
                <tr><td style={{ fontWeight: 'bold' }}>Discount Summary</td><td style={{ fontWeight: 'bold' }} className="ctr">Amount</td></tr>
              </thead>
              <tbody>
                {promoRows.length === 0 && manual === 0 ? (
                  <tr><td>(a) No Promotion</td><td className="num">0.00</td></tr>
                ) : (
                  <>
                    {promoRows.map((p, i) => (
                      <tr key={`${p.name}-${i}`}>
                        <td>({letters[i]}) {p.name}</td>
                        <td className="num">{p.freePcs > 0 ? `${fmtI(p.freePcs)} Pcs Free` : fmt2(p.amount)}</td>
                      </tr>
                    ))}
                    {manual > 0 && (
                      <tr>
                        <td>({letters[promoRows.length]}) Manual Discount{inv.manualDiscType === 'PERCENT' && inv.manualDiscValue ? ` (${inv.manualDiscValue}%)` : ''}</td>
                        <td className="num">{fmt2(manual)}</td>
                      </tr>
                    )}
                  </>
                )}
                <tr style={{ fontWeight: 'bold' }}><td style={{ textAlign: 'right' }}>Total Discount</td><td className="num">{fmt2(totalDiscount)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '30%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <tbody>
                <tr><td style={{ textAlign: 'center' }}>Gross Amount:</td><td className="num" style={{ width: 96 }}>{fmt2(S.gross)}</td></tr>
                <tr><td style={{ textAlign: 'center' }}>Total Discount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(totalDiscount)}</td></tr>
                <tr><td style={{ textAlign: 'center' }}>GST:</td><td className="num">{fmt2(S.gst)}</td></tr>
                <tr><td style={{ textAlign: 'center' }}>Advance Tax 236H:</td><td className="num">{fmt2(S.adv)}</td></tr>
                {S.to > 0 && <tr><td style={{ textAlign: 'center' }}>Trade Offer:</td><td className="num">- {fmt2(S.to)}</td></tr>}
                <tr><td style={{ textAlign: 'right', fontWeight: 'bold' }}>Net Invoice Amount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmtI(Math.round(netInvoice))}</td></tr>
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
export function CblInvoicesDoc({ invoices }: { invoices: InvoiceData[]; gst?: { enabled: boolean; rate: number } }) {
  return (
    <div className="cbl-stack">
      {invoices.map((inv) => (
        <CblInvoiceDoc key={inv.orderNo} inv={inv} />
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
    // Task 80: effective GST/TO (settlement row se — return reversal ke baad ka) — pehle
    // net sirf bill − ret + tax tha is liye Net Payable aur Udhaar (ledger) match nahi karte the
    const gst = s?.gstTotal ?? o.gstTotal ?? 0
    const to = s?.tradeOfferTotal ?? o.tradeOfferTotal ?? 0
    const tax = s?.advanceTax ?? o.advanceTax ?? 0
    const cash = s?.cashAmount ?? 0
    const credit = s?.creditAmount ?? 0
    return {
      i, o, bill, ret, gst, to, tax, cash, credit,
      net: Math.round((bill - ret + gst - to + tax) * 100) / 100,
      type: s?.status ?? 'CASH',
    }
  })

  const T = {
    bills: rows.reduce((a, r) => a + r.bill, 0),
    ret: rows.reduce((a, r) => a + r.ret, 0),
    gst: rows.reduce((a, r) => a + r.gst, 0),
    to: rows.reduce((a, r) => a + r.to, 0),
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
            <p className="text-[17px] font-bold underline">{detail.distributorName}</p>
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
            {/* Task 80: GST column add — Net Payable ab bill−ret+GST−TO+tax hai, breakup nazar aaye */}
            <col style={{ width: '4%' }} /><col style={{ width: '9%' }} /><col style={{ width: '17%' }} />
            <col style={{ width: '10%' }} /><col style={{ width: '8%' }} /><col style={{ width: '8%' }} />
            <col style={{ width: '7%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} />
            <col style={{ width: '7%' }} /><col style={{ width: '9%' }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ whiteSpace: 'nowrap' }}>S.No#</th>
              <th>Invoice #</th>
              <th style={{ textAlign: 'left' }}>Shop Name</th>
              <th>Bill Amount</th>
              <th>Stock Return</th>
              <th>GST</th>
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
                <Num v={r.gst} dec={2} />
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
              <Num v={T.gst} dec={2} />
              <Num v={T.tax} dec={2} />
              <Num v={T.net} dec={2} />
              <Num v={T.cash} dec={2} />
              <Num v={T.credit} dec={2} />
              {dash}
            </tr>
          </tbody>
        </table>
        {(T.gst > 0 || T.to > 0) && (
          <p style={{ fontSize: 7.5, marginTop: 2, textAlign: 'right', fontStyle: 'italic' }}>
            Net Payable = Bill − Stock Return + GST − Trade Offer + Adv Tax (Trade Offer breakup niche summary mein)
          </p>
        )}
        {/* Task 101: Advance Adjust note — kis shop ka return advance is bill se kata
            (user ki "chhoti detail": RET number + amount — ledger ADVANCE row ka mirror) */}
        {detail.settlements.some((s) => (s.advanceAdjusted ?? 0) > 0.005) && (
          <table style={{ fontSize: 8, marginTop: 3 }}><tbody>
            {detail.settlements.filter((s) => (s.advanceAdjusted ?? 0) > 0.005).map((s) => (
              <tr key={s.id} className="cbl-break-avoid">
                <td style={{ border: 'none', textAlign: 'left' }}>
                  <b>Advance Adjust:</b> {s.outletName} — Rs {(s.advanceAdjusted ?? 0).toFixed(2)}{' '}
                  (shop ka return advance is bill se auto-adjust — cash isi se kam){s.notes ? ` • ${s.notes}` : ''}
                </td>
              </tr>
            ))}
          </tbody></table>
        )}

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
                {T.gst > 0 && <tr><td style={{ textAlign: 'center' }}>Add: GST:</td><td className="num">+ {fmt2(T.gst)}</td></tr>}
                {T.to > 0 && <tr><td style={{ textAlign: 'center' }}>Less: Trade Offer:</td><td className="num">- {fmt2(T.to)}</td></tr>}
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
