'use client'

/**
 * Purchase Invoice print (CBL-style A4) — Company Ledger > Purchase Invoices > detail dialog ka Print.
 * Format bills (CblInvoiceDoc) jaisa hi — Task 89 (user: "format same wysa hi ho jysa hamary billon ka"):
 *  - TOP HEADER: jis company se stock liya (SUPPLIER) ka naam
 *  - Customer (M/S) wali jagah: apna DISTRIBUTOR business ka naam/address/phone
 *  - Items table + totals + 3 signature boxes, wahi CBL portrait A4 look
 * .cbl-doc/.cbl-page generic print classes reuse (globals.css) — company-print.tsx ka hi pattern.
 */

import { useEffect, useState } from 'react'
import { PrintFrame } from './cbl-print'
import { api } from '@/lib/dms-api'
import type { PurchaseInvoiceDTO } from '@/lib/dms-types'

// ---------- formatting helpers (cbl-print.tsx jaisi hi copies — wahan export nahi hote) ----------
const fmt2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtI = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 0 })
const fmtCell = (v: number, dec: 0 | 2) => (dec === 2 && Math.abs(v) >= 100_000 ? fmtI(v) : dec === 2 ? fmt2(v) : fmtI(v))
const dayDate = (d: string | Date) => {
  const dt = new Date(d)
  const day = dt.toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' })
  const wd = dt.toLocaleDateString('en-US', { weekday: 'long' })
  return `${day}/${wd}`
}
const dash = <td className="dash">-</td>
const Num = ({ v, fit }: { v: number | null | undefined; fit?: number }) => {
  if (v === null || v === undefined || v === 0) return dash
  const s = fmtI(v)
  return <td className="num" style={fit && s.length > fit ? { fontSize: 7.4 } : undefined}>{s}</td>
}
const M = ({ v, fit }: { v: number; fit?: number }) => (
  <td className="num" style={fit && fmt2(v).length > fit ? { fontSize: 7.4 } : undefined}>{fmt2(v)}</td>
)

/** /api/settings GET ka profile block (Task 78) — distributor apna business yahan rakhta hai */
interface DistProfile {
  distributorName?: string
  businessName?: string
  phone?: string
  city?: string
  address?: string | null
}

const STATUS_LABEL: Record<string, string> = {
  PAID: 'Paid', PARTIAL: 'Partial', UNPAID: 'Unpaid',
}

export function CblPurchaseInvoiceDoc({ inv, dist }: { inv: PurchaseInvoiceDTO; dist: DistProfile | null }) {
  // Task 50 wali hi chain — dialog summary ke numbers EXACT match (har number kisi column ka total):
  const sum2 = (f: (it: PurchaseInvoiceDTO['items'][number]) => number) =>
    Math.round(inv.items.reduce((s, it) => s + f(it), 0) * 100) / 100
  const S = {
    cartons: inv.items.reduce((s, it) => s + it.cartons, 0),
    units: inv.items.reduce((s, it) => s + it.units, 0),
    gross: sum2((it) => it.lineTotal),
    passOn: sum2((it) => it.discountAmt),
    net: sum2((it) => it.netAmount),
    gst: sum2((it) => it.totalTax),
    to: sum2((it) => it.tradeOfferAmt),
    adv: sum2((it) => it.advanceTax),
    incl: sum2((it) => it.amountInclusive || it.lineTotal),
  }
  // bill discount = invoice.discount − Pass On − TO (POST API: discount teeno ka blob hai)
  const billDisc = Math.round((inv.discount - S.passOn - inv.tradeOfferTotal) * 100) / 100
  const balance = Math.round((inv.total - inv.paidAmount) * 100) / 100
  const bizName = (dist?.businessName || dist?.distributorName || '').trim()
  // Task 108: invoice ka tax mode snapshot — INVOICE_DISCOUNT = Noms ladder (TO pehle, GST net−TO par)
  // Task 109: RETAIL_GST = Cadbury sheet mode — GST retail basis (column order CLAIM jaisa, label alag)
  const modeAInv = inv.taxMode === 'INVOICE_DISCOUNT'
  const modeRInv = inv.taxMode === 'RETAIL_GST'

  // ---- Task 34 pattern: DATA-AWARE column widths (water-filling) — bill table jaisa hi ----
  const colSpecs: { key?: string; hw: number; vl: number; min: number; d: number; need: number }[] = []
  const textW = (s: string) =>
    [...s].reduce((a, ch) => a + (/[.,:]/.test(ch) ? 2.4 : /[0-9a-z/-]/.test(ch) ? 4.8 : 6.2), 0)
  const addCol = (vals: string[], header: string, key?: string, min = 20) => {
    const hw = header.split(' ').reduce((a, w) => Math.max(a, textW(w)), 0)
    const vl = vals.reduce((a, s) => Math.max(a, textW(s)), 0)
    const need = Math.max(min, Math.max(hw, vl) + 11)
    const raw = Math.max(hw, vl) * 1.15 + 12
    colSpecs.push({ key, hw, vl, min, d: Math.max(need, raw), need })
  }
  addCol([], 'Item / Product Name', undefined, 130)
  addCol([...inv.items.map((it) => it.batchNo), 'Batch'], 'Batch')
  addCol([...inv.items.map((it) => (it.cartons ? fmtI(it.cartons) : '-')), S.cartons ? fmtI(S.cartons) : '-'], 'CTN', 'ctn')
  addCol([...inv.items.map((it) => fmtI(it.units)), fmtI(S.units)], 'Units', 'units')
  addCol(inv.items.map((it) => fmt2(it.purchasePrice)), 'Rate (Per CTN)', 'rate')
  addCol(inv.items.map((it) => fmtCell(it.lineTotal, 2)), 'Gross Amount', 'gross')
  addCol(inv.items.map((it) => fmtCell(it.discountAmt, 2)), 'Pass On', 'passon')
  addCol(inv.items.map((it) => fmtCell(it.netAmount, 2)), 'Net Amount (Excluding Sales Tax)', 'net')
  // Task 108: column order tax mode par depend — Noms ladder me Trade Offer Sales Tax se PEHLE aata hai
  // Task 109: retail mode (Cadbury) me GST retail basis par hota hai — label me saaf likha jata hai
  if (modeAInv) {
    addCol(inv.items.map((it) => fmt2(it.tradeOfferAmt)), 'Less: Trade Offer', 'to')
    addCol(inv.items.map((it) => fmt2(it.totalTax)), 'Sales Tax (GST)', 'st')
  } else {
    addCol(inv.items.map((it) => fmt2(it.totalTax)), modeRInv ? 'Sales Tax (On Retail)' : 'Sales Tax', 'st')
    addCol(inv.items.map((it) => fmt2(it.tradeOfferAmt)), 'Trade Offer', 'to')
  }
  addCol(inv.items.map((it) => fmt2(it.advanceTax)), 'Advance Tax 236H', 'adv')
  addCol(inv.items.map((it) => fmtCell(it.amountInclusive || it.lineTotal, 2)), 'Amount Inclusive of All Tax', 'incl')
  const TABLE_W = 730 // .cbl-page portrait 794px − px-8 (2 x 32)
  const needs = colSpecs.map((c) => c.need)
  const slack = Math.max(0, TABLE_W - needs.reduce((a, b) => a + b, 0))
  const extra = colSpecs.map((c) => Math.max(0, c.d - c.need))
  const sumExtra = extra.reduce((a, b) => a + b, 0) || 1
  const colPx = colSpecs.map((_, i) => needs[i] + (slack * extra[i]) / sumExtra)
  const colW = colPx.map((px) => `${((px / TABLE_W) * 100).toFixed(3)}%`)
  const fitOf = (key?: string) => {
    const i = colSpecs.findIndex((x) => x.key === key)
    if (i < 0) return undefined
    return Math.floor((colPx[i] - 10) / 4.8)
  }

  return (
    <div className="cbl-doc">
      <div className="cbl-page bg-white px-8 py-6">
        {/* TOP HEADER — SUPPLIER company (jis se stock liya) — bill ke distributor header wali hi jagah */}
        <div className="text-center">
          <p className="text-[17px] font-bold underline">
            {inv.companyName.toUpperCase()}{inv.companyShortCode ? ` (${inv.companyShortCode})` : ''}
          </p>
          <p className="mt-0.5 text-[11px] font-semibold">Stock Purchase — Supplier Invoice</p>
        </div>

        {/* customer block (left) — customer wali jagah ab HAMARA distributor business;
            invoice meta (right) — purchase ki apni fields */}
        <div className="mt-3 flex justify-between">
          <div style={{ width: '50%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>M/S :</td><td style={{ border: 'none' }}>{bizName ? bizName.toUpperCase() : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Address:</td><td style={{ border: 'none' }}>{dist?.address?.trim() ? dist.address.trim().toUpperCase() : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>City:</td><td style={{ border: 'none' }}>{dist?.city?.trim() ? dist.city.trim() : '—'}</td></tr>
                <tr><td style={{ border: 'none', width: 110, fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Contact No:</td><td style={{ border: 'none' }}>{dist?.phone?.trim() ? dist.phone.trim() : '—'}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ width: '46%' }}>
            <table style={{ border: 'none' }}>
              <tbody>
                <tr><td style={{ border: 'none', fontWeight: 'bold', width: 160, whiteSpace: 'nowrap', paddingRight: 8 }}>Purchase Inv No # :</td><td style={{ border: 'none', fontWeight: 'bold' }}>{inv.invoiceNo}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Supplier Bill No :</td><td style={{ border: 'none' }}>{inv.supplierInvoiceNo?.trim() ? inv.supplierInvoiceNo.trim() : '—'}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Purchase Date/Day :</td><td style={{ border: 'none', whiteSpace: 'nowrap' }}>{dayDate(inv.date)}</td></tr>
                <tr><td style={{ border: 'none', fontWeight: 'bold', whiteSpace: 'nowrap', paddingRight: 8 }}>Payment Status :</td><td style={{ border: 'none' }}>{STATUS_LABEL[inv.status] ?? inv.status}{inv.status !== 'PAID' ? ` — Baqi ${fmt2(balance)}` : ''}</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-[16px] font-bold">PURCHASE INVOICE</p>
          </div>
        </div>

        {/* Urdu disclaimer — purchase wali (maal mila check karo, baad ki claim nahi) */}
        <p dir="rtl" className="mt-2 mb-2 text-[12.5px] leading-6" style={{ fontFamily: "'Noto Nastaliq Urdu', 'Jameel Noori Nastaleeq', serif" }}>
          مال موقے پر چیک کر لیں، بعد میں کوئی کلیم قابلِ قبول نہیں ہوگی۔ شکریہ
        </p>

        {/* items table — dialog ke hi 12 columns, wahi CBL style */}
        <table style={{ fontSize: 8.6 }}>
          <colgroup>
            {colW.map((w, i) => (
              <col key={`c${i}`} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th style={{ textAlign: 'left' }}>Item / Product Name</th>
              <th>Batch</th>
              <th>CTN</th>
              <th>Units</th>
              <th>Rate (Per CTN)</th>
              <th>Gross Amount</th>
              <th>Pass On</th>
              <th>Net Amount (Excluding Sales Tax)</th>
              {modeAInv ? (
                <>
                  <th>Less: Trade Offer</th>
                  <th>Sales Tax (GST)</th>
                </>
              ) : (
                <>
                  <th>{modeRInv ? 'Sales Tax (On Retail)' : 'Sales Tax'}</th>
                  <th>Trade Offer</th>
                </>
              )}
              <th>Advance Tax 236H</th>
              <th>Amount Inclusive of All Tax</th>
            </tr>
          </thead>
          <tbody>
            {inv.items.map((it) => (
              <tr key={it.id} className="cbl-break-avoid">
                <td style={{ textAlign: 'left' }}>{it.sku} {it.productName}</td>
                <td style={{ textAlign: 'center' }}>
                  {it.batchNo}
                  {it.expDate ? <><br /><span style={{ fontSize: 7.2 }}>exp {dayDate(it.expDate)}</span></> : null}
                </td>
                <Num v={it.cartons} />
                <Num v={it.units} />
                <M v={it.purchasePrice} fit={fitOf('rate')} />
                <M v={it.lineTotal} fit={fitOf('gross')} />
                <M v={it.discountAmt} fit={fitOf('passon')} />
                <M v={it.netAmount} fit={fitOf('net')} />
                {modeAInv ? (
                  <>
                    <M v={it.tradeOfferAmt} fit={fitOf('to')} />
                    <M v={it.totalTax} fit={fitOf('st')} />
                  </>
                ) : (
                  <>
                    <M v={it.totalTax} fit={fitOf('st')} />
                    <M v={it.tradeOfferAmt} fit={fitOf('to')} />
                  </>
                )}
                <M v={it.advanceTax} fit={fitOf('adv')} />
                <M v={it.amountInclusive || it.lineTotal} fit={fitOf('incl')} />
              </tr>
            ))}
            <tr style={{ fontWeight: 'bold', backgroundColor: '#f7f7f7' }}>
              <td style={{ textAlign: 'left' }}>Total — {inv.items.length} item{inv.items.length > 1 ? 's' : ''}</td>
              <td />
              <Num v={S.cartons} />
              <Num v={S.units} />
              <td className="dash">-</td>
              <M v={S.gross} fit={fitOf('gross')} />
              <M v={S.passOn} fit={fitOf('passon')} />
              <M v={S.net} fit={fitOf('net')} />
              {modeAInv ? (
                <>
                  <M v={S.to} fit={fitOf('to')} />
                  <M v={S.gst} fit={fitOf('st')} />
                </>
              ) : (
                <>
                  <M v={S.gst} fit={fitOf('st')} />
                  <M v={S.to} fit={fitOf('to')} />
                </>
              )}
              <M v={S.adv} fit={fitOf('adv')} />
              <M v={S.incl} fit={fitOf('incl')} />
            </tr>
          </tbody>
        </table>

        {/* totals box (right) — dialog summary ki EXACT copy (Gross − Pass On = Net → − TO − Bill Disc + GST + Adv) */}
        <div className="mt-4 flex justify-end">
          <div style={{ width: '42%' }}>
            <table className="cbl-break-avoid" style={{ fontSize: 10 }}>
              <tbody>
                <tr><td style={{ textAlign: 'center' }}>Gross Amount:</td><td className="num" style={{ width: 110 }}>{fmt2(inv.subtotal)}</td></tr>
                {S.passOn > 0 && <tr><td style={{ textAlign: 'center' }}>− Pass On (items):</td><td className="num">{fmt2(S.passOn)}</td></tr>}
                <tr><td style={{ textAlign: 'center', fontWeight: 'bold' }}>Net Amount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(S.net)}</td></tr>
                {modeAInv && inv.tradeOfferTotal > 0 && <tr><td style={{ textAlign: 'center' }}>Less: Trade Offer:</td><td className="num">- {fmt2(inv.tradeOfferTotal)}</td></tr>}
                {billDisc > 0 && <tr><td style={{ textAlign: 'center' }}>Bill Discount{inv.discountPct > 0 ? ` (${inv.discountPct}%)` : ''}:</td><td className="num">- {fmt2(billDisc)}</td></tr>}
                {inv.taxTotal > 0 && <tr><td style={{ textAlign: 'center' }}>{modeAInv ? 'Sales Tax (GST):' : modeRInv ? 'GST (Retail Basis):' : 'GST:'}</td><td className="num">+ {fmt2(inv.taxTotal)}</td></tr>}
                {inv.advanceTaxTotal > 0 && <tr><td style={{ textAlign: 'center' }}>Advance Tax 236H ({inv.advanceTaxPct}%):</td><td className="num">+ {fmt2(inv.advanceTaxTotal)}</td></tr>}
                {!modeAInv && inv.tradeOfferTotal > 0 && <tr><td style={{ textAlign: 'center' }}>Trade Offer:</td><td className="num">- {fmt2(inv.tradeOfferTotal)}</td></tr>}
                <tr><td style={{ textAlign: 'right', fontWeight: 'bold' }}>Net Invoice Amount:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(inv.total)}</td></tr>
                <tr><td style={{ textAlign: 'center' }}>Paid:</td><td className="num">{fmt2(inv.paidAmount)}</td></tr>
                {balance > 0 && <tr><td style={{ textAlign: 'right', fontWeight: 'bold' }}>Balance Payable:</td><td className="num" style={{ fontWeight: 'bold' }}>{fmt2(balance)}</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {inv.notes && (
          <p className="mt-2 text-[10px] text-slate-600" style={{ borderLeft: '2px solid #ccc', paddingLeft: 8 }}>Notes: {inv.notes}</p>
        )}

        {/* signature boxes — bill jaisi hi 3 boxes, purchase roles */}
        <div className="mt-6 flex justify-between px-4">
          {['|Received By (Store)', '|Checked By', '|Authorized Signature'].map((s, i) => {
            const [, role] = s.split('|')
            return (
              <div key={i} className="w-44 text-center cbl-break-avoid">
                <p className="mb-1 text-[11px]">&nbsp;</p>
                <div style={{ border: '1.5px solid #000' }} className="px-3 py-1.5 text-[11px] font-bold">{role}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** PrintFrame wrapper — settings se distributor profile le kar doc dikhata hai (bill print ka hi pattern) */
export function PurchaseInvoicePrint({ invoice, onClose }: { invoice: PurchaseInvoiceDTO; onClose: () => void }) {
  const [dist, setDist] = useState<DistProfile | null>(null)
  useEffect(() => {
    let dead = false
    try {
      const user = JSON.parse(localStorage.getItem('dms_session') ?? 'null')
      api<{ profile?: DistProfile }>(`/api/settings?userId=${user?.id ?? ''}`)
        .then((s) => { if (!dead) setDist(s.profile ?? null) })
        .catch(() => { /* profile na mile to doc '—' dikha kar print hota hai */ })
    } catch { /* localStorage empty — ignore */ }
    return () => { dead = true }
  }, [])
  return (
    <PrintFrame
      title={`Purchase Invoice ${invoice.invoiceNo}`}
      pdfName={`purchase-invoice-${invoice.invoiceNo}`}
      onClose={onClose}
    >
      <CblPurchaseInvoiceDoc inv={invoice} dist={dist} />
    </PrintFrame>
  )
}
